# Falcon

A personal PWA for a CA in Financial Due Diligence: engagements, work papers, review points, IRLs, follow-ups and reminders. It works offline and keeps its data on the device. See [PLAN.md](PLAN.md) for the full roadmap.

**Status:** Phases 0–3 done: tracking, focus timer, timesheet, reports, light gamification, plus Google Drive sync and Google Calendar (reminders, key dates, due dates, focus blocks, today's agenda). Phase 4 adds the Gemini assistant (Google sign-in). Next: the Claude connector.

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

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. "Falcon").
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Calendar API**.
3. **Google Auth Platform → Branding**: app name "Falcon" plus a support email.
   **Audience**: User type *External*, publishing status *Testing*. Under **Test users**, add the Gmail address(es) that will use the app. To let anyone sign in, see [Going public](#going-public-google-verification) below.
   **Data access**: add the scopes `.../auth/drive.appdata` and `.../auth/calendar.events`.
4. **Clients → Create client → Web application**:
   - **Authorized JavaScript origins**: every place the app runs: `http://localhost:5173` (dev), `http://localhost:4173` (preview) and your hosted origin, e.g. `https://danielphingston.github.io` (origin only, no path).
   - **Authorized redirect URIs**: the app's full URL with its base path and a trailing slash, e.g. `https://danielphingston.github.io/falcon/` (plus `http://localhost:5173/` for dev). Safari, every iPhone/iPad browser and the installed app sign in with a full-page redirect back to this address instead of a popup.
5. Copy the **Client ID**. Then do one of these:
   - put it in `apps/web/.env.local` as `VITE_GOOGLE_CLIENT_ID=…` before building (see `.env.example`), or
   - paste it into **Settings → Google sync & Calendar** in the app.

Then tap **Connect Google account**. Things to expect:

- Until the app is verified, Google shows a "Google hasn't verified this app" screen. Choose **Continue**. In *Testing* mode only listed test users can sign in.
- Access tokens last about an hour, and browsers can't refresh them silently. When one expires, the sync chip shows **Reconnect Google**; one tap fixes it. Your data stays on the device in the meantime.
- Data goes to a hidden *appDataFolder* in the user's own Drive. Only this OAuth client can read it, and it never appears in the Drive UI.
- Calendar events the app creates are tagged, so it only updates or removes its own events. It never touches anything else. Focus blocks you schedule are left alone after that.

## AI assistant (Gemini)

The assistant can do anything the app can: add tasks, log chases, turn a pasted client email or IRL screenshot into IRL items, log time, plan the day. Every change it makes has **Undo**, and deletes always ask first. You can open it from the ✨ button on any screen (`C` on a laptop), and use dictation or attach images/PDFs.

It signs in with your Google account (no API key to manage):

1. In the same Google Cloud project as above, enable the **Generative Language API**, and make sure **billing** is enabled on the project (usage is billed there; a personal Gemini/Google AI subscription doesn't apply).
2. Under **Google Auth Platform → Data access**, add the scope `.../auth/generative-language.retriever`.
3. In the app: **Settings → AI assistant**, then **Allow Gemini** (it reconnects Google with the extra permission).

Tested end to end with a real account on 2026-10-18: sign-in, Drive sync, Calendar events and Gemini chat all worked with the scope above.

When you deploy, add the hosted URL to the OAuth client's **Authorized JavaScript origins**, and set `VITE_GOOGLE_CLIENT_ID` for the build.

## Going public (Google verification)

*Testing* is fine for your own use. To let any Google account sign in without the warning screen, publish the app and get it verified. `calendar.events` (and the Gemini scope) are **sensitive** scopes, so Google does a full review: branding, a written reason for each scope and a demo video. It usually takes a few days to a few weeks, and Google emails the developer contact with questions.

**Before you publish:** Gemini usage is billed to this Cloud project for *every* user who signs in. Set a budget alert (**Billing → Budgets & alerts**) and, if you like, lower the Generative Language API quota (**APIs & Services → Generative Language API → Quotas**).

The app ships the pages Google checks, as static HTML in `apps/web/public/` (they work without JavaScript and are linked from **Settings** and from `index.html`):

| Page | URL (GitHub Pages) |
|---|---|
| Home page | `https://danielphingston.github.io/falcon/about.html` |
| Privacy policy | `https://danielphingston.github.io/falcon/privacy.html` |
| Terms of use | `https://danielphingston.github.io/falcon/terms.html` |

If you change what the app does with Google data, update `privacy.html` and its date in the same change.

1. **Branding**:
   - App name `Falcon` (the same as the home page heading; it must not contain "Google").
   - App logo: a 120×120 PNG of `apps/web/public/favicon.svg`.
   - Support email and developer contact email.
   - **App domain**: the three URLs above.
   - **Authorized domains**: `danielphingston.github.io`. `github.io` is a public suffix, so this counts as your own domain.
2. **Prove you own the domain** in [Google Search Console](https://search.google.com/search-console), signed in with the account that owns the Cloud project: add a *URL prefix* property for `https://danielphingston.github.io/` (the root, not `/falcon/`) and verify it with the HTML-file or meta-tag method in the `danielphingston.github.io` repo. One verification covers every project site under it.
3. **Data access**: check the list is exactly `openid`, `.../auth/userinfo.email`, `.../auth/drive.appdata`, `.../auth/calendar.events` and `.../auth/generative-language.retriever`. Remove anything else: every extra scope has to be justified.
4. **Scope justifications** (Google asks for one per sensitive scope; adjust if the app changes):
   - `calendar.events`: *"Falcon is a personal work tracker for financial due diligence. It creates, updates and deletes events on the user's primary calendar for their own deadlines, engagement key dates, reminders and focus blocks, so they get Calendar notifications. Each event is tagged with a private extended property, and the app only changes or deletes events with that tag. It also reads event titles and times on the primary calendar to show the user's day next to their tasks on the Today and Calendar screens. Narrower scopes don't cover this: read-only can't create reminders, and an app-created calendar can't show the user's existing meetings."*
   - `generative-language.retriever`: *"The optional in-app assistant calls the Gemini API with the user's own access token to turn their messages, pasted client emails and attached documents into tasks, follow-ups and IRL items in the app. Requests go straight from the browser to generativelanguage.googleapis.com, and the app keeps the conversation only on the user's device."*
5. **Demo video**: an unlisted YouTube video, in English, showing:
   1. The home page, then the privacy policy link.
   2. In the app, **Settings → Connect Google account**. Show the whole consent screen with the app name, and the browser's address bar with the `client_id` in the URL.
   3. Drive: make a change on one device or browser profile and show it sync to another.
   4. Calendar: give a task a due time or schedule a focus block, show it appear in Google Calendar, then show today's events on the Today screen.
   5. Gemini: send the assistant a message and show the task it creates.
6. **Audience → Publish app**, then **Verification Center → Prepare for verification**, paste the justifications and the video link, and submit. The Verification Center page shows the status.

## Installing on devices

- **Windows (Chrome/Edge):** open the site → install icon in the address bar → Install.
- **iPhone (Safari):** Share → Add to Home Screen. Installing matters on iPhone: it keeps the data from being cleared, and notifications only work for installed apps.

Data lives in the browser's IndexedDB on each device. Connect Google (above) to sync between devices. Without Google, use **Settings → Export** for backups and **Import** to move data between devices (imports merge; the newer copy of a record wins).

## License

[MIT](LICENSE) © 2026 Daniel Phingston
