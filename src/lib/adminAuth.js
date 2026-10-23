// ---------------------------------------------------------------------------
// Administrator authentication.
//
// Identity comes from Firebase Authentication (email + password). Authorization
// is a custom claim (`admin: true`) that only a privileged Admin SDK process
// can set - creating an account never grants administrator access (see
// docs/ADMIN_SETUP.md and scripts/set-admin.mjs).
//
// Staging is a SEPARATE Firebase project, and a Firebase Auth session is scoped
// to one project. The production session therefore does not authenticate the
// staging Firestore reads/writes. After a successful production sign-in we make
// a best-effort attempt to sign in to staging with the same credentials; if
// that fails, the /admin/ingest page shows an explicit "connect staging" form.
// Production access never depends on the staging project.
//
// Persistence is deliberately session-scoped: closing the browser signs the
// administrator out. Change PERSISTENCE below to browserLocalPersistence if you
// would rather keep the session across restarts.
// ---------------------------------------------------------------------------

import {
  getFirebaseApp,
  getStagingApp,
  isFirebaseConfigured,
  isStagingConfigured,
  loadAuth,
} from "./firebase.js";

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

/** Sign in to one already-initialised Firebase app. */
async function signInToApp(app, email, password) {
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
  return credential.user;
}

export async function signInAdmin(email, password) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured for this deployment.");
  const user = await signInToApp(app, email, password);

  // Best effort: the review page reports its own staging state if this fails.
  // Never let a staging problem block production sign-in.
  if (isStagingConfigured) {
    try {
      await signInToStaging(email, password);
    } catch (err) {
      console.warn("[admin] staging sign-in failed:", err?.code || err?.message || err);
    }
  }

  return user;
}

/**
 * Sign in to the staging project with the same administrator credentials. The
 * staging project must grant this account the `admin` custom claim; its rules
 * verify that claim independently of production.
 */
export async function signInToStaging(email, password) {
  const app = await getStagingApp();
  if (!app) {
    throw new Error(
      "The staging project is not configured for this deployment (set VITE_STAGING_FIREBASE_*)."
    );
  }
  return signInToApp(app, email, password);
}

export async function signOutAdmin() {
  const [app, stagingApp] = await Promise.all([getFirebaseApp(), getStagingApp()]);
  const { getAuth, signOut } = await loadAuth();
  const tasks = [];
  if (app) tasks.push(signOut(getAuth(app)).catch(() => {}));
  if (stagingApp) tasks.push(signOut(getAuth(stagingApp)).catch(() => {}));
  await Promise.all(tasks);
}

/** Sign out of the staging project only, leaving the production session alone. */
export async function signOutStaging() {
  const stagingApp = await getStagingApp();
  if (!stagingApp) return;
  const { getAuth, signOut } = await loadAuth();
  await signOut(getAuth(stagingApp)).catch(() => {});
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

/**
 * Subscribe to the STAGING project's auth session. Statuses are the same as
 * `observeAuth`, plus "unavailable" when the staging project cannot be reached.
 * The staging project enforces its own `admin` claim in firestore.staging.rules.
 */
export function observeStagingAuth(callback) {
  if (!isStagingConfigured) {
    callback({ status: "unconfigured", user: null });
    return () => {};
  }
  let active = true;
  let unsub = () => {};
  (async () => {
    try {
      const app = await getStagingApp();
      if (!app) {
        if (active) callback({ status: "unconfigured", user: null });
        return;
      }
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
        if (active) callback({ status: ok ? "admin" : "forbidden", user });
      });
    } catch (err) {
      console.warn("[admin] staging auth unavailable:", err?.code || err?.message || err);
      if (active) callback({ status: "unavailable", user: null });
    }
  })();
  return () => {
    active = false;
    unsub();
  };
}
