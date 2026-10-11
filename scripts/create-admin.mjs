// ---------------------------------------------------------------------------
// Create (or update) a Firebase Auth administrator and grant the `admin` claim.
//
//   Usage:
//     node scripts/create-admin.mjs <email>                      # create if missing
//     node scripts/create-admin.mjs <email> --reset-password     # also set a new password
//
// The password is read from the ADMIN_PASSWORD environment variable. It is never
// taken from the command line (so it does not end up in shell history) and it is
// never written to Firestore or committed to the repository.
//
// Authentication uses Application Default Credentials, so set:
//   GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
//
// The service-account JSON is a SECRET. It is git-ignored and must never be
// committed or shipped to the browser.
// ---------------------------------------------------------------------------

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.argv[2];
const resetPassword = process.argv.includes("--reset-password");
const password = process.env.ADMIN_PASSWORD;

if (!email || email.startsWith("-")) {
  console.error(
    "Usage: node scripts/create-admin.mjs <email> [--reset-password]\n" +
      "Requires GOOGLE_APPLICATION_CREDENTIALS and, to set a password, ADMIN_PASSWORD."
  );
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn(
    "[warn] GOOGLE_APPLICATION_CREDENTIALS is not set. Falling back to " +
      "application default credentials (e.g. `gcloud auth application-default login`)."
  );
}

try {
  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`User already exists: ${email} (uid: ${user.uid}).`);

    if (resetPassword) {
      if (!password) {
        console.error(
          "Refusing to reset the password: set the ADMIN_PASSWORD environment variable."
        );
        process.exit(1);
      }
      await auth.updateUser(user.uid, { password, emailVerified: true });
      console.log("Password updated.");
    }
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;

    if (!password) {
      console.error(
        `User ${email} does not exist. Set the ADMIN_PASSWORD environment ` +
          "variable so the account can be created."
      );
      process.exit(1);
    }

    user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
    });
    console.log(`Created user: ${email} (uid: ${user.uid}).`);
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted the admin claim (admin: true) to ${email}.`);
  console.log(
    "The user must sign out and back in (or force-refresh the ID token) " +
      "before the claim appears."
  );
} catch (err) {
  console.error(`Failed: ${err?.message ?? err}`);
  process.exit(1);
}
