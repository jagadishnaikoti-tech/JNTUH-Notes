# Admin UI browser test harness (local emulator only)

Real-browser coverage for the admin ingestion dashboard and the public
homepage. It has **no new dependencies**: it reuses the project's existing Vite
dev server, Firebase emulators and the OpenCode browser tooling.

The harness boots the **real** app (`src/App.jsx`) and points it at the local
`demo-jntuh-notes` Firestore + Auth emulators. It never touches production: it
refuses to start unless the configured project id is exactly `demo-jntuh-notes`.

## Files

- `harness.html` / `harness-main.jsx` — test entry that connects the emulators
  and mounts the real app (no production source is modified).
- `seed.mjs` — creates the admin user (with `admin: true`), a non-admin user,
  stages synthetic notices through the collector's real write path, or clears
  the emulator.
- `../firebase.e2e.json` — emulator config that declares the Auth emulator
  (the committed `firebase.json` starts Firestore only).
- `../.env.e2e.local` — gitignored (`*.local`) demo-project env so the app can
  never fall back to the production config in `.env.local`.

## Run

```powershell
# 1. emulators (Firestore 8080 + Auth 9099), real firestore.rules applied
npx firebase --config firebase.e2e.json emulators:start --only firestore,auth --project demo-jntuh-notes

# 2. synthetic accounts
node e2e/seed.mjs admin      # e2e-admin@example.com  / e2e-password-123 (admin claim)
node e2e/seed.mjs nonadmin   # e2e-viewer@example.com / e2e-password-123 (no claim)

# 3. app pointed at the emulators
npx vite --mode e2e --port 5173 --strictPort

# 4. open in a browser (the ?path= sets the in-app route)
#    http://localhost:5173/e2e/harness.html?path=/admin/ingest

# optional: stage two synthetic notices mid-run
node e2e/seed.mjs notices

# optional: synthetic PUBLISHED alerts (plus one draft) for the homepage
# "Latest alerts" section
node e2e/seed.mjs alerts

# cleanup
node e2e/seed.mjs clear
```

`seed.mjs alerts` is what the homepage checks use: open
`http://localhost:5173/e2e/harness.html?path=/` for the populated state and
`node e2e/seed.mjs clear` for the empty state.

Stopping the emulator does **not** produce the error state: the Firestore SDK
falls back to its (empty) cache when it is offline, so the section shows the
empty state. To see the error state, run the emulator with rules that deny
`alerts` reads - any real read failure, such as permission-denied, drives it -
and the section's "Try again" recovers once reads succeed again.

`VITE_FIREBASE_MEASUREMENT_ID` is left empty on purpose so no analytics traffic
is generated.
