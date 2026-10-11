// ---------------------------------------------------------------------------
// Firebase client bootstrap.
//
// Every value comes from Vite env vars (VITE_*). The Firebase *web* config is
// public by design - it ships in the browser bundle and is not a secret. It is
// still read from env so deployments can point at different projects and so
// that no credentials ever live in source control.
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

/** Whether a usable Firebase project is configured for this deployment. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let appPromise = null;

/**
 * Initialised Firebase app, or null when unconfigured/unavailable. Cached as a
 * promise so concurrent callers share one initializeApp() call.
 */
export function getFirebaseApp() {
  if (!isFirebaseConfigured) return Promise.resolve(null);
  if (!appPromise) {
    appPromise = import("firebase/app")
      .then(({ initializeApp, getApp, getApps }) =>
        getApps().length ? getApp() : initializeApp(firebaseConfig)
      )
      .catch((err) => {
        // Never let a bad config take the whole site down.
        console.warn("[firebase] initialisation failed:", err);
        return null;
      });
  }
  return appPromise;
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

/** Convenience: an initialised Firestore instance, or null. */
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
