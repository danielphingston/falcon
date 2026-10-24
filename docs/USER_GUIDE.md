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
2. Work down the sections: **Overdue**, **Due today**, **Chase today**, **Waiting for my review**, **Review points on my WPs**.
3. Tick a checkbox to mark a task done.
4. Tap **Chased** to log a chase. The next chase date is set for you. If a group has several items, tap **Chased all**.

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

## IRL and chasing

**What it's for:** tracking what the client has sent, chasing what is missing, and emailing the client in one go.

**How to**

1. Open the engagement's **IRL** tab. The progress bar shows what has been received.
2. Paste a list into **Add IRL items**, one per line. A number at the start (for example `12. Trial balance`) is kept. Choose **Requested from…**, then tap **Add N items**.
3. Tap **Copy pending table** and paste it into an email.
4. Tap **Email** with the contact's first name to open a chase email with their pending items.
5. Tap **Chased** on an item to log a chase. Tick **Mark received** when it arrives.

## Work papers and review points

**What it's for:** the work papers you prepare or review, and the points raised on them.

**How to**

1. Open **Review** (from **More** on a phone). Choose **I review** or **I prepare**.
2. Work papers are grouped by status, most urgent first. Tap **Show final** to include finished ones.
3. Open a work paper and add review points, one per line. Pasting a list works.
4. Tick **Clear review point** when a point is resolved.

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

## Settings

**Google sync & Calendar:** tap **Connect Google account**. Then tick what goes to your Google Calendar: **Reminders → Calendar**, **Key dates → Calendar**, **Due dates → Calendar**. Use **Sync now** to sync straight away.

**AI assistant (Gemini):** it uses your Google sign-in. Tap **Allow Gemini** (this needs billing on the Google Cloud project), then tap **Check** to test the connection.

**Working week, look & feel, time & progress:** working days, holidays, chase frequency, theme, focus targets and timesheet rounding.

**Data:** **Export** downloads a full backup file. **Import** merges a backup (newer records win, nothing is lost). **Import sheet** opens the allocation import. **Erase** deletes everything on this device, so export first. The version number is at the bottom.

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
