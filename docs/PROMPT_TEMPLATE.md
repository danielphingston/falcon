# Prompt template: build a personal work-tracker app with an AI assistant that has undo

This is a reusable prompt for an AI coding agent (Claude Code or similar). It is distilled from how Falcon was built.

**How to use it**

1. Fill in the `{{placeholders}}` in **Part 1**. Leave anything you're unsure about as `{{ask me}}`; the agent will ask.
2. Paste Parts 1–4 into the agent as one message.
3. Answer its discovery questions, approve the plan, then say "Start Phase 0 and Phase 1".

---

## Part 1: The brief (fill in)

```
I want to build {{app type, e.g. "a personal todo / tracker PWA"}} for {{who, e.g. "a friend who is a
Chartered Accountant and team lead in Financial Due Diligence"}}.

What their work looks like:
{{2–6 lines in their words: what they juggle, what falls through the cracks, who they chase, what they review}}

Must-haves I already know:
- {{e.g. assignments, work-paper reviews, client and manager follow-ups, pushing team members}}
- {{e.g. alerts and reminders, calendar sync, time and focus logging}}

Devices: {{e.g. Windows work laptop, iPhone, personal laptop}}
Data and privacy: {{e.g. on-device storage, sync through their own Google Drive, no server}}
Integrations: {{e.g. Google Calendar, Google Drive, a spreadsheet import}}
AI: {{e.g. Gemini via Google sign-in; the chat must be able to do everything the app can, with undo}}
Hosting: {{e.g. GitHub Pages}}
Stack preference: {{e.g. React + Vite + TypeScript, or "your call"}}
Feel: {{e.g. well animated, page transitions, confetti on completion, light gamification}}
```

---

## Part 2: How to gather information from me (discovery)

```
Before writing any code, run a short discovery and then write a plan. Follow these rules.

1. Ask questions in rounds of at most 4. Each question should be multiple choice with 2–4 concrete
   options plus "Other". Put your recommendation first and mark it "(Recommended)". Use multi-select
   when the answers aren't exclusive. Keep each question self-contained, because I may only see the
   question dialog.
2. Ask only what changes the design. Don't ask about things with a sensible default: pick the
   default and tell me.
3. Cover these topics, skipping any the brief already answers:
   - Who uses it (only them, or a team?), and their role and seniority.
   - Devices, and whether it must work offline.
   - Where data lives (on-device, own cloud drive, server) and how it syncs between devices.
   - The core objects and how they nest (e.g. Engagement → Workstream → Task / Work paper /
     Review point / Info request / Follow-up). Ask for their vocabulary and use it everywhere.
   - The follow-up and chase types, and how often to nudge each (client, manager, team member).
   - What the home screen should show first (e.g. a Today dashboard: overdue, due today,
     chases due, reviews waiting).
   - Notifications and alerts, and the calendar (which provider; what goes on it; timed vs
     all-day items).
   - Time, focus and gamification: what to count, and how much is too much for a professional.
   - Imports: the formats they already have (e.g. a team allocation Excel or a Tally trial
     balance). Ask for a sample, but never commit their real file or real names. Build
     fictional samples instead.
   - AI: which provider, how it signs in (OAuth vs API key), paid tier or free, and what the chat
     must be able to do.
   - Hosting, deployment and who owns the accounts.
4. When a request arrives as a pasted idea or spec, restate it in 3–5 bullets, ask the 2–4
   questions that matter, then build.
5. After discovery, write PLAN.md:
   - goals and non-goals;
   - the data model;
   - phases (Phase 0 = skeleton + data layer; then one user-visible capability per phase);
   - for each phase, what "done" looks like and how it will be tested;
   - open questions.
   Then stop and wait for my approval. If I say "I want to change some things in the plan",
   ask what, update PLAN.md, and wait again.
6. During the build, when a new requirement arrives, decide whether it's a change to the current
   phase or a new phase. Say which, then proceed.
```

---

## Part 3: Architecture rules (so the AI can do everything, with undo)

```
Structure the code so the screens, the in-app AI chat and any external connector (MCP) all go
through exactly the same actions.

A. Shared core package (no UI):
   - Schemas for every table (zod), with types inferred from them. Records get id, createdAt,
     updatedAt and a soft-delete flag.
   - A Store interface (list, get, put, putChange, listChanges, getSettings, transaction) with
     two implementations: IndexedDB (Dexie) for the app and in-memory for tests.
   - Actions: create, update, remove and the domain helpers (e.g. logChase, setTaskDone). EVERY
     mutation goes through an action. Each action writes a Change record
     {id, seq, batchId, table, before, after, by: "app" | "chat" | "connector", undone}.
   - Undo works by batch: undoBatch(store, batchId) restores each record's `before`, newest
     first, and marks the changes undone. A record created by the batch is soft-deleted.
   - Pure logic (today view, quick-add parser, reports, merge for sync) lives here too, with
     unit tests.

B. In the web app, an act(message, fn) wrapper:
   - Runs fn(ctx) in one transaction with a fresh batchId.
   - Shows a toast with an Undo button that calls undoBatch.
   - Schedules a sync, and fires a celebration (confetti) when something got finished.
   Every button in the UI calls act(); nothing writes to the database directly.

C. Provider-neutral AI tools (core/tools.ts):
   - Each tool is { name, description, input: zod schema, kind: "read" | "write" | "confirm",
     run(ctx, input) }. Handlers call the same actions as the UI.
   - Arguments accept human names, not only ids (e.g. "engagement": "Falcon", "person": "Rahul"),
     resolved by fuzzy matching; ambiguous matches return an error that lists the candidates.
   - runTool(ctx, name, args) validates the input, gives the call its own batchId, runs it in a
     transaction, and returns { ok, result | error, batchId }.
   - Cover everything the app can do: get_today, search, create_* and update_* per table,
     bulk adds (e.g. add_irl_items from a pasted email), log_time, reports and stats,
     domain-specific reads (e.g. get_work_programme), delete_item and undo_last.
   - delete_item is kind "confirm". Without confirmed: true it returns a preview of what would be
     deleted. The model must ask the user and only call again with confirmed: true after a clear
     yes.
   - Adapters convert the registry to each provider's format (Gemini function declarations, MCP
     tools, Claude tool definitions). They never reimplement logic.

D. The chat loop:
   - turn(history, userParts): stream the model → run any tool calls with runTool → send the
     results back → repeat until the model replies with text (max ~8 steps; stop on abort).
   - The UI shows each tool call as its own card: what it did, an "Undo" button bound to that
     call's batchId, and a celebration for completions. The chat never asks "shall I add it?"
     before ordinary adds; undo is the safety net.
   - After the user presses Undo on a card, append to the history: "(The user pressed Undo on
     your <tool> call; that change was reverted.)" so the model doesn't assume it still exists.
   - Attachments (images, PDFs, pasted text) go in as inline parts: e.g. turn a screenshot of a
     client email into info-request items in one call.
   - Save the chat history on the device; drop bulky attachment data from older turns.

E. System prompt, rebuilt every turn from live data:
   - Who the user is, their profession and vocabulary (e.g. QoE, NWC, WP, IRL, "chasing").
   - Today's date, the local time and the working days. Turn relative dates and times into
     exact values.
   - A short index of live records with ids (engagements, people), so the model doesn't
     search every turn.
   - Rules: never invent ids; ask one short question when ambiguous; confirm changes in 1–2
     lines; deletes need a confirm; plan-my-day recipe; short answers with simple Markdown.
   - Domain guidance per feature (e.g. timed items become calendar events with a time and
     duration; how to import a team allocation sheet; how to suggest further review
     procedures).

F. Focused AI features inside screens (not only in the chat):
   - Use one-shot JSON calls (e.g. responseMimeType "application/json") with a prompt built
     from the screen's context, parsed tolerantly (strip code fences; ignore malformed items).
   - Always have an offline fallback that works without AI (e.g. related checks from a
     procedure library). Show it at once, and add the AI results when they arrive, marked "AI".
   - Store AI suggestions on the record (with source and status: open, added, dismissed), so
     they sync and don't need regenerating.
   - Every suggestion card has actions that go through act() (e.g. "Add as review point",
     "Add to programme", "Dismiss"), so they are undoable too.
   - Example: when the user writes a review point, challenge it with 2–4 "Have you also
     checked X?" questions, each with a one-line reason, grounded in the work paper, the
     balances and trend flags, the other points, and the steps already reviewed.

G. Credentials and errors:
   - OAuth from the browser (no server, no secret). Handle Safari/iOS with the redirect flow
     instead of pop-ups. API keys, if any, stay on the device and are never included in
     backups or sync.
   - Turn API errors into one-sentence fixes ("Your Google session expired. Tap Reconnect",
     "The Generative Language API isn't enabled in your project…").
```

---

## Part 4: How to work

```
- Build phase by phase. After each phase: unit tests for the core logic, a typecheck and a
  production build. Then run the app in a browser and check the feature for real (click
  through it; read the console and network). Report what you verified and what you couldn't.
- Use fictional sample data everywhere (demos, videos, tests). Add "Settings → Sample data →
  Load" with undo.
- Keep README.md (setup, deploy, Google Cloud steps) and docs/USER_GUIDE.md (how to use each
  feature) current in the same commit as the feature.
- Commit locally after each phase with a clear message. Never push, deploy or change cloud
  settings without asking me first. Before pushing, fetch and merge what's on the remote. If a
  database schema version was already deployed, add a new version instead of editing it.
- When I ask for something big, propose the smallest version that's useful first, then build
  on it.
```

---

## Example: the discovery round used for Falcon

| Question | Options (recommended first) |
|---|---|
| Which calendar should reminders and due items go to? | Google Calendar (Recommended) · Outlook · None, in-app only |
| Where should the data live? | On the device, with sync through their own Google Drive (Recommended) · A hosted database · Device only |
| How is the work organised? | Engagement → Workstream → Task (Recommended) · Flat projects and tasks · Clients → Projects |
| What should the home screen show first? | A Today dashboard: overdue, due, chases, reviews (Recommended) · The engagement list · Calendar |
| Which AI provider? | Gemini via Google sign-in (Recommended) · Gemini API key · Claude through a connector · Both |

Typical follow-up rounds were about: follow-up types and nudge frequency, the focus timer and gamification, the hosting choice, the import file format, comparatives in the trial balance, engagement types and industries.
