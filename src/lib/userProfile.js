// ---------------------------------------------------------------------------
// Student profile documents in Cloud Firestore (`users/{uid}`).
//
// The document is intentionally tiny and contains only what the account page
// shows: the display name, the account email and timestamps. It never contains
// passwords, tokens or roles.
//
// Authorization never reads from this collection - administrator access is a
// Firebase custom claim. Security rules (firestore.rules) restrict a student to
// their own document and to a whitelist of fields.
//
// Every function here is best-effort: a failure to read or write the profile
// must never block sign-in, sign-up or browsing.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadFirestore, isFirebaseConfigured } from "./firebase.js";

const COLLECTION = "users";
const MAX_NAME = 120;

async function userDocRef(uid) {
  if (!isFirebaseConfigured || !uid) return null;
  const app = await getFirebaseApp();
  if (!app) return null;
  const { getFirestore, doc } = await loadFirestore();
  return doc(getFirestore(app), COLLECTION, uid);
}

/** Read `users/{uid}`, returning a plain object or null. */
export async function loadUserProfile(uid) {
  const ref = await userDocRef(uid);
  if (!ref) return null;
  try {
    const { getDoc } = await loadFirestore();
    const snapshot = await getDoc(ref);
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (err) {
    console.warn("[profile] read failed:", err?.code || err);
    return null;
  }
}

/**
 * Create `users/{uid}` when it is missing. If it already exists, only a changed
 * display name is synced - nothing else is overwritten.
 */
export async function ensureUserProfile(user, { displayName } = {}) {
  if (!user?.uid) return null;
  const ref = await userDocRef(user.uid);
  if (!ref) return null;

  const name = String(displayName ?? user.displayName ?? "")
    .trim()
    .slice(0, MAX_NAME);
  const email = String(user.email || "").slice(0, 200);

  try {
    const { getDoc, setDoc, updateDoc, serverTimestamp } = await loadFirestore();
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      await setDoc(ref, {
        displayName: name,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { id: user.uid, displayName: name, email };
    }

    const data = snapshot.data() || {};
    if (name && name !== data.displayName) {
      await updateDoc(ref, { displayName: name, updatedAt: serverTimestamp() });
      return { id: user.uid, ...data, displayName: name };
    }
    return { id: user.uid, ...data };
  } catch (err) {
    console.warn("[profile] write skipped:", err?.code || err);
    return null;
  }
}

/** Update the student's own display name (and nothing else). */
export async function updateUserProfile(uid, { displayName } = {}) {
  if (!uid || displayName == null) return;
  const ref = await userDocRef(uid);
  if (!ref) return;
  try {
    const { setDoc, serverTimestamp } = await loadFirestore();
    // merge:true also creates the document if it was somehow never written.
    await setDoc(
      ref,
      { displayName: String(displayName).trim().slice(0, MAX_NAME), updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.warn("[profile] update skipped:", err?.code || err);
  }
}
