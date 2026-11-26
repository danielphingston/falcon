# Falcon: architecture rules

- **One set of AI tools.** Everything an AI can do is a tool in `packages/core/src/tools.ts`, run through `runTool()`. The Gemini chat, the MCP bridge and AI buttons in the app all use these; there are no separate AI code paths.
- **Writes go through actions.** Tools change data only via `create` / `update` / `remove` in `packages/core/src/actions.ts`, so every change is logged and one tool call is one undo batch. Undo is field-level. Every write tool must be covered in `packages/core/test/undoAll.test.ts`.
- **AI proposes, the user decides.** AI callers run tools with `propose: true`: every write becomes a proposal in the Inbox (`proposals.ts`, dry run on an overlay store), applied only when the user accepts in the app (`acceptProposal` refuses any actor but `app`; there is no approve tool). Only the auto-apply types the user ticks (task dates, chase logs) apply directly. Step links from an AI or the matcher are also suggestions until the user confirms them.
- **People resolve when read.** Names typed in sheets ("JK", "A/B", "Team") map to people through names, initials and aliases (`people.ts`); never copy owner ids onto records just to match names.
- **Device-only data stays out of sync and AI.** Firm checklists, private review points and the MCP session log are kept out of `tableNames`: never synced, backed up or sent to an AI.
- **No model fallback.** Gemini calls retry only on the user's chosen model.
- **The bridge only relays.** `apps/bridge` holds no data or tool logic; tools come from the app (it ships a copy of the tool list for before Falcon is open, kept in step by `npm run bridge:tools`). It's Node with no dependencies (no native binary), listens on 127.0.0.1 only, and needs the pairing code.
- **Public repo.** No real client, firm or team names or data in code, tests or docs.

## Working with the user

- **Ask before building when the request is unclear.** If the goal, the expected behaviour, which screen or data is meant, or what "done" looks like isn't clear, ask clarifying questions first, briefly, a few at a time, with options where that helps. Don't guess on anything that changes data, the architecture, or what the user sees.
- **Understand the problem, not just the request.** For a bug or "this isn't working", ask what they did, what they expected and what they saw (a screenshot helps) before changing code. Check the cause in the code or the app rather than assuming.
- **Repeat back larger changes.** For a new feature or a change across several parts, summarise what you understood and the plan, and wait for a yes before starting.
- **Don't ask what you can find out yourself.** Read the code, data or docs first; ask only what's genuinely the user's call.
