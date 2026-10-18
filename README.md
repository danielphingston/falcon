# FDD Tracker

A personal PWA for a CA in Financial Due Diligence: engagements, work papers, review points, IRLs, follow-ups and reminders. It works offline and keeps its data on the device. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phases 0–2 done: local-only tracking, focus timer, timesheet, reports and light gamification (daily ring, streaks, levels, badges, weekly recap). Next phases add Google sync/calendar, Gemini chat and the Claude connector.

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

## Installing on devices

- **Windows (Chrome/Edge):** open the site → install icon in the address bar → Install.
- **iPhone (Safari):** Share → Add to Home Screen. Installing matters on iPhone: it keeps the data from being cleared, and notifications only work for installed apps.

Data lives in the browser's IndexedDB on each device. Until Google Drive sync arrives (Phase 3), use **Settings → Export** for backups and **Import** to move data between devices (imports merge; the newer copy of a record wins).
