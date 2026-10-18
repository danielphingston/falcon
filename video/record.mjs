import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:4180';
const OUT = 'D:/ToDo/video/out';
const RAW = OUT + '/raw';
const CSV = 'D:/ToDo/video/assets/team-allocation-sample.csv';
const story = JSON.parse(fs.readFileSync('D:/ToDo/video/storyboard.json', 'utf8'));
const dur = JSON.parse(fs.readFileSync(OUT + '/durations.json', 'utf8'));
const scenes = story.scenes;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of fs.readdirSync(RAW)) fs.rmSync(path.join(RAW, f), { force: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
  acceptDownloads: false,
});

await context.addInitScript(() => {
  const mk = () => {
    if (document.getElementById('vid-cursor') || !document.body) return;
    const d = document.createElement('div');
    d.id = 'vid-cursor';
    d.style.cssText = 'position:fixed;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(79,70,229,.55);border:1.5px solid rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(79,70,229,.4);pointer-events:none;z-index:2147483646;transition:transform .15s ease;transform:translate(-100px,-100px)';
    document.body.appendChild(d);
  };
  let x = -100, y = -100, s = 1;
  const apply = () => { const d = document.getElementById('vid-cursor'); if (d) d.style.transform = `translate(${x}px,${y}px) scale(${s})`; };
  document.addEventListener('mousemove', (e) => { mk(); x = e.clientX; y = e.clientY; apply(); }, true);
  document.addEventListener('mousedown', () => { mk(); s = 2.2; apply(); setTimeout(() => { s = 1; apply(); }, 180); }, true);
});

const page = await context.newPage();
const videoStart = performance.now();
const now = () => (performance.now() - videoStart) / 1000;
const warn = (m) => console.warn('WARN', m);
let failures = 0;

// ---- Gemini mock
await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
  let body = {};
  try { body = route.request().postDataJSON() ?? {}; } catch {}
  const contents = body.contents ?? [];
  const last = contents[contents.length - 1];
  const sse = (parts) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] })}\r\n\r\n`;
  let out;
  if (last?.parts?.some((p) => p.functionResponse)) {
    const chunks = [
      "Here's a plan for today:\n\n",
      '1. **Clear the review points on A.1 EBITDA bridge**',
      ' so the draft can move forward.\n2. **Chase Rahul for the 5 pending Falcon IRL items**',
      ' and log the chase.\n3. **Review B.2 Monthly NWC trend & peg from Sneha**',
      ' before she asks again.\n4. **Book last week\'s timesheet** while it is fresh.\n\n',
      'I would suggest a 50-minute focus block first thing, on the A.1 review points.',
    ];
    out = chunks.map((c) => sse([{ text: c }])).join('');
  } else {
    out = sse([{ functionCall: { name: 'get_today', args: {} } }]);
  }
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: out });
});

// ---- helpers
async function setCaption(text, n, total, bottom = 18) {
  await page.evaluate(({ text, n, total, bottom }) => {
    let el = document.getElementById('vid-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vid-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:900px;padding:12px 20px;border-radius:14px;background:rgba(15,23,42,.88);color:#fff;font:600 20px system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:12px;opacity:0;transition:opacity .5s ease;width:max-content;';
      const chip = document.createElement('span');
      chip.id = 'vid-caption-chip';
      chip.style.cssText = 'font:600 12px system-ui,sans-serif;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.18);color:#e2e8f0;flex:none';
      const t = document.createElement('span');
      t.id = 'vid-caption-text';
      el.append(chip, t);
      document.body.appendChild(el);
    }
    el.style.bottom = bottom + 'px';
    el.querySelector('#vid-caption-chip').textContent = `${n}/${total}`;
    el.querySelector('#vid-caption-text').textContent = text;
    el.style.opacity = '0';
    void el.offsetWidth;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }, { text, n, total, bottom }).catch((e) => warn('caption: ' + e.message));
}

const vis = (loc) => loc.filter({ visible: true }).first();
let mx = 640, my = 360;
async function moveTo(x, y, steps = 15) {
  await page.mouse.move(x, y, { steps });
  mx = x; my = y;
}
async function center(loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function hover(loc) { const [x, y] = await center(loc); await moveTo(x, y); }
async function click(loc, label = '') {
  try {
    await loc.waitFor({ state: 'visible', timeout: 6000 });
    const [x, y] = await center(loc);
    await moveTo(x, y);
    await sleep(150);
    await page.mouse.click(x, y);
    await sleep(250);
    return true;
  } catch (e) {
    failures++;
    warn(`click failed (${label}): ${e.message.split('\n')[0]}`);
    return false;
  }
}
async function type(loc, text, label = '') {
  try {
    await loc.waitFor({ state: 'visible', timeout: 6000 });
    await click(loc, label);
    await loc.pressSequentially(text, { delay: 60 });
    return true;
  } catch (e) {
    failures++; warn(`type failed (${label}): ${e.message.split('\n')[0]}`); return false;
  }
}
async function scroll(total, step = 60, wait = 40) {
  await moveTo(760, 300, 5);
  const dir = Math.sign(total);
  for (let d = 0; d < Math.abs(total); d += step) { await page.mouse.wheel(0, dir * step); await sleep(wait); }
}
const nav = (name) => click(vis(page.getByRole('link', { name, exact: true })), 'nav ' + name);
const guard = async (label, fn) => { try { await fn(); } catch (e) { failures++; warn(`${label}: ${e.message.split('\n')[0]}`); } };

// ---- setup
await page.goto(BASE + '/settings');
await page.waitForLoadState('networkidle').catch(() => {});
await sleep(800);
await guard('setup', async () => {
  const sec = page.getByText('AI assistant (Gemini)').first();
  await sec.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  await page.getByLabel('Gemini API key').fill('demo-key');
  const input = page.getByLabel('Gemini API key');
  await input.locator('xpath=ancestor::*[.//button[normalize-space()="Save"]][1]').getByRole('button', { name: 'Save', exact: true }).click();
  await sleep(500);
});
await page.goto(BASE + '/');
await page.waitForLoadState('networkidle').catch(() => {});
await sleep(1000);

// ---- scenes
const total = scenes.length;
const timestamps = {};
const check = new Set(['03-today', '08-import', '13-calendar']);

const actions = {
  '01-intro': async () => { await moveTo(640, 300, 5); },

  '02-sample': async () => {
    await nav('Settings');
    await sleep(700);
    const load = vis(page.getByRole('button', { name: 'Load', exact: true }));
    await scroll(500, 50, 35);
    await click(load, 'Load');
    await sleep(1500);
    await nav('Today');
  },

  '03-today': async () => {
    await sleep(800);
    await scroll(1400, 40, 30);
    await sleep(500);
    await scroll(-1400, 80, 25);
  },

  '04-quickadd': async () => {
    const qa = vis(page.getByLabel('Quick add'));
    await type(qa, 'Call Rahul re TB #Falcon !tom@3pm', 'quick add');
    await sleep(1800);
    await page.keyboard.press('Enter');
    await sleep(1200);
  },

  '05-complete': async () => {
    const sec = vis(page.locator('section, div').filter({ has: page.getByRole('heading', { name: /Due today/ }) }));
    let cb = sec.getByRole('checkbox').first();
    if (!(await cb.count())) {
      const h = vis(page.getByText('Due today', { exact: false }));
      cb = h.locator('xpath=ancestor::*[.//*[@role="checkbox"]][1]').getByRole('checkbox').first();
    }
    await click(cb, 'due today checkbox');
    await sleep(2500);
  },

  '06-chase': async () => {
    const btn = vis(page.getByRole('button', { name: /Chased/ }));
    await scroll(300, 50, 30);
    await click(btn, 'Chased');
    await sleep(1000);
  },

  '07-engagements': async () => {
    await nav('Engagements');
    await sleep(800);
    await hover(vis(page.getByText('Project Falcon').first()));
  },

  '08-import': async () => {
    await click(vis(page.getByRole('button', { name: 'Import', exact: true })), 'Import');
    await sleep(600);
    await page.locator('input[type=file][accept*=".xlsx"]').first().setInputFiles(CSV);
    await sleep(1500);
    await guard('select me', async () => {
      const sel = page.getByRole('dialog').locator('select').first();
      if (await sel.count()) {
        const cur = await sel.evaluate((s) => s.options[s.selectedIndex]?.text);
        if (!/Anand K/.test(cur || '')) await sel.selectOption({ label: 'Anand K' });
      }
    });
    await sleep(800);
    await moveTo(640, 400, 5);
    await scroll(300, 30, 40);
    await sleep(1500);
    await scroll(-150, 30, 40);
    const dlg = page.getByRole('dialog');
    await click(vis(dlg.getByRole('button', { name: /^Import \d/ })), 'dialog Import');
    await sleep(1500);
  },

  '09-engagement': async () => {
    await click(vis(page.getByText('Project Falcon').first()), 'Falcon');
    await sleep(900);
    await scroll(250, 50, 30);
    await sleep(500);
    await click(vis(page.locator('nav').getByRole('button', { name: /^Tasks/ })), 'Tasks tab');
  },

  '10-irl': async () => {
    await click(vis(page.locator('nav').getByRole('button', { name: /^IRL/ })), 'IRL tab');
    await sleep(700);
    await hover(vis(page.getByRole('button', { name: /Copy pending table/ })));
    await sleep(900);
    await hover(vis(page.getByRole('link', { name: /Email / })));
    await sleep(900);
    await scroll(700, 50, 35);
    await hover(vis(page.getByText('Add IRL items')));
  },

  '11-workpapers': async () => {
    await scroll(-1500, 150, 10);
    await click(vis(page.locator('nav').getByRole('button', { name: /^Work papers/ })), 'WP tab');
    await sleep(700);
    await click(vis(page.getByText(/A\.1/).first()), 'A.1 row');
    await sleep(900);
    const dlg = page.getByRole('dialog');
    const cbs = dlg.getByRole('checkbox');
    const n = await cbs.count();
    let done = false;
    for (let i = 0; i < n && !done; i++) {
      const c = cbs.nth(i);
      const checked = await c.isChecked().catch(() => null);
      if (checked === false) { done = await click(c, 'review point'); }
    }
    if (!done) warn('no open review point checkbox found');
    await sleep(2500);
    await click(vis(dlg.getByRole('button', { name: 'Close' })), 'Close');
  },

  '12-followups': async () => {
    await nav('Follow-ups');
    await sleep(900);
    await click(vis(page.getByRole('button', { name: 'Clients', exact: true })), 'Clients');
    await sleep(1200);
    await click(vis(page.getByRole('button', { name: 'All', exact: true })), 'All');
  },

  '13-calendar': async () => {
    await nav('Calendar');
    await sleep(1500);
    await click(vis(page.getByRole('button', { name: 'Next week' })), 'Next week');
    await sleep(1500);
    await click(vis(page.getByRole('button', { name: 'Month', exact: true })), 'Month');
  },

  '14-time': async () => {
    await nav('Time & focus');
    await sleep(900);
    await click(vis(page.getByRole('button', { name: /Start focus/ })), 'Start focus');
    await sleep(2000);
    await click(vis(page.getByRole('button', { name: /Discard/ })), 'Discard');
    await sleep(600);
    await scroll(1200, 50, 30);
  },

  '15-reports-progress': async () => {
    await nav('Reports');
    await sleep(700);
    await click(vis(page.getByRole('button', { name: 'This week', exact: true })), 'This week');
    await sleep(2000);
    await nav('Progress');
    await sleep(900);
    await scroll(900, 50, 30);
    await hover(vis(page.getByRole('heading', { name: /Badges/ }).or(page.getByText('Badges', { exact: true }))));
  },

  '16-assistant': async () => {
    await nav('Assistant');
    await sleep(900);
    const msg = vis(page.getByLabel('Message'));
    await type(msg, 'Plan my day', 'Message');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
  },

  '17-settings': async () => {
    await nav('Settings');
    await sleep(1200);
    await scroll(2400, 25, 40);
  },

  '18-install': async () => {
    await nav('Today');
    await sleep(700);
    await page.evaluate(() => {
      const c = document.createElement('div');
      c.id = 'vid-install';
      c.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;box-sizing:border-box;padding:28px 32px;border-radius:14px;background:rgba(15,23,42,.94);color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.4);z-index:2147483646;pointer-events:none';
      c.innerHTML = '<div style="font-size:26px;font-weight:700;margin-bottom:18px">Install on your phone</div>' +
        ['1&nbsp;&nbsp;Open the link in Safari', '2&nbsp;&nbsp;Tap Share', '3&nbsp;&nbsp;Tap Add to Home Screen'].map((s) => `<div style="font-size:20px;font-weight:600;padding:10px 0;border-top:1px solid rgba(255,255,255,.12)">${s}</div>`).join('') +
        '<div style="font-size:14px;opacity:.7;margin-top:14px">Windows: use the install icon in Chrome or Edge\'s address bar</div>';
      document.body.appendChild(c);
    });
  },

  '19-outro': async () => {
    await page.evaluate(() => document.getElementById('vid-install')?.remove());
    await nav('Today');
  },
};

for (let i = 0; i < total; i++) {
  const sc = scenes[i];
  const target = dur[sc.id] + 0.8;
  const t0 = now();
  timestamps[sc.id] = +t0.toFixed(2);
  console.log(`scene ${sc.id} @ ${t0.toFixed(2)}s (target ${target.toFixed(2)}s)`);
  const bottom = (sc.id === '05-complete' || sc.id === '08-import') ? 84 : 18;
  await setCaption(sc.caption, i + 1, total, bottom);
  await guard(sc.id, async () => {
    if (check.has(sc.id)) {
      await sleep(sc.id === '03-today' ? 1200 : 400);
    }
    if (sc.id === '03-today' || sc.id === '13-calendar') {
      // screenshot after scene content is visible (calendar needs navigating first)
    }
    if (sc.id === '03-today') await page.screenshot({ path: OUT + '/check-03.png' });
    await actions[sc.id]();
    if (sc.id === '08-import') await page.screenshot({ path: OUT + '/check-08.png' });
    if (sc.id === '13-calendar') await page.screenshot({ path: OUT + '/check-13.png' });
  });
  // re-apply caption in case a full load wiped it
  const has = await page.evaluate(() => !!document.getElementById('vid-caption')).catch(() => false);
  if (!has) await setCaption(sc.caption, i + 1, total, bottom);
  const elapsed = now() - t0;
  if (elapsed > target) warn(`scene ${sc.id} overran: ${elapsed.toFixed(2)}s > ${target.toFixed(2)}s`);
  else await sleep((target - elapsed) * 1000);
}

timestamps.end = null;
await sleep(1000);
timestamps.end = +now().toFixed(2);
const video = page.video();
await context.close();
const vp = await video.path();
const dest = OUT + '/raw.webm';
fs.rmSync(dest, { force: true });
fs.renameSync(vp, dest);
fs.writeFileSync(OUT + '/timestamps.json', JSON.stringify(timestamps, null, 2));
await browser.close();
console.log('done; failures=' + failures, 'size=', fs.statSync(dest).size, 'end=', timestamps.end);


