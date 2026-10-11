// ---------------------------------------------------------------------------
// Student (public) authentication.
//
// Identity comes from Firebase Authentication (email + password). This module
// is the single place that talks to Firebase Auth for the public website, so
// page components never repeat SDK logic.
//
// Security notes
//   * No passwords are ever written to Firestore or local storage - Firebase
//     Auth owns them.
//   * Creating an account grants NOTHING. Administrator access is a separate
//     custom claim (`admin: true`) set only by the Admin SDK (scripts/set-admin.mjs).
//   * Sign-in errors are deliberately vague ("Incorrect email or password") so
//     the form cannot be used to enumerate which emails have accounts.
//
// The Firebase SDK is imported dynamically (see lib/firebase.js), and every
// call degrades gracefully when Firebase is not configured.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadAuth, isFirebaseConfigured } from "./firebase.js";
import { ensureUserProfile, updateUserProfile } from "./userProfile.js";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_NAME_LENGTH = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

/** True when Firebase client config is present, so auth can actually run. */
export function isAuthAvailable() {
  return isFirebaseConfigured;
}

/**
 * Rough password-strength signal for guidance only (never a substitute for the
 * real Firebase policy). Returns { score: 0..4, label }.
 */
export function passwordStrength(value) {
  const v = String(value || "");
  let score = 0;
  if (v.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (v.length >= 12) score += 1;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
  if (/\d/.test(v)) score += 1;
  if (/[^A-Za-z0-9]/.test(v)) score += 1;
  score = Math.min(4, score);
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
}

// Friendly, non-enumerating messages for the errors Firebase can return here.
const AUTH_ERROR_MESSAGES = {
  "auth/unconfigured":
    "Sign-in is not available right now. Please try again later.",
  "auth/invalid-email": "That email address is not valid.",
  "auth/missing-email": "Please enter your email address.",
  "auth/missing-password": "Please enter your password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-login-credentials": "Incorrect email or password.",
  "auth/email-already-in-use":
    "An account already exists for that email. Try signing in instead.",
  "auth/weak-password": `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  "auth/too-many-requests":
    "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed":
    "Network error. Check your connection and try again.",
  "auth/operation-not-allowed":
    "Email and password sign-in is not enabled for this site.",
  "auth/configuration-not-found":
    "Email and password sign-in is not set up yet.",
  "auth/invalid-api-key": "The Firebase API key is not valid for this project.",
  "auth/requires-recent-login": "Please sign in again to continue.",
  "auth/unauthorized-continue-uri":
    "This site's address is not authorised for email links in Firebase.",
  "auth/unauthorized-domain":
    "This domain is not authorised for sign-in in Firebase.",
  "auth/expired-action-code": "That link has expired. Request a new email.",
  "auth/invalid-action-code": "That link is invalid. Request a new email.",
  "auth/internal-error": "Something went wrong. Please try again.",
};

export function authErrorMessage(err) {
  return AUTH_ERROR_MESSAGES[err?.code] || "Something went wrong. Please try again.";
}

async function getAuthInstance() {
  const app = await getFirebaseApp();
  if (!app) {
    const err = new Error("Firebase is not configured");
    err.code = "auth/unconfigured";
    throw err;
  }
  const mod = await loadAuth();
  return { auth: mod.getAuth(app), mod };
}

/**
 * Create a new account, set the display name, send a verification email and
 * create the Firestore profile document. Firebase signs the new user in
 * automatically, so the caller can navigate straight to the account page.
 */
export async function signUpStudent({ name, email, password }) {
  const app = await getFirebaseApp();
  if (!app) {
    const err = new Error("unconfigured");
    err.code = "auth/unconfigured";
    throw err;
  }
  const { getAuth, createUserWithEmailAndPassword, updateProfile, sendEmailVerification } =
    await loadAuth();
  const auth = getAuth(app);

  const cleanName = String(name || "").trim().slice(0, MAX_NAME_LENGTH);
  const cleanEmail = String(email || "").trim();

  const credential = await createUserWithEmailAndPassword(
    auth,
    cleanEmail,
    password
  );
  const user = credential.user;

  if (cleanName) {
    try {
      await updateProfile(user, { displayName: cleanName });
    } catch (err) {
      console.warn("[auth] could not set display name:", err?.code || err);
    }
  }

  // Verification is a soft flow: the account is usable immediately, and the
  // account page nudges the student to confirm their address.
  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.warn("[auth] verification email skipped:", err?.code || err);
  }

  // Best-effort profile document - never blocks a successful registration.
  await ensureUserProfile(user, { displayName: cleanName }).catch(() => {});

  return user;
}

/**
 * Sign in with email + password. `remember` selects persistence: Firebase's
 * local persistence survives browser restarts; session persistence does not.
 */
export async function signInStudent({ email, password, remember = true }) {
  const app = await getFirebaseApp();
  if (!app) {
    const err = new Error("unconfigured");
    err.code = "auth/unconfigured";
    throw err;
  }
  const {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signInWithEmailAndPassword,
  } = await loadAuth();
  const auth = getAuth(app);

  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence
  );
  const credential = await signInWithEmailAndPassword(
    auth,
    String(email || "").trim(),
    password
  );
  return credential.user;
}

export async function signOutStudent() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, signOut } = await loadAuth();
  await signOut(getAuth(app));
}

/**
 * Send a password-reset email. Deliberately resolves (rather than throwing) when
 * the address has no account, so the UI cannot be used to discover registered
 * emails.
 */
export async function sendPasswordReset(email) {
  const app = await getFirebaseApp();
  if (!app) {
    const err = new Error("unconfigured");
    err.code = "auth/unconfigured";
    throw err;
  }
  const { getAuth, sendPasswordResetEmail } = await loadAuth();
  try {
    await sendPasswordResetEmail(getAuth(app), String(email || "").trim());
  } catch (err) {
    if (err?.code === "auth/user-not-found") return;
    throw err;
  }
}

export async function resendVerificationEmail(user) {
  const app = await getFirebaseApp();
  if (!app || !user) return;
  const { sendEmailVerification } = await loadAuth();
  await sendEmailVerification(user);
}

/** Re-read the signed-in user (e.g. to pick up a verified email). */
export async function reloadStudent(user) {
  if (!user) return null;
  await user.reload();
  return user;
}

/** Change the display name in Firebase Auth and mirror it to the profile doc. */
export async function updateStudentDisplayName(user, name) {
  if (!user) throw new Error("No signed-in user.");
  const cleanName = String(name || "").trim().slice(0, MAX_NAME_LENGTH);
  const { updateProfile } = await loadAuth();
  await updateProfile(user, { displayName: cleanName });
  await updateUserProfile(user.uid, { displayName: cleanName }).catch(() => {});
  return cleanName;
}

/**
 * Subscribe to Firebase Auth state for the public site.
 * Resolves to: "unconfigured" | "signed-in" | "signed-out".
 */
export function observeStudentAuth(callback) {
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
      unsub = onAuthStateChanged(auth, (user) => {
        if (!active) return;
        callback({ status: user ? "signed-in" : "signed-out", user });
      });
    } catch (err) {
      console.warn("[auth] unavailable:", err?.code || err);
      if (active) callback({ status: "unconfigured", user: null });
    }
  })();
  return () => {
    active = false;
    unsub();
  };
}

/**
 * Validate a post-authentication redirect target. Only same-origin, absolute
 * paths are accepted, which prevents open-redirect abuse via ?next=.
 */
export function safeNext(value, fallback = "/") {
  if (typeof value !== "string") return fallback;
  const next = value.trim();
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;
  return next;
}
