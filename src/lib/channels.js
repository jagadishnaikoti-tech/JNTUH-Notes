// ---------------------------------------------------------------------------
// Social channels: public read + admin CRUD over Firestore `channels/{id}`.
//
// Document shape:
//   { name: string, url: string, icon: string, active: boolean,
//     order: number, createdAt, updatedAt }
//
// Security is enforced in firestore.rules:
//   - anyone may read a channel only while it is active (the public query
//     filters `active == true`, which the rules require);
//   - only administrators may read inactive channels or write at all.
//
// The public query deliberately avoids a compound (active + order) query so it
// works on a brand-new project without extra composite indexes; ordering is
// applied client-side.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadFirestore } from "./firebase.js";

const COLLECTION = "channels";

function sortChannels(list) {
  return [...list].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 999;
    const bo = Number.isFinite(b.order) ? b.order : 999;
    if (ao !== bo) return ao - bo;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/** Public: active channels only, safe to render for visitors. */
export async function fetchPublicChannels() {
  const app = await getFirebaseApp();
  if (!app) return [];
  try {
    const { getFirestore, collection, getDocs, query, where } = await loadFirestore();
    const db = getFirestore(app);
    const snap = await getDocs(
      query(collection(db, COLLECTION), where("active", "==", true))
    );
    return sortChannels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.warn("[channels] public read failed:", err?.code || err);
    return [];
  }
}

/** Admin: every channel, active or not. */
export async function fetchAllChannels() {
  const app = await getFirebaseApp();
  if (!app) return [];
  const { getFirestore, collection, getDocs } = await loadFirestore();
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, COLLECTION));
  return sortChannels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

function cleanChannel(data) {
  return {
    name: String(data.name || "").trim().slice(0, 80),
    url: String(data.url || "").trim().slice(0, 500),
    icon: String(data.icon || "other"),
    active: Boolean(data.active),
    order: Number.isFinite(Number(data.order)) ? Number(data.order) : 999,
  };
}

export async function createChannel(data) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, collection, addDoc, serverTimestamp } = await loadFirestore();
  const db = getFirestore(app);
  return addDoc(collection(db, COLLECTION), {
    ...cleanChannel(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateChannel(id, data) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, updateDoc, serverTimestamp } = await loadFirestore();
  const db = getFirestore(app);
  return updateDoc(doc(db, COLLECTION, id), {
    ...cleanChannel(data),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteChannel(id) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, deleteDoc } = await loadFirestore();
  const db = getFirestore(app);
  return deleteDoc(doc(db, COLLECTION, id));
}
