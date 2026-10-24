# Going public: Google verification

For the app's maintainer, not end users. The basic OAuth client setup is in the [README](../README.md#google-setup-sync--calendar).

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
