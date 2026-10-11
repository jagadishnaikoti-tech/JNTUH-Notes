# Student accounts (Firebase Auth) — setup guide

This guide covers the optional **student** sign-in/sign-up feature: the four
public pages (`/signin`, `/signup`, `/forgot-password`, `/account`), the
`users/{uid}` profile document, and the Firestore rules that protect it.

It does **not** cover administrators. Admin access is a Firebase Auth **custom
claim** and is documented separately in [`ADMIN_SETUP.md`](ADMIN_SETUP.md).

---

## 1. What the feature uses

| Piece | Detail |
| --- | --- |
| SDK | Official Firebase JS SDK **v11** (`firebase/auth`, `firebase/firestore`) |
| Product | Firebase **Authentication** (Email/Password provider) + **Cloud Firestore** |
| App | The **existing** Firebase app from `src/lib/firebase.js` — no second app is created |
| Code | `src/lib/userAuth.js`, `src/lib/userProfile.js`, `src/context/AuthContext.jsx`, `src/components/AuthForm.jsx`, `src/components/AuthNav.jsx`, `src/components/ProtectedRoute.jsx`, `src/pages/SignIn.jsx`, `src/pages/SignUp.jsx`, `src/pages/ForgotPassword.jsx`, `src/pages/Account.jsx`, `src/styles/auth.css` |
| Config | Public web config via `VITE_FIREBASE_*` env vars (see `.env.example`) |

Loading is lazy: the SDK is imported on demand, so public pages that never touch
an account still download no Firebase code.

---

## 2. Firebase Console settings (required)

1. **Enable the Email/Password provider**
   *Firebase Console → Authentication → Sign-in method → Email/Password →
   Enable → Save.*

   The student flow uses email + password only. No third-party provider is
   required.

2. **Add authorized domains**
   *Authentication → Settings → Authorized domains.*

   Ensure these are present (Firebase adds `localhost` and the default
   `*.firebaseapp.com` / `*.web.app` domains automatically):

   - `localhost` (local development)
   - your production domain (for example `jntuh-notes.vercel.app`)
   - any preview/deploy domains you actually use

   Password-reset and verification links stop working on domains that are not
   listed here.

3. **(Optional) Email templates**
   *Authentication → Templates.* The default *Password reset* and
   *Email address verification* templates are fine. Verify the sender/sender
   name if you want the messages branded.

3. **Create the Firestore database** if it does not exist yet
   (*Firestore Database → Create database*). The profile document is optional:
   if the write fails, sign-in still works and the app simply shows the name
   from Firebase Authentication.

---

## 3. Firestore security rules (required — deploy this)

The student profile rules live in the repository's [`firestore.rules`](../firestore.rules)
under the `users/{uid}` match block:

```js
match /users/{uid} {
  allow read: if (isSignedIn() && request.auth.uid == uid) || isAdmin();
  allow create: if isSignedIn() && request.auth.uid == uid
    && validProfileCreate(request.resource.data);
  allow update: if isSignedIn() && request.auth.uid == uid
    && validProfileUpdate(request.resource.data, resource.data);
  allow delete: if false;
  allow write: if isAdmin();
}
```

This lets a signed-in student read and update **only their own** profile and
**only** the permitted fields (`displayName`, `email`, `updatedAt`). Roles are
never stored in Firestore, so a document field can never grant admin access.
Administrators (custom claim `admin == true`) keep full access.

### Deploying the rules

You must deploy `firestore.rules` after any change to it. The Admin SDK service
account used by `scripts/create-admin.mjs` **cannot** deploy rules — use one of
the following from a machine with the Firebase CLI:

```bash
npm run deploy:rules            # if defined in package.json
# or
firebase deploy --only firestore:rules --project jntuh-notes-6ef74
```

The first run needs an interactive `firebase login`. Alternatively, paste the
contents of `firestore.rules` into
*Firebase Console → Firestore Database → Rules* and click **Publish**.

> **Important:** verify the deployed rules before launch. An early ruleset on
> this project left `users/{uid}` world-open, which allowed any signed-in user
> to read every profile and write arbitrary fields (including a fake
> `admin: true` field). The hardened rules above fix that, but they only take
> effect once deployed. To confirm, open the app signed in as a normal student
> and check that reading another user's `users/{uid}` document is denied.

---

## 4. Environment variables

Copy `.env.example` to `.env.local` for local development and add the same keys
to **Vercel → Project → Settings → Environment Variables** for production:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=jntuh-notes-6ef74.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=jntuh-notes-6ef74
VITE_FIREBASE_STORAGE_BUCKET=jntuh-notes-6ef74.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=G-...
VITE_REQUIRE_CONSENT=false
```

These values are **public** (they ship in the browser bundle). Never put a
service-account key, an Admin SDK credential or any `*_SECRET` in a `VITE_*`
variable — anything prefixed `VITE_` is exposed to every visitor.

---

## 5. Data model

Only one collection is used for students:

```
users/{uid}
  displayName : string   (the name shown in the header)
  email       : string   (mirrors the Firebase Auth email)
  createdAt   : timestamp (timestamp on first write)
  updatedAt   : timestamp (timestamp on later writes)
```

* The uid is the Firebase Auth uid — it is never trusted from user input.
* Passwords are handled **entirely** by Firebase Authentication. They are never
  written to Firestore, `localStorage` or `sessionStorage` by this app.
* Profile writes are best-effort: if Firestore is unavailable the sign-in still
  succeeds; the UI falls back to the Auth `displayName`/email.

---

## 6. Behaviour reference

| Concern | Behaviour |
| --- | --- |
| Minimum password | 8 characters, enforced client-side with a strength hint (Firebase's own minimum is 6) |
| Session persistence | "Keep me signed in" → `browserLocalPersistence`; unchecked → `browserSessionPersistence` |
| Email verification | **Soft** — a verification email is sent on sign-up; a banner on `/account` offers resend/refresh. Access is never blocked. |
| Password reset | Real Firebase email; the UI shows the same confirmation whether or not the address exists (no account enumeration) |
| Post-sign-in redirect | `?next=` is validated by `safeNext()` — only in-site paths beginning with a single `/` are accepted |
| Protected route | `/account` redirects signed-out visitors to `/signin?next=/account` |
| Admin | `/admin/*` is unaffected; a student account cannot enter it (custom claim required) |
| SEO | `/signin`, `/signup`, `/forgot-password` are prerendered `noindex, follow`; `/account` is `noindex, nofollow` and disallowed in `robots.txt`; none appear in `sitemap.xml` |

---

## 7. Manual test checklist

Run the dev server (`npm run dev`) and exercise:

1. **Sign up** — empty form, invalid email, weak password, mismatched confirm,
   an already-registered email, then a valid sign-up. Confirm the header shows
   the display name and the profile row appears on `/account`.
2. **Sign in** — wrong password gives a generic error; correct password
   returns to the requested page; reload keeps the session when "Keep me signed
   in" is checked.
3. **Forgot password** — invalid email blocked inline; a real email is sent;
   an unknown address shows the same confirmation.
4. **Account** — change the display name (header updates immediately); resend
   the verification email; sign out.
5. **Routing / security** — `/account` while signed out redirects with `?next=`;
   `?next=https://evil.example` is ignored; a signed-in student is rejected at
   `/admin`.
6. **Public site** — home, years, a subject, search and PDF preview/open all
   still work with no account and no console errors.
