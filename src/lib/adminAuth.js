// ---------------------------------------------------------------------------
// Administrator authentication.
//
// Identity comes from Firebase Authentication (email + password). Authorization
// is a custom claim (`admin: true`) that only a privileged Admin SDK process
// can set - creating an account never grants administrator access (see
// docs/ADMIN_SETUP.md and scripts/set-admin.mjs).
//
// Persistence is deliberately session-scoped: closing the browser signs the
// administrator out. Change PERSISTENCE below to browserLocalPersistence if you
// would rather keep the session across restarts.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadAuth, isFirebaseConfigured } from "./firebase.js";

export const ADMIN_CLAIM = "admin";
const PERSISTENCE = "session"; // "session" | "local"

const AUTH_ERRORS = {
  "auth/invalid-email": "That email address is not valid.",
  "auth/missing-password": "Please enter your password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/user-not-found": "No account found for that email.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed": "Email/password sign-in is not enabled for this project.",
};

export function friendlyAuthError(err) {
  const code = err?.code || "";
  return AUTH_ERRORS[code] || "Sign-in failed. Please try again.";
}

export async function signInAdmin(email, password) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured for this deployment.");
  const {
    getAuth,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    signInWithEmailAndPassword,
  } = await loadAuth();
  const auth = getAuth(app);
  await setPersistence(
    auth,
    PERSISTENCE === "local" ? browserLocalPersistence : browserSessionPersistence
  );
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOutAdmin() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, signOut } = await loadAuth();
  await signOut(getAuth(app));
}

/** Whether the signed-in user carries the `admin: true` custom claim. */
export async function isAdminUser(user) {
  if (!user) return false;
  const { getIdTokenResult } = await loadAuth();
  const token = await getIdTokenResult(user, true); // force refresh
  return token?.claims?.[ADMIN_CLAIM] === true;
}

/**
 * Subscribe to Firebase Auth and resolve the administrator status.
 * Returns one of: "unconfigured" | "loading" | "signed-out" | "forbidden" | "admin".
 */
export function observeAuth(callback) {
  if (!isFirebaseConfigured) {
    callback({ status: "unconfigured", user: null });
    return () => {};
  }
  let active = true;
  let unsub = () => {};
  (async () => {
    try {
      const app = await getFirebaseApp();
      const { getAuth, onAuthStateChanged } = await loadAuth();
      const auth = getAuth(app);
      unsub = onAuthStateChanged(auth, async (user) => {
        if (!active) return;
        if (!user) {
          callback({ status: "signed-out", user: null });
          return;
        }
        let ok = false;
        try {
          ok = await isAdminUser(user);
        } catch {
          ok = false;
        }
        if (active) {
          callback({ status: ok ? "admin" : "forbidden", user });
        }
      });
    } catch (err) {
      console.warn("[admin] auth unavailable:", err);
      if (active) callback({ status: "unconfigured", user: null });
    }
  })();
  return () => {
    active = false;
    unsub();
  };
}
