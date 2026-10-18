# FDD Tracker

A personal PWA for a CA in Financial Due Diligence: engagements, work papers, review points, IRLs, follow-ups and reminders. It works offline and keeps its data on the device. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phases 0–3 done: tracking, focus timer, timesheet, reports, light gamification, plus Google Drive sync and Google Calendar (reminders, key dates, due dates, focus blocks, today's agenda). Next: Gemini chat and the Claude connector.

## Run it

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core unit tests
npm run build      # production build in apps/web/dist
npm run preview    # serve the production build (service worker enabled)
```

To look around quickly: **Settings → Sample data → Load**. Undo removes it again.

## Layout

```
apps/web        React + Vite PWA (Dexie/IndexedDB, Tailwind, motion, View Transitions)
packages/core   Data model (zod), actions + undo, Today view, quick-add parser,
                IRL table/email helpers, merge for backup/sync, provider-neutral AI tools
```

The screens and the future AI chat/connector call the same actions in `packages/core`, so they behave the same way: everything they change goes into the change log and can be undone.

## Quick-add syntax

| Type | Example |
|---|---|
| Task | `Draft NWC section #Falcon !+2 !!` (due in 2 working days, high priority) |
| Follow-up | `Chase @Rahul TB FY24 #Falcon !fri` |
| IRL item | `irl #Falcon Fixed asset register` |

`@person` (unknown names become new contacts) · `#engagement` · `!today` `!tom` `!fri` `!+3` `!25/10` `!eow` · `!!` high priority · multi-word names with underscores: `@Rahul_Mehta`.

Shortcuts on laptop: `N` new task, `/` focus quick add.

## Deploy

**Netlify:** build command `npm run build`, publish directory `apps/web/dist`. SPA routing is handled by `public/_redirects`.

**GitHub Pages (project site):** build with the repo path as base, then publish `apps/web/dist`:

```bash
BASE_PATH=/your-repo/ npm run build
```

Also copy `dist/index.html` to `dist/404.html`, so deep links work on Pages.

## Google setup (sync + Calendar)

The app talks to Google straight from the browser, so it only needs an **OAuth client ID**. There's no secret and no server. This is a one-time setup, about 10 minutes.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. "FDD Tracker").
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Calendar API**.
3. **Google Auth Platform → Branding**: app name "FDD Tracker" plus a support email.
   **Audience**: User type *External*, publishing status *Testing*. Under **Test users**, add the Gmail address(es) that will use the app.
   **Data access**: add the scopes `.../auth/drive.appdata` and `.../auth/calendar.events`.
4. **Clients → Create client → Web application**. Under **Authorized JavaScript origins**, add every place the app runs:
   - `http://localhost:5173` (dev) and `http://localhost:4173` (preview)
   - your hosted URL, e.g. `https://fdd-tracker.netlify.app`

   No redirect URI is needed.
5. Copy the **Client ID**. Then do one of these:
   - put it in `apps/web/.env.local` as `VITE_GOOGLE_CLIENT_ID=…` before building (see `.env.example`), or
   - paste it into **Settings → Google sync & Calendar** in the app.

Then tap **Connect Google account**. Things to expect:

- In *Testing* mode, Google shows an "app isn't verified" screen. Choose **Continue**. That's normal for a personal app, and only listed test users can sign in.
- Access tokens last about an hour, and browsers can't refresh them silently. When one expires, the sync chip shows **Reconnect Google**; one tap fixes it. Your data stays on the device in the meantime.
- Data goes to a hidden *appDataFolder* in the user's own Drive. Only this OAuth client can read it, and it never appears in the Drive UI.
- Calendar events the app creates are tagged, so it only updates or removes its own events. It never touches anything else. Focus blocks you schedule are left alone after that.

## Installing on devices

- **Windows (Chrome/Edge):** open the site → install icon in the address bar → Install.
- **iPhone (Safari):** Share → Add to Home Screen. Installing matters on iPhone: it keeps the data from being cleared, and notifications only work for installed apps.

Data lives in the browser's IndexedDB on each device. Connect Google (above) to sync between devices. Without Google, use **Settings → Export** for backups and **Import** to move data between devices (imports merge; the newer copy of a record wins).
