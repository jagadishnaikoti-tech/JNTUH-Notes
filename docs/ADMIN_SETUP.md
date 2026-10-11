# Admin panel & analytics — setup guide

This document covers everything that must be done **in Firebase and on Vercel**
to turn on the admin panel, visitor analytics, PDF click tracking and the
social Channels page. The code is already in the repository; the steps below are
the parts that require your Firebase/Vercel account.

---

## 1. What was added

| Area | Where |
| --- | --- |
| Admin login / dashboard / analytics / PDF activity / channels | `/admin/*` (lazy-loaded, separate from the public layout) |
| Public page-view + PDF click tracking | `src/lib/analytics.js`, `src/components/analytics/*` |
| Firestore security rules | `firestore.rules` (deploy with `npm run deploy:rules`) |
| Admin provisioning scripts | `scripts/create-admin.mjs` (`npm run admin:create -- <email>` creates the user **and** grants the claim) and `scripts/set-admin.mjs` (`npm run admin:grant -- <email>` grant / `--remove` revoke) |
| Social channels in the public sidebar & footer | `src/components/SocialChannels.jsx` |
| Client config | `.env.example` → copy to `.env.local` / Vercel env vars |

Data model (Cloud Firestore):

- `analyticsEvents/{eventId}` — append-only validated event stream (public write, admin read).
- `analyticsDaily/{date}` — optional rollups, written by a trusted backend only.
- `channels/{channelId}` — social channel configuration.
- `settings/public` — public website settings that are safe to expose.
- `users/{uid}` — admin profile metadata (authorization uses Auth **custom claims**, not this document).

---

## 2. Firebase project setup

1. **Enable Email/Password sign-in**
   Firebase Console → **Authentication → Sign-in method → Email/Password → Enable**.
   Do **not** enable public sign-up in the UI — there is no registration page.

   > Until this is enabled, sign-in fails and the login page shows
   > “Email/password sign-in is not set up yet…”. (Firebase returns the
   > `CONFIGURATION_NOT_FOUND` / `auth/configuration-not-found` error.)

2. **Create the Firestore database**
   Firebase Console → **Firestore Database → Create database** (production mode).

3. **(Recommended) Enable Analytics**
   Firebase Console → **Analytics**. This links the `measurementId` in your web
   config. See the note about measurement IDs in §6.

4. **Deploy the security rules**
   From the project root (Firebase CLI logged in to the same project):

   ```bash
   npm i -g firebase-tools      # once
   firebase login               # once
   firebase use jntuh-notes-6ef74
   npm run deploy:rules
   ```

   The rules are deny-by-default and must be deployed **before** the site is
   useful, otherwise Firestore rejects every read/write.

---

## 3. Create the first administrator

Administrator rights come from a **custom claim** (`admin == true`) on the
Firebase Auth user. There is no self-service path — an account alone grants
nothing.

First download a **service-account key** (one time):
Firebase Console → ⚙ **Project settings → Service accounts → Generate new private key**.
Save the JSON somewhere **outside** the repo, e.g. `C:\keys\jntuh-notes-admin.json`.

> Never commit this file. `.gitignore` already blocks `serviceAccount*.json`
> and `*firebase-adminsdk*.json`.

### Option A — create the account and grant the claim from the CLI (one step)

The password is read from the `ADMIN_PASSWORD` environment variable, so it never
lands in shell history, in Firestore, or in the repository.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\jntuh-notes-admin.json"
$env:ADMIN_PASSWORD = "<choose-a-strong-password>"
npm run admin:create -- admin@example.com
```

Re-running for an existing account simply re-applies the `admin` claim; add
`--reset-password` (with `ADMIN_PASSWORD` set) to change its password too.

### Option B — create the account in the console, then grant the claim

1. **Create the account** in Firebase Console → **Authentication → Users → Add user**
   (email + password). Note the exact email.

2. **Grant the claim** (PowerShell example):

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\jntuh-notes-admin.json"
   npm run admin:grant -- admin@example.com
   ```

   To revoke: `npm run admin:grant -- admin@example.com --remove`

The account must **sign out and back in** after the claim changes so the token is
refreshed. Then sign in at `/admin/login`.

---

## 4. Configure the browser (client) config

The Firebase **web** config is public (it ships in the bundle and cannot bypass
the rules). It is still read from environment variables so deployments can vary.

1. Copy `.env.example` to `.env.local` and fill in the values from
   Firebase Console → ⚙ **Project settings → Your apps → SDK setup**.
2. Add the same keys in **Vercel → Project → Settings → Environment Variables**
   (Production + Preview), then redeploy.

```dotenv
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=…
VITE_FIREBASE_PROJECT_ID=…
VITE_FIREBASE_STORAGE_BUCKET=…
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
VITE_FIREBASE_MEASUREMENT_ID=…
VITE_REQUIRE_CONSENT=false
```

If the variables are missing the public site keeps working — analytics simply
records nothing and the admin panel shows a “Firebase is not configured” notice.

---

## 5. Using the panel

- **Overview** — page views, estimated unique visitors, PDF clicks, sessions,
  trends, most-viewed pages, most-clicked PDFs, recent activity.
- **Analytics** — page-view trends and top pages over 7/30/90/365 days.
- **PDF Activity** — open/preview/download split, clicks by subject and year,
  most-clicked documents and a searchable event table.

Every time-series chart has a **Daily / Weekly** toggle; the range buttons
(7/30/90/365 days) apply to the whole page.
- **Channels** — add/edit/hide/delete social links. Active channels appear in
  the public sidebar and footer automatically.

Empty states are honest: if nothing has been recorded you will see
“No analytics data recorded yet”, never invented numbers.

### Metric definitions

| Metric | Definition |
| --- | --- |
| Page views | Count of recorded `page_view` events (one per client-side route change, de-duplicated). |
| Estimated unique visitors | Count of distinct random anonymous `visitorId` values in localStorage. **Not** a count of real people. |
| Sessions | Count of distinct `sessionId` values; a session ends after 30 minutes of inactivity. |
| PDF clicks | Count of `pdf_click` events. `open` = open in Drive, `view` = in-app preview, `download` = **click on the download control** (not proof a download finished). |

No IP addresses, emails or user-agent strings are stored.

---

## 6. Measurement IDs (please read)

You currently have **two** GA4 measurement IDs:

- `G-VQGHZND2J7` — the manual `gtag.js` tag already in `index.html` (its own GA4 property/stream).
- `G-KHYQ7ZTRX4` — the `measurementId` from the Firebase web config (the Firebase-linked property).

The app keeps the manual tag **and** initialises Firebase Analytics, so each
property receives its own hits (they are separate properties, so neither is
double-counted). This is functional but redundant. To keep a single property:

- Option A — remove the manual tag from `index.html` and keep Firebase Analytics; **or**
- Option B — remove `VITE_FIREBASE_MEASUREMENT_ID` and keep only the manual tag.

> **Take the Firebase measurement ID straight from Firebase.** It must match the
> project exactly. If it differs, the Firebase Analytics SDK logs a console
> warning (“The measurement ID in the local Firebase config … does not match the
> measurement ID fetched from the server …”) and keeps sending events to the
> **server** value, so `VITE_FIREBASE_MEASUREMENT_ID` only decides whether the
> SDK loads. Read the authoritative value from Firebase Console → ⚙ **Project
> settings → Your apps → SDK setup**. The value above was verified against the
> live project.

The admin dashboard does **not** depend on GA4 — it reads the Firestore
`analyticsEvents` collection, so analytics in the panel work either way.

---

## 7. Privacy & consent

- `VITE_REQUIRE_CONSENT=false` (default): analytics run immediately. Suitable
  for audiences where a banner is not required.
- `VITE_REQUIRE_CONSENT=true` — recommended for EEA/UK visitors: GA4 defaults
  to `denied` via Consent Mode and **nothing** is recorded until the visitor
  presses **Accept** in the on-site banner. Declining records nothing.

The Privacy Policy page should be reviewed whenever consent mode is enabled so
it accurately describes GA4 and first-party analytics.

---

## 7b. Optional: daily rollups (Cloud Functions)

The dashboard aggregates events client-side, which is plenty for a site of this
size. If the `analyticsEvents` collection grows large, add a scheduled Cloud
Function (Blaze plan) that reads recent events and writes `analyticsDaily/{date}`.
The security rules already allow admins to read `analyticsDaily` and block all
client writes to it, so the rollup can be added later with no client changes.

---

## 7. Security notes

- Only `create` is allowed on `analyticsEvents`; updates and deletes are always
  denied, so nobody can tamper with recorded history.
- Every event is validated (allowed field set, string length limits, known
  `type`/`action`) so the collection cannot be used as arbitrary storage.
- Channel writes and all analytics reads require the `admin` claim.
- Admin sessions use **session** persistence: closing the browser signs out.
  Change `PERSISTENCE` in `src/lib/adminAuth.js` to `"local"` if you prefer
  long-lived sessions.
- The admin area is excluded from `robots.txt` and served with
  `noindex, nofollow`.
- Analytics are accepted from the client (like GA4). They are aggregated for
  reporting only and are **never** used for security decisions, so
  client-reported data is not a threat vector. If you later need tamper-proof
  counting, move ingestion behind a Cloud Function.

---

## 7. Optional: existing GA4

The existing `G-VQGHZND2J7` tag is left untouched except that analytics storage
now starts in Consent Mode. If you do not need EEA consent handling you can keep
`VITE_REQUIRE_CONSENT=false` (the default) and the tag behaves exactly as before.

---

## 8. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| “Firebase is not configured” | `VITE_FIREBASE_*` env vars missing at build time; add them and redeploy. |
| “Email/password sign-in is not set up yet.” | Enable the **Email/Password** provider in Firebase Console → Authentication → Sign-in method. |
| “Sign-in failed. Please try again.” (no reason) | Unexpected Auth error; reload and check the browser console for the Firebase error code. |
| “That account is not an authorized administrator.” | The `admin` custom claim is not set (run the provisioning script), or the token is stale (sign out/in). |
| Dashboard shows `permission-denied` | `firestore.rules` not deployed, or the signed-in user lacks the claim. |
| Dashboard stays empty | No public traffic yet, or `VITE_REQUIRE_CONSENT=true` and visitors have not accepted. |
| Channels never appear publicly | All channels are hidden (`active` off), or Firestore rules are not deployed. |
