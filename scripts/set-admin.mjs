// ---------------------------------------------------------------------------
// Grant or revoke administrator access for an existing Firebase Auth user.
//
//   Usage:
//     node scripts/set-admin.mjs <email>            # grant `admin: true`
//     node scripts/set-admin.mjs <email> --remove   # remove the claim
//
// Authentication uses Application Default Credentials, so set one of:
//   * GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"  (recommended)
#   * gcloud auth application-default login
//
// The service-account JSON is a SECRET. Never commit it - it is git-ignored.
// The user must sign out and back in (or force-refresh their token) afterwards.
// ---------------------------------------------------------------------------

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.argv[2];
const remove = process.argv.includes("--remove");

if (!email || email.startsWith("-")) {
  console.error(
    "Usage: node scripts/set-admin.mjs <email> [--remove]\n" +
      "Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON."
  );
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCLOUD_PROJECT) {
  console.warn(
    "[warn] GOOGLE_APPLICATION_CREDENTIALS is not set. Make sure application " +
      "default credentials are available (e.g. `gcloud auth application-default login`)."
  );
}

try {
  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, remove ? { admin: false } : { admin: true });
  console.log(
    `${remove ? "Removed" : "Granted"} the admin claim for ${email} (uid: ${user.uid}).`
  );
  console.log(
    "The user must sign out and sign back in (or refresh their token) before the change takes effect."
  );
} catch (err) {
  console.error("Failed to update the admin claim:", err?.message || err);
  process.exit(1);
}
