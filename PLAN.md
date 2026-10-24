# Falcon — Plan

A personal PWA for a Chartered Accountant working in Financial Due Diligence (FDD) to run his day: engagements, work papers, review points, client info requests, follow-ups, alerts, calendar, time and focus. He can also run it entirely by chatting with Claude.

## 1. Decisions so far

| Area | Decision |
|---|---|
| Users | Single user (him). Clients, managers and team are *contacts*, not app users |
| Devices | Work laptop (Windows), personal laptop, iPhone |
| Storage | Local-first: IndexedDB on each device |
| Sync | His own Google Drive, in the hidden `appDataFolder`. No backend of ours for the app itself |
| Calendar | Google Calendar: reads today's events, writes deadlines, focus blocks and alerts |
| Alerts | In-app notifications while the app is open, plus Google Calendar reminders for anything that must fire when the app is closed |
| Structure | Engagement → Workstream → Task / Work paper |
| Home | "Today" dashboard |
| AI chat | **In-app chat:** Gemini API, paid tier, using his own AI Studio key. **Plus:** a Claude MCP connector, so he can also chat from the Claude app on his subscription |
| Chat changes | Adds and updates apply straight away, with an Undo option. Deletes, bulk edits and calendar writes ask him to confirm first |
| UX | Animated page transitions (View Transitions API), motion on lists and cards, confetti when things get done |
| Stack | React + Vite + TypeScript, `vite-plugin-pwa` |
| Hosting | PWA on GitHub Pages or Netlify. Connector on Cloudflare Workers (free tier) |

### Why alerts go through Google Calendar
A PWA without a push server can't reliably fire notifications while it's closed, and iPhone is the strictest about this. Google Calendar already pushes reminders to every device. So a "remind me at 4pm to chase the TB" alert becomes a calendar event with a popup reminder, and we don't run a server.

### Why there are two AI entry points
- **In-app chat (Gemini):** a chat inside the PWA, with our own animations, confirm cards, voice input and attachments. It calls the Gemini API straight from the browser using his own Google AI Studio key, with billing enabled. On the **paid tier**, Google doesn't use prompts to improve its products. That matters because he'll be talking about client work
- **Claude connector (MCP server):** a Claude Pro/Max subscription can't be used inside third-party apps. But he can add our connector to his Claude account and chat from the Claude app on his iPhone or laptop, e.g. "Add IRL items from this screenshot to Falcon" or "What do I need to chase today?". This is covered by his subscription

Both use the **same provider-neutral set of tools** (section 5), defined once in shared code.

## 2. Domain model

```
Person        name, role (client | manager | partner | team | other), org, email, phone
Engagement    code name ("Project Falcon"), target/client, side (buy | sell), status,
              key dates (kick-off, data room, draft report, final), timesheet code, notes
Workstream    engagement, name (QoE, NWC, Net debt, Tax, Payroll, Custom…), owner(Person)
Task          engagement?, workstream?, title, due, priority, status, assignee(Person|me), tags
WorkPaper     workstream, ref ("B.2"), title, my role (preparer | reviewer),
              preparer(Person|me), reviewer(Person|me),
              status: Not started → In progress → Prepared → In review → Points raised → Cleared → Final
ReviewPoint   workpaper, raised by, assigned to, text, status (open | addressed | cleared), dates
InfoRequest   engagement, IRL #, description, requested from(Person), requested on, due,
              status (pending | partial | received | n/a), chase log [dates], next chase date
FollowUp      person, about (free text + link to any item), type (client | manager | team),
              due, next nudge date, nudge log, status (waiting | done)
TimeEntry     date, engagement, task?, minutes, source (timer | manual | chat), note
Alert         linked item, fire at, channel (in-app | calendar), calendar event id
ChangeLog     who (app | connector | in-app chat), action, before/after, timestamp  → powers Undo + points
Stats         points, level, current/best streaks, freezes left this week
Achievement   badge id, earned at
```

Every record has `id`, `createdAt`, `updatedAt`, `deleted` (a tombstone) and `updatedBy`. Sync needs these.

The "follow up" requirements map onto the model like this:
- **Clients** → `InfoRequest` (IRL) plus `FollowUp` (type client)
- **Managers** → `FollowUp` (type manager), e.g. sign-off, draft comments, decisions
- **Team** → `Task` assigned to a team member, plus `FollowUp` (type team)
- **Review completed WPs** → `WorkPaper` where my role = reviewer, plus `ReviewPoint`
- **Own execution** → `WorkPaper` where my role = preparer. Points raised on his own WPs show up as things to fix

## 3. Screens

1. **Today** (home)
   - Overdue / due today (tasks, WPs, IRL items)
   - **Chase today**: IRL items and follow-ups whose next chase date ≤ today, grouped by person
   - **To review**: WPs in *Prepared / In review* where I'm the reviewer
   - **Points to clear**: open review points on my own WPs
   - Today's Google Calendar events
   - Hours logged today, plus a running timer if one is active
   - Quick-add bar
   - "Recent AI changes" strip (from Gemini chat or the Claude connector), with Undo
2. **Engagements**: list with status and next key date → detail page with tabs: Overview · Workstreams · Work papers · Review points · IRL · Follow-ups · Time
3. **Follow-ups**: a "Waiting on" inbox across all engagements, grouped by person. Shows days waiting and number of chases
4. **Review**: every WP I review and every WP I prepare, by status, with review point counts
5. **Time**: focus timer (25/50 min or custom, linked to a task), day log, weekly timesheet grid (engagement × day), "Copy for timesheet" button
6. **Reports**: daily and weekly summaries (done, overdue, hours per engagement, longest-waiting follow-ups), with copy/print
7. **Chat** (Gemini): a full-screen chat, plus a floating chat button on every screen
8. **Settings**: Google connect, sync status and "sync now", Gemini access (Google sign-in) + model picker, Claude connector setup guide, notification permission, working days, default chase interval, animations and confetti on/off, gamification on/off + daily ring targets, export/import JSON, theme

### Small features that matter for FDD
- **One-tap "Chased"**: logs today in the chase log and moves the next chase date ahead by N working days (default 2)
- **Copy IRL status**: copies a clean table of pending/partial items, ready to paste into a client email
- **Draft a chase email**: opens `mailto:` with the subject and pending items filled in. He reviews and sends it himself
- **Quick-add syntax**: e.g. `Chase @Rahul TB FY24 #Falcon !fri` → follow-up for Rahul on Falcon, due Friday
- **Keyboard shortcuts** on laptop: `n` new, `/` search, `t` timer, `c` chat, `g t` go to Today
- **Code names**: engagement names are free text, and code names are encouraged (confidentiality)

## 4. UX, motion and delight

**Page transitions**
- The View Transitions API (Chrome/Edge 111+, Safari 18+), using React Router's `viewTransition` on links and navigations
- **Shared-element morphs**: an engagement card grows into its detail page header, and a WP row grows into the WP sheet (`view-transition-name` per item)
- Direction-aware slides: going deeper slides left, going back slides right. Tab switches crossfade
- Older browsers just get no animation, and nothing breaks

**Micro-interactions** (the `motion` library, formerly Framer Motion)
- Lists animate items in and out, and re-sort smoothly when a status changes
- Swipe actions on iPhone: swipe right = done / chased, swipe left = snooze
- The checkbox draws a tick, and the row strikes through and slides into "Done"
- Spring-animated bottom sheets for add/edit on mobile, and a side panel on laptop
- Skeleton shimmer while sync is running, and a sync icon that pulses
- An Undo snackbar slides up after every change, including changes made from chat
- Chat: streaming text, "Claude is working…" chips for each tool call, and confirm cards that expand in place

**Confetti** (`canvas-confetti`, about 6 KB)
| Event | Effect |
|---|---|
| Task / follow-up done | Small burst from the checkbox |
| Review point cleared | Small burst |
| Work paper → Final | Medium burst |
| All IRL items for an engagement received | Big burst + "IRL complete" toast |
| Everything due today done | Full-screen shower + "Day cleared" card |
| Engagement closed | Fireworks |

**Rules**
- Respect `prefers-reduced-motion`. There's also a Settings toggle for motion and confetti
- Animate only `transform` and `opacity`, and keep most transitions around 200–300 ms so the app still feels fast
- Changes made through the Claude connector also get confetti the next time the app syncs ("3 items completed via Claude 🎉")

### Light gamification
Kept small and professional. The aim is to reward **clearing work and staying on top of follow-ups**, not hours logged, so it never nudges him toward overwork. Everything can be turned off in Settings.

**Daily ring** (top of Today)
- One ring with three segments: **Due items done** · **Chases sent** · **Focus sessions**. Targets are set in Settings (e.g. 100% of due items, all chases due today, 3 focus blocks)
- The ring fills with an animation as he works. Closing it fires the "Day cleared" confetti

**Streaks**
- 🔥 **Day streak**: consecutive working days with the ring closed. Weekends and holidays (from the working-days setting) don't break it
- 📨 **No-overdue-chases streak**: days with no chase left overdue
- One **streak freeze** per week, for leave or a heavy travel day, so a single bad day doesn't wipe out weeks of progress

**Points & levels**
- Small, fixed points: task done +5, chase sent +3, review point cleared +5, WP → Final +20, IRL complete +30, focus block +10
- Levels named after the FDD career ladder: *Article Assistant → Associate → Senior → Assistant Manager → Manager → AVP → Director → Partner*. A level-up gets a card with a short animation
- No points for logging time, and no penalties. Points only go up

**Badges** (a small set, each unlocked once)
| Badge | How to earn it |
|---|---|
| First Close | First engagement marked closed |
| IRL Zero | All IRL items received on an engagement |
| Clean Sheet | A WP cleared with zero review points |
| Reviewer's Eye | 50 review points raised on WPs you review |
| Chaser | 100 chases logged |
| Deep Work | 10 focus sessions in a week |
| Early Bird | Ring closed before 1pm |
| Deal Season | 5 engagements running at once |
| Iron Streak | 20-day streak |

**Weekly recap** (Monday morning, a card on Today)
- Last week's points, streak, badges earned, items cleared, longest wait finally resolved, and "best day"
- The Gemini chat can expand on it: "How did last week go?"

**Data & sync**
- A new `Stats` record (points, level, streaks, freezes left) and an `Achievement` record (badge id, earned at). Both sync through Drive like everything else
- Points are **calculated from the `ChangeLog`**, not stored per action. That keeps them consistent across devices and makes Undo remove the points too
- AI tool `get_stats` lets Gemini or Claude answer "what's my streak?"

## 5. AI integration

### Shared tool layer (`/packages/core/tools`)
One set of typed, provider-neutral tool definitions (zod schemas → JSON Schema) and handlers that work on the data model. A small adapter turns them into Gemini function declarations for the in-app chat, and into MCP tools for the Claude connector. That way, switching or adding a model provider later only means writing a new adapter.

| Tool | Purpose |
|---|---|
| `get_today` | Today's briefing: overdue, due, chases, reviews, calendar, hours |
| `search` | Find engagements, tasks, WPs, IRL items, people by text or filters |
| `create_task`, `update_task` | Add or edit tasks |
| `create_workpaper`, `update_workpaper_status` | Track WPs as preparer or reviewer |
| `add_review_points`, `update_review_point` | Review notes, in bulk |
| `add_irl_items`, `update_irl_item`, `log_chase` | Client info requests, in bulk (e.g. from a pasted screenshot or email) |
| `create_followup`, `log_nudge` | Follow-ups with managers, team and clients |
| `log_time` | Log time against an engagement or task |
| `create_alert` | A reminder (in-app, plus a calendar event when Google is connected) |
| `create_engagement`, `add_person` | Setup |
| `weekly_report` | Hours, completions, overdue, longest waits |
| `get_stats` | Points, level, streaks, badges |
| `undo_last` | Revert the last change the AI made |
| `delete_item` | **Asks him first** |

Rules: bulk tools take arrays, so pasting 20 IRL items is one call. Every write goes into `ChangeLog` so it can be undone. Deletes and bulk changes return a confirmation request instead of applying straight away.

### In-app chat: Gemini API
- Authenticates with the user's Google sign-in (OAuth scope `generative-language.retriever`); no API key. Usage is billed to the OAuth client's Google Cloud project, which needs the Generative Language API and billing enabled
- Calls go straight from the browser using Google's official `@google/genai` JS SDK. Streaming responses, with function calling running in a client-side loop against the local DB
- Model: the current Gemini **Flash** model for quick chat and tool calls, plus a **Pro** option in a Settings model picker. Pick the exact model IDs at build time from Google's current model list
- System instruction: FDD vocabulary (IRL, QoE, NWC, WP refs), today's date and working days, and the confirm rules
- Voice input via the Web Speech API. Paste or attach screenshots and PDFs (sent as inline image/PDF parts). A "Plan my day" button that calls `get_today` and suggests an order of work
- Context caching for the system instruction + tool declarations, if usage gets high enough to be worth it

### Claude connector (uses his Claude subscription)
- **Runs on:** a Cloudflare Worker (free tier), as a remote MCP server (Streamable HTTP)
- **Login:** OAuth. The Worker acts as the OAuth server for Claude and passes the login through to Google, using the same Google Cloud OAuth client as the PWA so it can open the same `appDataFolder` file. Only his Google account is allowed in
- **Data:** each tool call loads `fdd-tracker.json` from Drive, applies the change with the same per-record merge the app uses, and writes it back (retrying if the file changed in between). The PWA sees the change on its next sync, or on focus
- **Setup:** in Claude, Settings → Connectors → Add custom connector → paste the Worker URL → sign in with Google
- **Server instructions:** a short system note telling Claude about FDD terms (IRL, QoE, NWC, WP refs) and the confirm rules
- **Limitation:** if the Drive copy is encrypted with a passphrase, the connector can't read it. So encryption has to be off while the connector is in use. Code names reduce what's exposed. (The Gemini chat works on local data, so encryption doesn't affect it)

## 6. Technical design

**Repo layout** (monorepo with npm workspaces)
```
apps/web        React PWA
apps/connector  Cloudflare Worker MCP server
packages/core   data model, zod schemas, merge/sync logic, tool handlers, date/working-day utils
```

**Libraries**
- `react`, `react-router` (View Transitions support), `typescript`, `vite`
- `vite-plugin-pwa` (Workbox): offline app shell, install prompt, update toast
- `dexie` + `dexie-react-hooks`: IndexedDB with live queries
- `motion`, `canvas-confetti`
- `@google/genai`: Gemini in-app chat
- `date-fns`, `zod`
- UI: Tailwind CSS, light/dark
- Connector: `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`
- `vitest`: tests for the sync merge, chase-date math, quick-add parser and tool handlers

**Google integration**
- Google Identity Services, token model. Scopes: `drive.appdata`, `calendar.events`, `calendar.readonly`
- Access tokens last about 1 hour and there are no refresh tokens in the browser. The app asks for a new token when needed, which is usually silent and sometimes a popup. The connector does get a refresh token, held by the Worker
- The OAuth app stays in **Testing** mode with his Gmail added as a test user, so Google verification isn't needed. In Testing mode Google refresh tokens expire after 7 days, so he'll re-sign-in to the connector about once a week. To avoid that, the app can be published (verification may be needed for these scopes)

**Sync**
- One file, `fdd-tracker.json`, in `appDataFolder`
- Sync on app open, on window focus, after changes (debounced), and with a manual "Sync now"
- Merge is per record: the newer `updatedAt` wins, and tombstones carry deletes. The PWA and the connector share the same merge code
- Optional AES-GCM encryption (PBKDF2 passphrase). It can't be used together with the connector (see 5A)

**Alerts**
- In-app: the Notification API plus in-page toasts, checked every minute while the app is open
- Calendar: when an alert is set, the app creates an event with a popup reminder, and updates or deletes it if the item changes. On iPhone he needs the Google Calendar app (or iOS Calendar with his Google account) for these reminders

**iPhone notes**
- He must "Add to Home Screen". Installed PWAs keep their storage, but plain Safari tabs can have site data cleared after about 7 days of not being used
- Call `navigator.storage.persist()` and keep Drive sync on as the backup

## 7. Build phases

**Phase 0: Setup & motion foundation**
Monorepo, Vite + React + TS, Tailwind, router with View Transitions, `motion`, design tokens, Dexie schema, PWA manifest, icons, offline shell, deploy pipeline.

**Phase 1: Core tracking (MVP, local only)**
People, Engagements, Workstreams, Tasks, Work papers, Review points, IRL, Follow-ups. Today dashboard, quick add, "Chased" button, copy IRL table, JSON export/import, in-app notifications, confetti, Undo snackbar. Tool handlers written in `packages/core` from the start, so the screens and Claude use the same code.

**Phase 2: Time & focus**
Focus timer (survives reloads), manual time entries, weekly timesheet grid, copy-for-timesheet, daily/weekly reports. Gamification: daily ring, streaks + freezes, points & levels, badges, Monday recap.

**Phase 3: Google**
Sign-in, Drive appData sync, today's calendar on the dashboard, push deadlines and focus blocks to the calendar, calendar-backed alerts.

**Phase 4: Gemini in-app chat**
Gemini key + model picker in Settings, Gemini adapter for the shared tools, chat screen + floating button, streaming, tool-call chips, confirm cards, Undo, voice, screenshot/PDF attach, "Plan my day". This can start right after Phase 1, because it only needs local data.

**Phase 5: Claude connector (subscription)**
Cloudflare Worker MCP server, Google OAuth pass-through, MCP adapter for the shared tools, "Recent AI changes" on Today, setup guide.

**Phase 6: Polish**
CSV paste-import for IRLs, keyboard shortcuts, search, swipe gestures, onboarding guide for the handover, optional encryption (for people who don't use the connector).

## 8. Handover checklist
- Google Cloud project + OAuth client (web), with the PWA domain and the Worker callback URL listed. His Gmail added as a test user
- Hosted PWA URL, plus install steps for Windows (Chrome/Edge → Install app) and iPhone (Safari → Share → Add to Home Screen)
- Connector URL + steps to add it in Claude → Settings → Connectors
- How to enable the Generative Language API and billing in the Google Cloud project, add the Gemini OAuth scope, and set a budget alert
- A one-page user guide in the app (Settings → Help), including example chat prompts

## 9. Open questions for your friend
1. **Firm policy**: is he allowed to keep client and engagement info in a personal app, his personal Google Drive, **and send it to AI services (Gemini, Claude)**? Code names help. He should check, especially before pasting client documents into chat
2. Which Claude plan is he on (Pro / Max)? Custom connectors need a paid plan. And is he OK paying for Gemini API usage (usually small for chat; a Google Cloud budget alert caps surprises)?
3. Typical workstreams, so we can pre-load templates (QoE, NWC, Net debt, Tax, …?)
4. What are his WP reference conventions (e.g. `A.1`, `B.2.3`)?
5. What does the firm's timesheet tool want: hours by engagement code per day, in what increments (0.25h / 0.5h)?
6. Working days: is Saturday a working day? Should public holidays be skipped for chase dates?
7. Default chase interval for clients vs. managers vs. team?
8. Does he want alerts on the work laptop's calendar too, or only on his phone?
