import { useRef, useState, type ReactNode } from "react";
import { BACKUP_VERSION, GEMINI_OAUTH_SCOPE, deleteOrphans, findOrphans, listGeminiModels, mergeRecords, parseBackup, tableNames, type Backup, type Settings } from "@falcon/core";
import { chatAuth, clearChat, friendlyError } from "../lib/chat";
import { Icon } from "../components/Icon";
import { AliasEditor } from "../components/AliasEditor";
import { TLink } from "../components/TLink";
import { Segmented } from "../components/ui";
import { db, getSettings, saveSettings } from "../db";
import { act } from "../lib/act";
import { useSettings, useSnapshot } from "../lib/hooks";
import { loadSampleData } from "../lib/sample";
import { useLiveQuery } from "dexie-react-hooks";
import { SyncBadge } from "../components/SyncBadge";
import { ImportAllocation } from "../components/ImportAllocation";
import { FirmImport } from "../components/FirmImport";
import { deleteTemplate, exportLibrary, importLibrary, useFirmLearned, useFirmTemplates } from "../lib/firm";
import { connectGoogle, disconnectGoogle, hasScope, readAuth, warmGoogle } from "../lib/google";
import { markSignedOut, scheduleSync, syncNow, useSyncStatus } from "../lib/sync";
import { toast } from "../lib/toast";

// Static about / privacy / terms pages in public/, outside the router.
const PAGES = import.meta.env.BASE_URL;

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function SettingsPage() {
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const set = (patch: Partial<Settings>) => void saveSettings(patch);

  const exportJson = async () => {
    const tables = Object.fromEntries(await Promise.all(tableNames.map(async (t) => [t, await db.table(t).toArray()]))) as Backup["tables"];
    const backup: Backup = { app: "fdd-tracker", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), settings: await getSettings(), tables };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `falcon-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      let changed = 0;
      await db.transaction("rw", tableNames.map((t) => db.table(t)), async () => {
        for (const t of tableNames) {
          const local = await db.table(t).toArray();
          const res = mergeRecords(local as never[], backup.tables[t] as never[]);
          if (res.changed.length) await db.table(t).bulkPut(res.changed);
          changed += res.changed.length;
        }
      });
      if (backup.settings) await saveSettings(backup.settings);
      scheduleSync(500);
      toast({ message: `Imported. ${changed} record${changed === 1 ? "" : "s"} added or updated`, tone: "success" });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Import failed", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
        <p className="text-sm muted">Data lives on this device, and syncs through your own Google Drive once you connect.</p>
      </header>

      <GoogleGroup s={s} />
      <AiGroup s={s} />

      <Group title="You">
        <Row label="Your name" hint="Used in greetings and chase emails">
          <input className="input max-w-56" defaultValue={s.myName === "Me" ? "" : s.myName} placeholder="Your name" onBlur={(e) => set({ myName: e.target.value.trim() || "Me" })} />
        </Row>
        <div className="px-4 py-3">
          <p className="mb-2 text-sm font-medium">Also written as</p>
          <AliasEditor
            aliases={s.myAliases}
            onChange={(myAliases) => void set({ myAliases })}
            hint="How work plans and sheets write you (e.g. JK). Steps with these names count as yours. Initials of your name match on their own."
          />
        </div>
      </Group>

      <Group title="Working week">
        <Row label="Working days" hint="Chase dates skip non-working days">
          <div className="flex gap-1">
            {DAYS.map((d, i) => {
              const on = s.workingDays.includes(i);
              return (
                <button
                  key={i}
                  className={`size-9 rounded-full text-sm font-semibold transition-colors ${on ? "bg-brand-600 text-white" : "bg-[var(--surface-2)] muted"}`}
                  onClick={() => set({ workingDays: on ? s.workingDays.filter((x) => x !== i) : [...s.workingDays, i].sort() })}
                  aria-pressed={on}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Holidays" hint="Comma-separated, YYYY-MM-DD">
          <input
            className="input max-w-72"
            defaultValue={s.holidays.join(", ")}
            placeholder="2026-11-09, 2026-12-25"
            onBlur={(e) => {
              const list = e.target.value.split(/[,\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
              set({ holidays: list });
            }}
          />
        </Row>
        {(["client", "manager", "team"] as const).map((k) => (
          <Row key={k} label={`Chase ${k === "client" ? "clients" : k === "manager" ? "managers" : "team"} every`}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                className="input w-20"
                defaultValue={s.chaseDays[k]}
                onBlur={(e) => set({ chaseDays: { ...s.chaseDays, [k]: Math.max(1, Number(e.target.value) || 1) } })}
              />
              <span className="text-sm muted">working days</span>
            </div>
          </Row>
        ))}
      </Group>

      <Group title="Look & feel">
        <Row label="Theme">
          <Segmented id="theme" value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Animations" hint="Page transitions and motion">
          <Switch on={s.motion} onChange={(motion) => set({ motion })} />
        </Row>
        <Row label="Confetti" hint="Celebrate finished work">
          <Switch on={s.confetti} onChange={(confetti) => set({ confetti })} />
        </Row>
      </Group>

      <Group title="Time & progress">
        <Row label="Gamification" hint="Daily ring, streaks, levels and badges">
          <Switch on={s.gamification} onChange={(gamification) => set({ gamification })} />
        </Row>
        <Row label="Focus sessions per day" hint="Target for the green ring">
          <input type="number" min={0} max={12} className="input w-20" defaultValue={s.focusTarget} onBlur={(e) => set({ focusTarget: Math.min(12, Math.max(0, Number(e.target.value) || 0)) })} />
        </Row>
        <Row label="Default focus length" hint="Minutes">
          <input type="number" min={5} max={180} className="input w-20" defaultValue={s.focusMinutes} onBlur={(e) => set({ focusMinutes: Math.min(180, Math.max(5, Number(e.target.value) || 25)) })} />
        </Row>
        <Row label="Timesheet rounding">
          <Segmented
            id="increment"
            value={String(s.timeIncrement)}
            onChange={(v) => set({ timeIncrement: Number(v) })}
            options={[
              { value: "0.1", label: "0.1h" },
              { value: "0.25", label: "¼h" },
              { value: "0.5", label: "½h" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Reminders">
        <Row label="Notifications" hint="Reminders pop up while the app is open. Calendar alerts come with Google sync.">
          {perm === "granted" ? (
            <span className="text-sm font-medium text-emerald-600">Allowed</span>
          ) : perm === "unsupported" ? (
            <span className="text-sm muted">Install the app first (iPhone)</span>
          ) : (
            <button className="btn btn-soft btn-sm" onClick={async () => setPerm(await Notification.requestPermission())}>
              <Icon name="bell" size={14} /> Allow
            </button>
          )}
        </Row>
      </Group>

      <FirmGroup />

      <Group title="Data">
        <OrphanCleanup />
        <Row label="Back up" hint="Download everything as a JSON file">
          <button className="btn btn-soft btn-sm" onClick={exportJson}>
            <Icon name="download" size={14} /> Export
          </button>
        </Row>
        <Row label="Restore / merge" hint="Newer records win; nothing is lost">
          <button className="btn btn-soft btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = "";
            }}
          />
        </Row>
        <Row label="Import team allocation" hint="Assignments, types and team members from Excel or CSV">
          <button className="btn btn-soft btn-sm" onClick={() => setImporting(true)}>
            <Icon name="upload" size={14} /> Import sheet
          </button>
          <ImportAllocation open={importing} onClose={() => setImporting(false)} />
        </Row>
        <Row label="Sample data" hint="A demo engagement to explore. Undo removes it">
          <button className="btn btn-soft btn-sm" onClick={() => act("Sample data loaded", (ctx) => loadSampleData(ctx))}>
            <Icon name="sparkles" size={14} /> Load
          </button>
        </Row>
        <Row label="Erase everything" hint="Deletes all data on this device">
          <button
            className="btn btn-soft btn-sm text-rose-600"
            onClick={async () => {
              if (!window.confirm("Erase all Falcon data on this device? Export a backup first if you might need it.")) return;
              await db.delete();
              location.reload();
            }}
          >
            <Icon name="trash" size={14} /> Erase
          </button>
        </Row>
      </Group>
      <p className="pb-4 text-center text-xs muted">
        Falcon · version {new Date(__BUILD_TIME__).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        <br />
        <a className="underline" href={`${PAGES}about.html`}>About</a> · <a className="underline" href={`${PAGES}privacy.html`}>Privacy policy</a> ·{" "}
        <a className="underline" href={`${PAGES}terms.html`}>Terms of use</a>
      </p>
    </div>
  );
}

function GoogleGroup({ s }: { s: Settings }) {
  const auth = useLiveQuery(readAuth, []);
  const status = useSyncStatus();
  const [clientId, setClientId] = useState(s.googleClientId);
  const [busy, setBusy] = useState(false);
  const builtIn = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const set = (patch: Partial<Settings>) => void saveSettings(patch).then(() => scheduleSync(500));

  const connect = async () => {
    // connectGoogle must be the first await: Safari blocks popups opened after one.
    const pending = connectGoogle();
    setBusy(true);
    try {
      const a = await pending;
      if (!a) return; // redirecting to Google
      const missing = [
        !hasScope(a, "https://www.googleapis.com/auth/drive.appdata") && "Drive sync",
        !hasScope(a, "https://www.googleapis.com/auth/calendar.events") && "Calendar",
      ].filter(Boolean);
      toast({
        message: missing.length ? `Connected, but without ${missing.join(" and ")}. Tick those boxes when connecting to use them.` : `Connected as ${a.email ?? "your Google account"}`,
        tone: missing.length ? "default" : "success",
        duration: 7000,
      });
      await syncNow();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't connect", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Google sync & Calendar">
      {!auth ? (
        <>
          <div className="space-y-2 px-4 py-3">
            <p className="text-[15px] font-medium">Sync across devices with Google</p>
            <p className="text-xs muted">
              Your data is saved to a hidden app folder in <b>your own</b> Google Drive (you won't see it in Drive), and deadlines, reminders and focus blocks go to your Google Calendar. Nothing passes through any other server.{" "}
              <a className="underline" href={`${PAGES}privacy.html`}>Privacy policy</a>
            </p>
          </div>
          {!builtIn && (
            <Row label="OAuth client ID" hint="From Google Cloud. See README → Google setup">
              <input
                className="input max-w-72 font-mono text-xs"
                placeholder="1234-abc.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onBlur={() => clientId.trim() !== s.googleClientId && void saveSettings({ googleClientId: clientId.trim() }).then(() => warmGoogle())}
              />
            </Row>
          )}
          <div className="px-4 py-3">
            <button className="btn btn-primary w-full sm:w-auto" onClick={connect} disabled={busy || (!builtIn && (!clientId.trim() || clientId.trim() !== s.googleClientId))}>
              <Icon name="cloud" size={16} /> {busy ? "Connecting…" : "Connect Google account"}
            </button>
          </div>
        </>
      ) : (
        <>
          <Row label={auth.email ?? "Google account"} hint={status.state === "needs-auth" ? "Session expired. Reconnect to keep syncing" : "Connected"}>
            <div className="flex flex-wrap items-center gap-2">
              <SyncBadge />
              {status.state === "needs-auth" ? (
                <button className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>
                  Reconnect
                </button>
              ) : (
                <button className="btn btn-soft btn-sm" onClick={() => void syncNow()} disabled={status.state === "syncing"}>
                  <Icon name="refresh" size={14} /> Sync now
                </button>
              )}
            </div>
          </Row>
          {status.state === "error" && status.message && <p className="px-4 py-2 text-xs text-rose-600">{status.message}</p>}
          <Row label="Reminders → Calendar" hint="Each reminder becomes an event with a popup, so it fires on every device">
            <Switch on={s.calendarAlerts} onChange={(calendarAlerts) => set({ calendarAlerts })} />
          </Row>
          <Row label="Key dates → Calendar" hint="Kick-off, data room, draft & final report (all-day, reminder the day before)">
            <Switch on={s.calendarKeyDates} onChange={(calendarKeyDates) => set({ calendarKeyDates })} />
          </Row>
          <Row label="Due dates → Calendar" hint="Tasks, work papers and follow-ups with a due date">
            <Switch on={s.calendarDueDates} onChange={(calendarDueDates) => set({ calendarDueDates })} />
          </Row>
          <Row label="Disconnect" hint="Stops syncing on this device. Data here and in Drive stays">
            <button
              className="btn btn-soft btn-sm"
              onClick={async () => {
                await disconnectGoogle();
                markSignedOut();
                toast({ message: "Google disconnected" });
              }}
            >
              Disconnect
            </button>
          </Row>
        </>
      )}
    </Group>
  );
}

const MODEL_PRESETS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (recommended)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (cheapest)" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview, most capable)" },
];

function AiGroup({ s }: { s: Settings }) {
  const auth = useLiveQuery(readAuth, []);
  const [models, setModels] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const googleReady = hasScope(auth ?? null, GEMINI_OAUTH_SCOPE);
  const options = [...MODEL_PRESETS.map((m) => m.id), ...(models ?? [])].filter((m, i, a) => a.indexOf(m) === i);
  if (!options.includes(s.geminiModel)) options.unshift(s.geminiModel);

  const check = async () => {
    setChecking(true);
    try {
      const a = await chatAuth();
      if (typeof a === "string") throw new Error(a);
      const list = await listGeminiModels(a);
      setModels(list);
      toast({ message: `Gemini works. ${list.length} models available`, tone: "success" });
    } catch (e) {
      toast({ message: friendlyError(e), tone: "error", duration: 8000 });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Group title="AI assistant (Gemini)">
      <Row
        label={googleReady ? "Gemini access granted" : auth ? "Gemini access not granted yet" : "Not signed in"}
        hint={googleReady ? `As ${auth?.email ?? "your Google account"}` : auth ? "Reconnect and tick the Gemini permission" : "Connect Google above first"}
      >
        {auth && !googleReady ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              try {
                await connectGoogle();
              } catch (e) {
                toast({ message: e instanceof Error ? e.message : "Couldn't connect", tone: "error" });
              }
            }}
          >
            Allow Gemini
          </button>
        ) : (
          <span className={`text-sm font-medium ${googleReady ? "text-emerald-600" : "muted"}`}>{googleReady ? "Ready" : "—"}</span>
        )}
      </Row>

      <Row label="Model" hint="Flash is fast and cheap; Pro is better at long, tricky requests">
        <select className="input max-w-72" value={s.geminiModel} onChange={(e) => void saveSettings({ geminiModel: e.target.value })} aria-label="Gemini model">
          {options.map((m) => (
            <option key={m} value={m}>
              {MODEL_PRESETS.find((p) => p.id === m)?.label ?? m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="AI changes" hint="Changes from the Assistant or Claude wait in your Inbox. Ticked kinds apply straight away (with Undo).">
        <div className="flex flex-col items-end gap-1 text-sm">
          {(
            [
              ["taskDates", "Moving task dates/times"],
              ["chaseLogs", "Logging chases"],
            ] as const
          ).map(([k, lbl]) => (
            <label key={k} className="flex items-center gap-2">
              {lbl}
              <input
                type="checkbox"
                checked={s.autoApply.includes(k)}
                onChange={(e) => void saveSettings({ autoApply: e.target.checked ? [...new Set([...s.autoApply, k])] : s.autoApply.filter((x) => x !== k) })}
              />
            </label>
          ))}
        </div>
      </Row>
      <Row label="Check connection" hint="Lists the models your access allows (free)">
        <button className="btn btn-soft btn-sm" onClick={check} disabled={checking}>
          <Icon name="refresh" size={14} /> {checking ? "Checking…" : "Check"}
        </button>
      </Row>
      <Row label="Chat history" hint="Kept on this device only">
        <button className="btn btn-soft btn-sm" onClick={() => void clearChat().then(() => toast({ message: "Chat cleared" }))}>
          Clear
        </button>
      </Row>
      <p className="px-4 py-3 text-xs muted">
        Messages and attachments you send go to Google's Gemini API. Use a paid (billing-enabled) project or key, so Google doesn't use them to improve its products, and check your firm's policy before sharing client documents.
      </p>
      <Row label="Use Falcon from Claude" hint="Connect Claude Desktop, Claude Code or another MCP app through the local bridge, and see what each session changed">
        <TLink className="btn btn-soft btn-sm" to="/connections">
          <Icon name="send" size={14} /> AI connections
        </TLink>
      </Row>
    </Group>
  );
}


/** The firm's templates on this device (never synced). */
function FirmGroup() {
  const templates = useFirmTemplates();
  const learned = useFirmLearned();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const libRef = useRef<HTMLInputElement>(null);
  const count = templates?.length ?? 0;
  return (
    <Group title="Firm checklists">
      <Row label="Firm templates" hint="Checklists and tests from the firm's work-paper templates. Kept on this device only: no sync, no backups, never sent to the AI">
        <button className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>
          <Icon name="upload" size={14} /> {count ? "Import more" : "Import"}
        </button>
        <FirmImport open={open} onClose={() => setOpen(false)} />
      </Row>
      {count > 0 && (
        <Row label={`${count} templates · ${learned?.length ?? 0} checks you added`} hint="Tap to see them">
          <button className="btn btn-ghost btn-sm" onClick={() => setList((v) => !v)}>
            {list ? "Hide" : "Show"}
          </button>
        </Row>
      )}
      {list &&
        templates?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.name}</p>
              <p className="text-xs muted">
                {t.items.length} questions · {learned?.filter((l) => l.templateId === t.id).length ?? 0} added checks
              </p>
            </div>
            <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => void deleteTemplate(t)} aria-label={`Remove ${t.name}`}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      <Row label="Move to another device" hint="Export a file here, import it on your phone or other laptop. Keep the file private">
        <div className="flex gap-2">
          <button className="btn btn-soft btn-sm" disabled={!count && !learned?.length} onClick={() => void exportLibrary()}>
            <Icon name="download" size={14} /> Export
          </button>
          <button className="btn btn-soft btn-sm" onClick={() => libRef.current?.click()}>
            <Icon name="upload" size={14} /> Import file
          </button>
        </div>
        <input
          ref={libRef}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              toast({ message: await importLibrary(f), tone: "success" });
            } catch (err) {
              toast({ message: err instanceof Error ? err.message : String(err), tone: "error" });
            }
          }}
        />
      </Row>
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold uppercase tracking-wide muted">{title}</h2>
      <div className="card divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-xs muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

/**
 * Records left by engagements that no longer exist (RFI copies, a test trial
 * balance…). Lists them per missing engagement; deletes the ticked groups
 * after you confirm, as one undoable action.
 */
function OrphanCleanup() {
  const snap = useSnapshot();
  const tombstones = useLiveQuery(async () => (await db.engagements.toArray()).filter((e) => e.deleted).map((e) => ({ id: e.id, name: e.name })), []);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  if (!snap) return null;
  const groups = findOrphans(snap, tombstones ?? []);
  const total = groups.reduce((a, g) => a + g.records.length, 0);
  const nouns: Record<string, string> = { infoRequests: "RFI items", planItems: "plan steps", programItems: "programme steps", trialBalances: "trial balances", workpapers: "work papers", reviewPoints: "review points", tasks: "tasks", followUps: "follow-ups", timeEntries: "time entries", workstreams: "workstreams" };
  const chosen = groups.filter((g) => picked.has(g.engagementId));
  const n = chosen.reduce((a, g) => a + g.records.length, 0);
  return (
    <>
      <Row label="Clean up" hint={total ? `${total} records belong to engagements that no longer exist` : "No records left from deleted engagements"}>
        <button className="btn btn-soft btn-sm" disabled={!total} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review"}
        </button>
      </Row>
      {open && total > 0 && (
        <div className="space-y-2 px-4 pb-3">
          <p className="text-xs muted">Closed and on-hold engagements are kept. These records point to an engagement that was deleted or never existed on this device. Tick what to delete.</p>
          {groups.map((g) => (
            <label key={g.engagementId} className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] p-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(g.engagementId)}
                onChange={() =>
                  setPicked((s) => {
                    const x = new Set(s);
                    if (x.has(g.engagementId)) x.delete(g.engagementId);
                    else x.add(g.engagementId);
                    return x;
                  })
                }
              />
              <span className="min-w-0">
                <b>{g.formerName ? `“${g.formerName}” (deleted)` : `Unknown engagement …${g.engagementId.slice(-6)}`}</b>
                <span className="block text-xs muted">
                  {Object.entries(g.counts)
                    .map(([t, c]) => `${c} ${nouns[t] ?? t}`)
                    .join(" · ")}
                </span>
                <span className="block truncate text-xs muted">e.g. {g.records.slice(0, 3).map((r) => r.title || "untitled").join("; ")}</span>
              </span>
            </label>
          ))}
          <button
            className="btn btn-sm bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
            disabled={!n}
            onClick={() => {
              if (!confirm(`Delete ${n} records from ${chosen.length} missing engagement${chosen.length === 1 ? "" : "s"}? They're removed on every synced device. You can undo straight after.`)) return;
              void act(`Deleted ${n} leftover records`, async (ctx) => {
                await deleteOrphans(ctx, chosen);
              }).then(() => setPicked(new Set()));
            }}
          >
            Delete {n || ""} selected
          </button>
        </div>
      )}
    </>
  );
}
