# Falcon: User Guide

## What it is

Falcon is a personal work tracker for a financial due diligence team lead. It holds your engagements, information requests (IRLs), work papers, review points, follow-ups, calendar and time. It works offline and keeps your data on your own devices.

Live link: https://danielphingston.github.io/falcon/

## Install it

- **iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Windows (Chrome or Edge):** open the link, click the **install** icon in the address bar, then **Install**.

The home-screen app keeps its own data. To sync it with your other devices, open **Settings** in that app and sign in to Google.

## First steps

1. **Explore with sample data.** Go to **Settings**, scroll to **Data**, and tap **Load** next to **Sample data**. Then open **Today**.
2. **Undo.** After most changes a toast appears at the bottom with an **Undo** link. Tap it to reverse the change. To remove the sample data, tap **Undo** straight after loading it.
3. **Your name and working week.** In **Settings**, enter **Your name** under **You**. Under **Working week**, pick your **Working days** and enter any **Holidays**. Chase dates skip non-working days.

## Today

**What it's for:** your home screen. It shows what is overdue, due, to chase and waiting for your review.

**How to**

1. Read the counters at the top: overdue, due today, to chase, to review, done today.
2. Work down the sections, in this order: **Overdue** (tasks, review points you owe and follow-ups past their date), **Due today**, **Waiting for my review**, **Chase today**, **Assign a contact**, **Unlocked since yesterday** (work plan steps that became ready or can start because RFI items came in), **Review points I owe**, then **Past meetings**, reminders and the calendar.
3. **Carried tasks.** An open task from an earlier day stays on Today, marked **Carried**. Tap **Move to today** to give it today's date (its calendar event moves too; no second event is made). Meetings and calls from an earlier day aren't carried: they show under **Past meetings** for you to tick off or re-date. Two reminders with the same text show once.
4. Tick a checkbox to mark a task done.
5. Tap **Chased** to log a chase. The next chase date is set for you. If a group has several items, tap **Chased all**.

## Quick add

**What it's for:** capturing a task, follow-up or IRL item in seconds. It sits at the top of Today and on each engagement's Tasks tab. Type a line, watch the chips above the box, then press **Enter** or **Add**.

| You type | What it does | Example |
|---|---|---|
| `@name` | Assigns to a person. Unknown names become new contacts. | `@Rahul` |
| `#engagement` | Links to an engagement. | `#Falcon` |
| `!today` `!tom` `!fri` `!eow` | Sets a due date. | `!fri` |
| `!+2` | Due in 2 working days. | `!+2` |
| `!25/10` | Due on a specific date. | `!25/10` |
| `!tom@3pm` or `at 3pm` | Sets a time. A task with a time also goes to Google Calendar. | `!tom@3pm` |
| `!!` | High priority. | `Draft NWC section !!` |
| Starts with `chase` or `follow up` | Creates a follow-up. | `Chase @Rahul TB FY24 #Falcon !fri` |
| Starts with `irl` | Creates an IRL item (needs `#engagement`). | `irl #Falcon Fixed asset register` |
| `@Rahul_Mehta` | Multi-word names use underscores. | `@Rahul_Mehta` |

On a laptop, press `N` for a new task or `/` to focus quick add.

## Engagements and importing your team allocation

**What it's for:** your assignments, with open tasks, IRLs, review points and work papers on each card.

**How to**

1. Tap **New** to create an engagement by hand.
2. Or tap **Import** and choose your team allocation sheet (`.xlsx` or CSV). It needs an **Assignments** sheet and can include a **Members** sheet.
3. Check the preview. It counts **New**, **Updated** and **New people**, and lists each assignment with its lead.
4. Under **Which name in the sheet is you?**, pick your name. Tick **Also set my name in the app** if you want.
5. Tap **Import**. The whole import is one undoable batch.

The file is read on your device only. Importing again later **updates** existing engagements instead of duplicating them.

## Inside an engagement

**What it's for:** everything for one assignment, in tabs: **Overview**, **Tasks**, **Work papers**, **Review points**, **IRL**, **Follow-ups**, **Time**.

**How to**

1. **Overview:** check the **Team**, **Key dates** and **Workstreams**. Use **Add** to add a workstream.
2. **Tasks:** add work with the quick add bar. Use **Show done** to see completed items.
3. **Work papers:** filter with **All**, **I prepare** or **I review**, then tap **+ Work paper**.
4. **Time:** tap **Log time** to add an entry.
5. When the assignment finishes, tap **Close engagement** on Overview. **Reopen engagement** undoes it.

## RFI (requests to the client) and chasing

**What it's for:** an internal copy of the RFI you sent the client, so you can track what has come in, chase what's missing, and email the client in one go.

**Import the RFI you sent**

1. Open the engagement's **RFI** tab and tap **Import RFI**. Choose the Excel file you sent to the client.
2. Falcon finds the request table (Sl No / Particulars / Date of request / Status / Annexure / Remarks / Date received / Person responsible / EDR / Auditee comment) and shows a preview: the number of requests and sections, and how many are pending or received.
3. Choose **Requested from** for requests whose "Person responsible" isn't one of your contacts, then tap **Import**.
4. Requests are grouped by section (Generals, Trade Payables…) and numbered 1.1, 1.2 … 1.10. Sub-points ("- Sanction letter") stay with their request. The annexure, the client's comments, the person responsible and the expected date (EDR) show on each request; your remarks go into its notes.
5. When the client sends the RFI back with updates, tap **Update from RFI** and choose the new file. Matching requests are updated (status, dates, comments); new ones are added; your chase history is kept. Nothing is duplicated.

**Which status column, and what the words mean.** Many IRLs have the firm's status and the client's side by side ("V&S Status" and "Status Acme", or "Status of Input" and "Widgetco Status"). Falcon uses the firm's column and keeps the client's as information. The preview shows the choice per sheet (**Status: Finance → V&S Status · Change**); pick another column, or none, if it guessed wrong. It also lists every status word it found with what it maps to: Received → received; Partially received → partial; To be received / Pending / Shared → pending; Not applicable / Not available → N/A. A word it doesn't recognise is listed for you to map instead of being guessed. A blank status never changes an item. Your choices are remembered for the next version of this engagement's IRL.

**Item numbers** are read as Excel shows them, so 5.10 stays 5.10 (not 5.1) and 1.2 never becomes 1.2000000000000002. If two rows carry the same number, the second is renumbered and the preview warns you.

**Layouts it reads.** Columns are found by their headers, so the firm's different trackers work: "Sl No / Particulars / Status", or "Sl No / Area / File No / Particulars (or Checklist) / Criticality / Date of request / Status (of input) / Date of input / POC or Parties / Annexure / Folder link / Remarks…". Requests keep the sheet's own numbers (2.10, 5.11), so they match file names in the data room. Sub-headings ("Bank:", "Employee Statutory Dues › ESIC") are kept.

**Everything on the sheet is kept, except annexures.** Every other column is saved with its own header (Criticality, Folder link with its web link, "Remarks - Firm", "Remarks - Client 28.9.26"…). Open a request to see them under **From the RFI**. Columns named after the client (for Acme Pvt Ltd, "Remarks [Acme]" or "Acme Status") become the client's comment. The title block, notes to the client (a Notes sheet or "Please Note" lines under the table) and section notes appear under **RFI details** on the tab. Annexure sheets (A, A1, A2…, "Annexure…") are not imported.

**How to**

1. The progress bar on the **RFI** tab shows what has been received, and each section shows its own count.
2. To add requests by hand, paste a list into **Add requests**, one per line. A number at the start (for example `12. Trial balance`) is kept. Choose **Requested from…**, then tap **Add N items**.
3. Tap **Copy pending table** and paste it into an email.
4. Tap **Email** with the contact's first name to open a chase email with their pending items.
5. Tap **Chased** on an item to log a chase. Tick **Mark received** when it arrives.
6. **When to chase.** The next chase date follows the RFI's **Criticality** column: High every 3, Medium every 5, Low every 7 working days, Monday to Friday, counted from the request date or the last chase. A blank or unknown criticality counts as Medium. Items with nobody to chase (no contact and no person responsible on the RFI) aren't counted as chases; Today lists them under **Assign a contact**. You can still set **Next chase** by hand on any item. To bring existing items in line, tap **Settings → Working week → Reset chase dates**: the new dates go to the **Inbox** as one change to review.
7. Narrow the list with the filters under **Pending / All**. Tap one or more criticality chips (**High**, **Medium**, **Low**, from the RFI's criticality column) and pick an area from the **All areas** list. For example, Pending + High + Revenue shows only the open high-criticality revenue requests. Tap **Clear filters** to see everything again.

## Work plan (the engagement's audit programme)

**What it's for:** tracking every procedure in the engagement's work plan or audit programme: who does it, who reviews it, and where it stands.

**How to**

1. Open the engagement's **Work plan** tab and tap **Import work plan**. Choose the Excel work plan (an IA plan with Status - Execution / Status - Review / Reviewed by, or an audit programme with phases, risk, applicability and budget/actual hours both work).
2. Check the preview (steps, people, hours, other sheets kept) and tap **Import**.
3. Steps are grouped by phase, group (Balance Sheet, P&L…) and area. Lead-ins like "Review of -" or "ROC filings made during the year:" show over their steps. Steps the plan marks not applicable are greyed out.
4. Tap a step's status chip to move it Open → WIP → Review pending → Closed, and its review chip (when the plan has one) Open → WIP → Closed. Tap the step to see everything else the plan said about it and add notes.
5. Filters: **Open**, **To review**, **Done** and **Mine** (steps where you're the person responsible or the reviewer; set your name in Settings, initials like "JK" match too). Tap a person's chip to see only their steps.
6. Steps waiting for review (marked **Review pending**, or executed but not yet reviewed in plans with a review column) also show on the **Review** page under **I review**, grouped by engagement. Those named for another reviewer are left out. Tap the review chip there to mark one reviewed.
7. **Update from work plan** re-imports a newer copy: new steps are added and changes in the sheet come through, but statuses you changed in the app stay unless the sheet itself changed them.

Other sheets in the file (time summary, risks and instructions…) are kept under **Plan details**.

8. **Names that aren't matched:** if the plan names someone Falcon can't place (e.g. a first name not in People), a card lists them with how many steps each has. Choose who each is once: you, a team member, a new person, or "not a person" (like Team). It's saved as another name for that person (see People → Also written as, or Settings → You → Also written as for yourself), so their steps count in their workload on every engagement. Joint owners like "A/B" count for both, and your initials (e.g. JK) count as you.
9. Ask the Assistant about anyone's load ("how many items does Asha have on Project Falcon?") or "what can we do now?". It reads the work plan, the RFI and the readiness below.

## Readiness (what can be done with the inputs received)

**What it's for:** seeing which open work plan steps the team can execute now with what the client has sent on the RFI, and which are blocked and why, with a list to send your manager.

**How to**

1. Import the engagement's work plan (Work plan tab) and its RFI (RFI tab). Then open **Readiness** (after Review in the menu) and pick the engagement, and a person if you like.
2. The tiles show where each open step stands, and tapping one shows its steps: **Ready** (every input in, or no input needed), **Can start** (something is in, or the books are: the workpaper can be built and stays partly complete), **Blocked** (nothing usable in yet), **Likely N/A** (every input is N/A: mark the step N/A if it doesn't apply), **To confirm** and **Not linked**. Only links you've confirmed count. Mixed inputs follow the team's rules: N/A + received is Ready, N/A + partial is Can start, N/A + pending is Blocked.
3. **To confirm**: steps with *suggested* links, from the AI (✦ AI) or Falcon's offline matcher (≈ Matcher). Each shows the suggested RFI items with their status and what the step **would be** (Ready or Blocked). Tap **Confirm** if they're right, **Edit** to fix them, or **No input**. To go faster: **Confirm all N** beside an area, tick steps and **Confirm selected**, or **Confirm all AI suggestions** (asks first). Each is one Undo. Suggestions never count until you confirm them.
4. **Every step lists all its inputs with their state**: ✓ received, ◐ partly in, ○ pending (with days waiting and who has it), – N/A, ▲ not on the RFI. The books item (TB / GL / accounting backup) is tagged **books**: a step comparing the books with something else can start as soon as the books are partly in. Mark or unmark an item as the books in its panel (RFI tab → tap the item).
5. **Find an RFI item** (search box): type a number (e.g. 1.5) or words to see every step that item feeds, with each step's state and owner. Under it, **Holding up the most steps** lists the open items to chase first. The same list shows in each RFI item's panel (**Feeds N work plan steps**). When an item is marked received (by you, an accepted proposal or an import), Falcon tells you what it **unlocked**, e.g. "Unlocked 2 steps: 4.2 … (Ravi) → can start; 4.7 … (Ravi) → ready". On **Can start** and **Blocked**, switch to **By missing input** to see which missing item holds up the most steps; tap **Chased** to log a chase, or **Add to RFI** for an input that isn't on the RFI.
6. **Export to Excel** downloads a workbook for your manager (Summary, Blockers, By missing input, Ready to execute). It covers steps that can start and steps that are blocked, each with what's missing and what's **already in**. Only confirmed steps are included; the Summary sheet and the email say how many steps aren't confirmed yet. **Copy for email** copies a table to paste into an email; **Email manager** opens a draft with the summary.
7. **Not linked**: the app couldn't tell what these steps need. Tap **Link inputs**, or **No input needed** for steps like planning or the report.

**Where suggestions come from:** Falcon's offline matcher compares each step's wording with the RFI items, understanding common audit terms (FAR = fixed asset register, BRS = bank reconciliation, BoA = books / TB / GL, 26AS, GSTR-2B, UBR/UER…). It's a head start, not a decision, which is why its links are only suggestions. An AI suggestion replaces the matcher's for that step. Your confirmed links always win and are never overwritten.

- **Link with AI** asks Gemini to suggest links for the steps the app couldn't link itself (and to list inputs missing from the RFI); **Re-check all with AI** sends every open step. A warning comes first: the AI can fail (Google's servers busy, rate limits) or link wrongly, so only use it with a capable model on a paid Gemini plan; otherwise link steps by hand. If Google is busy it retries twice on your model, then stops; it never switches to another model. Its links land under **To confirm**. One Undo reverses a run, and steps you confirmed or set by hand are never touched.
- Tap any step to see **Inputs needed**: whether its links are suggested (with a **Confirm** button) or confirmed, and by what. Search the RFI to add an item, remove one with ×, add an input that isn't on the RFI (tap its chip when it comes in), or tick **No client input needed**. Any change you make confirms the links. **Reset** drops them and goes back to the matcher's suggestion.
- An AI connected through **AI connections** (e.g. Claude) can also suggest links, but only you can confirm them.

## Work papers and review points

**What it's for:** the work papers you prepare or review, and the points raised on them.

**How to**

1. Open **Review** (from **More** on a phone). Choose **I review** or **I prepare**.
2. Work papers are grouped by status, most urgent first. Tap **Show final** to include finished ones.
3. Open a work paper and add review points, one per line. Pasting a list works.
4. Each open point shows **Owner**, **Due** and **Step**. The owner is the work paper's preparer unless you pick someone else (or **Me**); the point then counts in that person's workload and, if it's you, on Today. Set a due date to have it show as overdue, and link it to the work plan step it's about. Points marked 🔒 are your own notes and never count for anyone. Reassigning a point on a Final work paper sends the paper back to Points raised.
5. Tick **Clear review point** when a point is resolved.

**Your firm's templates first**

Import your firm's work-paper templates once: **Settings → Firm checklists → Import → Choose folder** (or **Choose files** on a phone). Falcon reads each workbook's **Checklist**, **Procedures** and **Index** sheets, and turns them into review questions, each with its tests ("1. … 2. … 3. …") as ticks. Old copies (a "Dump" folder, "Copy of…") and duplicate names start unticked. Check the preview, rename anything, then **Save**. Re-importing a template with the same name updates it and keeps everything you've added.

- 🔒 **The templates stay on this device.** They are not synced to Google Drive, not in backups, and never sent to the AI. To use them on your phone or another laptop, use **Settings → Firm checklists → Export**, then **Import file** on the other device. Keep that file private.
- When you open a work paper, Falcon picks the matching template from its title (for example "Trade receivables" → *Accounts Receivable*) and shows "Firm template: … · change". Tap **change** to choose a different one, or **No template**.
- **Start review: firm basics first** asks the template's questions one at a time: inputs, then each check with its tests, then risks, disclosures and "sections of the work paper completed". Tick tests as you go; **Yes, done** ticks them all.
- **No / issue** asks what's missing. **Raise as a review point** without a note lists the tests still open. Points raised from firm checks are marked 🔒 and kept off the AI.

**It learns as you go**

- Tap **New check** during the guided review (or **Add a check for next time** in the list) and type the check. Choose where it applies: **every WP on this template** (the default) or **only this WP**.
- The next time you open a matching work paper, a 🔔 reminder at the top lists the checks you added that haven't been confirmed on it, marked **NEW**. Answer them there or in the review: they come right after the firm basics.
- **Stop asking** (under a check's details) removes a check you no longer need.

**Further checks: "has this been done on the work paper?"**

After the firm's basics and your own checks come the further checks for the WP's area.

- The area comes from the WP's **Programme area**. If that's empty, the app guesses it from the title (for example "Trade receivables" or "NWC") and says so. Use **Change area** if the guess is wrong.
- If the engagement has a work programme (TB uploaded), the cues are its steps for that area. Otherwise they come from the procedure library for the engagement type, with key steps first.
- Tap **Start guided review** to go one question at a time. Answer **Yes, done**, **No / issue**, **N.A.** or **Skip**. A "No" asks what's missing, lets you raise it as a review point, and shows what more to check and why. The dots at the top show your progress, and you can tap any dot to jump to that question. At the end you get a summary, plus shortcuts to revisit the flagged questions or answer the rest.
- **List view** shows the same cues with ✓ / ⚑ / n.a. buttons.
- Each answer is saved as a work-programme step linked to the WP, so it syncs and shows in the **Programme** tab.

**Counter-questions on review points: "have you also checked…?"**

- While you type a review point, the app suggests related checks from the procedure library.
- When you add a point, it is challenged straight away. Related checks are attached at once. If the assistant is set up (Settings → AI assistant), Gemini also adds 2–4 specific questions, marked **AI**. These are based on the WP, its area, the TB numbers and trend flags, your other points and the steps you've already passed.
- For each question you can choose **Add as review point**, **Add to programme** (it becomes a step such as "Check dispatch documents…") or **Dismiss**. Tap **Challenge with AI** (or **Challenge again**) on any open point to ask again.

## Follow-ups (Waiting on)

**What it's for:** everything you are waiting for, grouped by person, longest-waiting first. It includes open IRL items.

**How to**

1. Open **Follow-ups**. Filter with **All**, **Clients**, **Managers** or **Team**.
2. Tap the mail icon beside a person to email them.
3. Tick **Mark received** when you get the answer.
4. Tap **+ Follow-up** to add one.

## Calendar

**What it's for:** your week hour by hour, or the whole month, with tasks, work papers, IRL dates, follow-ups, reminders, key dates and (when connected) Google Calendar events.

**How to**

1. Choose **Week** or **Month** at the top right.
2. Move with the arrows, or tap **Today**. **Week of** and **Month** let you jump to a date.
3. In the week view, tap an empty time slot to add a task at that time. In the month view, tap a day to open its week.

Connect Google in **Settings** to see your Google events here too.

## Time and focus

**What it's for:** a focus timer, a time log, and a weekly timesheet you can copy into your firm's timesheet tool.

**How to**

1. Pick a length (**25 min**, **50 min**, **90 min** or your own) and optionally a task or engagement. Tap **Start focus**.
2. While it runs, use **Pause**, **Stop & log** to save the time, or **Discard**. The timer keeps running if you close the app. Sessions of 20 minutes or more count toward your focus ring.
3. To reserve deep work, tap **Block focus time in Google Calendar**, set the name, start and length, then **Add to calendar**.
4. In **Timesheet**, use the arrows to change week, then tap **Copy for timesheet** and paste it into Excel or your timesheet tool.

## Reports

**What it's for:** a summary of your day or week, ready to share.

**How to**

1. Choose **Today**, **This week** or **Last week**.
2. Read the totals and the **Time by engagement** and **Longest waiting** lists.
3. Tap the copy icon to copy the report as text.

## Progress

**What it's for:** a light view of habits. It rewards finished work and chasing.

**How to**

1. Check today's **ring**, which fills as you finish work, chase and complete focus sessions.
2. Watch your **Day streak** and **No overdue chases** streak. A streak freeze lets one missed working day pass each week.
3. See your level, points and the **Last 14 days** chart. Scroll to **Badges** for those you have earned.

**How points work:** tasks done, chases sent, review points cleared, WP to Final, IRL complete and focus sessions. Points never come from hours logged. Switch the feature off under **Settings → Time & progress → Gamification**.

## Assistant

**What it's for:** running your day by chatting. It can do anything the app can: add tasks, log chases, plan the day, log time, or turn a pasted client email or screenshot into IRL items.

**How to**

1. Open **Assistant** from **More**, or tap the sparkle button on any screen (`C` on a laptop).
2. Ask in plain words. Examples: "Plan my day", "What do I need to chase today?", "Log 2 hours on Falcon NWC review", "Remind me at 4pm to call Rahul about the TB".
3. Attach images, PDFs or Excel/CSV sheets with **+**, paste an image, or dictate with the microphone.
4. Each change is listed with a status line. Tap **Undo** beside it to reverse it.
5. Deletes always ask first. Tap **Delete** to confirm or **Keep** to cancel.

Use **New chat** to start again. Chat history stays on this device.

## Inbox (changes waiting for you)

**What it's for:** nothing Claude or the Assistant does changes your data until you say so. Their changes arrive here as proposals.

1. **Inbox** (in the menu, with a count) lists each proposal: who proposed it, the engagement, and exactly what would change (old → new, per record).
2. **Accept** applies it; **Reject** drops it. **Accept all** applies each one separately: any whose record you changed since (stale) or deleted (void) are skipped and listed under **Decided** with the reason.
3. Accepted changes can be undone from the toast or under **Decided**; undoing puts the proposal back in Pending.
4. In the Assistant chat, each proposed change shows **Waiting for you** with Accept / Reject right there.
5. Settings → AI assistant → **AI changes**: tick what may apply straight away without the Inbox (moving task dates/times, logging chases). Everything else always waits.
6. Claude can see what's waiting (`list_proposals`) but can never approve.

## AI connections (use Falcon from Claude)

**What it's for:** asking Claude Desktop, Claude Code or another MCP app about your work and letting it make changes, with the same abilities as the Assistant. Every change is logged in Falcon, per session, with Undo.

**How to**

1. Open **AI connections** (menu, More, or Settings → AI assistant). Copy the **pairing code**.
2. Claude Desktop: download **falcon-bridge.mcpb** from the page, open it, and paste the pairing code when Claude asks. Claude Code and other MCP apps: download **falcon-bridge.mjs** and add it with the command or config shown on the page (needs Node 18+).
3. Tick **Allow AI connections on this device** and keep Falcon open in this browser. The status turns **Connected** when the AI app starts the bridge. If the browser asks to allow access to apps on this device, choose **Allow**.
4. Ask Claude things like "What's blocked on Project Falcon and why?" or "Add these RFI items from the screenshot".
5. **Sessions** lists each AI session (which app, when it ran, how many changes, reads and failures). Open one to see each change; tap **Undo** to reverse it. Tick **Show reads** to include what it only read.

**Good to know**

- The bridge runs only on this computer and only accepts Falcon with your pairing code. **New code** stops old setups until you enter the new code in the AI app.
- The session log keeps what the AI did (not the chat) for 7 days, on this device only: not synced, not in backups. **Clear log** empties it without undoing anything.
- Claude's own "undo" only reverses its own changes, and undo never overwrites edits made since.
- What the AI reads goes to that AI service as part of your chat. Firm checklists are never shared. The web and phone versions of Claude can't use it.

## Settings

**Data → Clean up** lists records that belong to engagements that no longer exist (for example RFI copies imported under an engagement that was later deleted). Closed and on-hold engagements are never counted. Tick the groups to remove and confirm; they're deleted on every synced device, with Undo straight after.

**You → Also written as**: the initials or short names sheets use for you (e.g. JK).

**Google sync & Calendar:** tap **Connect Google account**. Then tick what goes to your Google Calendar: **Reminders → Calendar**, **Key dates → Calendar**, **Due dates → Calendar**. Use **Sync now** to sync straight away.

**AI assistant (Gemini):** it uses your Google sign-in. Tap **Allow Gemini** (this needs billing on the Google Cloud project), then tap **Check** to test the connection.

**Working week, look & feel, time & progress:** working days, holidays, chase frequency, theme, focus targets and timesheet rounding.

**Firm checklists:** import the firm's work-paper templates, see them, remove one, or export/import them to move to another device. They stay on this device only.

**Data:** **Export** downloads a full backup file (firm checklists are not included). **Import** merges a backup (newer records win, nothing is lost). **Import sheet** opens the allocation import. **Erase** deletes everything on this device, so export first. The version number is at the bottom.

## Privacy and good practice

- **Data stays on your devices.** With Google connected, it syncs through a hidden app folder in your own Google Drive that only this app can read.
- **Calendar.** The app changes only the events it created.
- **AI assistant.** Messages and attachments you send go to Google's Gemini API. Use a billing-enabled Google Cloud project so Google does not use them to improve its products.
- **Client information.** Check your firm's policy before sharing client documents with the assistant. For real client data, use a billing-enabled Gemini project.
- **Back up regularly** with **Export**, especially before erasing data or changing devices.

## Troubleshooting

- **"Reconnect Google" on the sync chip.** Google sign-in lasts about an hour, and browsers cannot renew it silently. Tap the chip (or **Reconnect** in Settings). Your data stays on the device meanwhile.
- **Safari sign-in leaves the app.** Safari signs you in by redirecting the page to Google and back, not by a pop-up. This is expected.
- **New version not showing.** Close the app completely and reopen it. The version is at the bottom of **Settings**.
- **Gemini permission errors.** Tap **Allow Gemini** in Settings to reconnect Google with the Gemini permission, and check that the Generative Language API and billing are enabled in your Google Cloud project.

## Work programme (from the trial balance)

**What it's for:** turning a client's TB into a complete, tailored checklist of what to do on the engagement, and helping you review it.

**How to**

1. Open the engagement → **Programme** tab → **Upload trial balance**. Use Tally's Trial Balance export to Excel (detailed, with ledgers; add the previous year as a comparative if you can), or any Excel/CSV TB.
2. Confirm the **year under audit**, what to **compare with**, the **engagement type** (Statutory audit, Financial due diligence, Internal audit) and the **industry** (D2C/e-commerce, manufacturing, IT/services/SaaS, trading).
3. Check the **mapping**: every ledger is placed in an area (receivables, inventory, GST/TDS dues, revenue…) from its Tally group and name. Fix any that are wrong; the app remembers your corrections next time. The screen tells you if debits don't equal credits.
4. Tap **Save & build programme**. You get:
   - **Materiality** (1% of revenue by default; type your own figure to change it). Areas below performance materiality get only their key steps.
   - **Trend checks** per area, e.g. "Revenue +10%, so receivables would be expected at +8% to +12%; actual +33%". Flagged checks list what to look at; **Add these checks to the programme** puts them in.
   - **Procedures** for every area, by assertion, with the reason for each. Tick them off, assign them to a team member and link a work paper by tapping a step.
5. **Reviewing:** give a work paper a **Programme area** (e.g. Trade receivables). When you open it, **Review cues** ask whether each of that area's steps has been done (see *Work papers and review points*). Mark each ✓, ⚑ or n.a., or use **Start guided review**. When you flag one, note what you found, and the app shows **what more to check, and why**. Add any of those to the programme, raise them as review points, or tap **Ask AI what else to check** for suggestions based on the balances, trends and your notes.
6. **Copy** puts the whole programme on the clipboard for Excel. **New TB** re-imports (for example a revised TB); it adds what's missing and keeps your progress.
