// ---------------------------------------------------------------------------
// Firebase client bootstrap.
//
// Two Firebase projects are used:
//   * the production app (VITE_FIREBASE_*) - public site, `alerts`, users;
//   * an optional staging app (VITE_STAGING_FIREBASE_*) - the collector's
//     `ingestItems` / `ingestRuns` / `ingestSourceHealth` review data.
//
// A Firebase Auth session is scoped to one project, so staging is a second,
// named Firebase app with its own sign-in. Both web configs are public by
// design - they ship in the browser bundle and are not secrets. They are still
// read from env so deployments can point at different projects and so that no
// credentials ever live in source control.
//
// Performance: the Firebase SDK is imported dynamically, on demand. Public
// visitors who never trigger an analytics write (or an admin route) never
// download any Firebase code, and the heavy Firestore/Auth/Analytics SDKs are
// additionally split into their own chunks by the bundler.
// ---------------------------------------------------------------------------

const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const stagingFirebaseConfig = {
  apiKey: env.VITE_STAGING_FIREBASE_API_KEY,
  authDomain: env.VITE_STAGING_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_STAGING_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_STAGING_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_STAGING_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_STAGING_FIREBASE_APP_ID,
};

/**
 * The only staging project this build may talk to. Hard-coded on purpose: a
 * typo in VITE_STAGING_FIREBASE_PROJECT_ID must not silently point the admin
 * review UI at production (or any other project).
 */
export const EXPECTED_STAGING_PROJECT_ID = "jntuh-notes-staging";

/** Whether a usable production Firebase project is configured. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

/**
 * Whether the optional staging project is configured *and* points at the
 * expected project. A mismatch is treated as "not configured" (fail closed).
 */
export const isStagingConfigured =
  Boolean(
    stagingFirebaseConfig.apiKey &&
      stagingFirebaseConfig.projectId &&
      stagingFirebaseConfig.appId
  ) && stagingFirebaseConfig.projectId === EXPECTED_STAGING_PROJECT_ID;

const DEFAULT_APP_NAME = "[DEFAULT]";
const STAGING_APP_NAME = "jntuh-staging";

let appPromise = null;

/**
 * Initialised production Firebase app, or null when unconfigured/unavailable.
 * Cached as a promise so concurrent callers share one initializeApp() call.
 */
export function getFirebaseApp() {
  if (!isFirebaseConfigured) return Promise.resolve(null);
  if (!appPromise) {
    appPromise = import("firebase/app")
      .then(({ initializeApp, getApps }) => {
        const existing = getApps().find((app) => app.name === DEFAULT_APP_NAME);
        return existing || initializeApp(firebaseConfig);
      })
      .catch((err) => {
        // Never let a bad config take the whole site down.
        console.warn("[firebase] initialisation failed:", err);
        return null;
      });
  }
  return appPromise;
}

let stagingAppPromise = null;

/**
 * Initialised staging Firebase app, or null when unconfigured/unavailable.
 * It is a named app so it can coexist with the production default app.
 */
export function getStagingApp() {
  if (!isStagingConfigured) {
    if (
      stagingFirebaseConfig.projectId &&
      stagingFirebaseConfig.projectId !== EXPECTED_STAGING_PROJECT_ID
    ) {
      console.warn(
        `[firebase] refusing unexpected staging project "${stagingFirebaseConfig.projectId}" (expected "${EXPECTED_STAGING_PROJECT_ID}")`
      );
    }
    return Promise.resolve(null);
  }
  if (!stagingAppPromise) {
    stagingAppPromise = import("firebase/app")
      .then(({ initializeApp, getApps }) => {
        const existing = getApps().find((app) => app.name === STAGING_APP_NAME);
        return existing || initializeApp(stagingFirebaseConfig, STAGING_APP_NAME);
      })
      .catch((err) => {
        console.warn("[firebase] staging initialisation failed:", err);
        return null;
      });
  }
  return stagingAppPromise;
}

// --- Lazy SDK loaders -------------------------------------------------------
// Each heavy SDK is imported the first time it is needed and cached by the
// browser module loader afterwards.

let firestoreSdk = null;
export function loadFirestore() {
  if (!firestoreSdk) firestoreSdk = import("firebase/firestore");
  return firestoreSdk;
}

let authSdk = null;
export function loadAuth() {
  if (!authSdk) authSdk = import("firebase/auth");
  return authSdk;
}

let analyticsSdk = null;
let analyticsInstance = null;
export async function loadAnalytics() {
  if (!isFirebaseConfigured || !firebaseConfig.measurementId) return null;
  const app = await getFirebaseApp();
  if (!app) return null;
  try {
    if (!analyticsSdk) analyticsSdk = import("firebase/analytics");
    const mod = await analyticsSdk;
    if (!analyticsInstance) {
      // getAnalytics may throw in unsupported environments (e.g. webviews).
      analyticsInstance = mod.getAnalytics(app);
    }
    return { ...mod, analytics: analyticsInstance };
  } catch (err) {
    console.warn("[firebase] analytics unavailable:", err);
    return null;
  }
}

/** Convenience: an initialised production Firestore instance, or null. */
export async function getFirestoreDb() {
  const app = await getFirebaseApp();
  if (!app) return null;
  try {
    const { getFirestore } = await loadFirestore();
    return getFirestore(app);
  } catch (err) {
    console.warn("[firebase] firestore unavailable:", err);
    return null;
  }
}
