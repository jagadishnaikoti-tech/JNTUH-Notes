// ---------------------------------------------------------------------------
// JNTUH Alert Radar - data layer over Firestore `alerts/{id}`.
//
// Public read + admin CRUD, following the same conventions as lib/channels.js:
// one module owns the collection, the Firebase app/SDK come from the single
// bootstrap in lib/firebase.js, and nothing here creates a second Firebase
// instance or a second authentication system.
//
// Document shape:
//   { title, summary, category, sourceName, sourceUrl, publishedAt,
//     deadlineAt, status, pinned, audience, tags, verifiedAt, verifiedBy,
//     createdBy, updatedBy, createdAt, updatedAt, schemaVersion }
//
// Security is enforced in firestore.rules (never trusted from the client):
//   - anyone may read an alert only while `status == "published"`; the public
//     query filters `status == "published"`, which the rules require;
//   - only administrators (custom claim `admin == true`) may read drafts or
//     create / update / publish / unpublish / delete, and only admins can set
//     the verification metadata (`verifiedAt` / `verifiedBy`).
//
// The public query deliberately avoids a compound (status + date) query so it
// works on a brand-new project without extra composite indexes; ordering is
// applied client-side (same reasoning as lib/channels.js).
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadAuth, loadFirestore } from "./firebase.js";
import { ALERT_CATEGORY_IDS } from "../data/alertSources.js";

const COLLECTION = "alerts";
const SCHEMA_VERSION = 1;

const MAX_TITLE = 200;
const MAX_SUMMARY = 600;
const MAX_SOURCE_NAME = 80;
const MAX_URL = 500;
const MAX_ACTOR = 200;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 40;

export const ALERT_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
});

// --- small helpers ----------------------------------------------------------

function cleanText(value, maxLen) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLen);
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function toDateOrNull(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cleanList(value, maxItems = MAX_LIST_ITEMS, maxLen = MAX_LIST_ITEM) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = cleanText(raw, maxLen);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Pinned alerts first, then most recently published/created. */
function sortAlerts(list) {
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const ad = millis(a.publishedAt) || millis(a.createdAt);
    const bd = millis(b.publishedAt) || millis(b.createdAt);
    if (bd !== ad) return bd - ad;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

/**
 * The signed-in administrator's handle (email, falling back to uid) used for
 * the audit fields. Returns "" if it cannot be resolved - the rules, not this
 * value, decide who may write.
 */
async function currentActor(app) {
  try {
    const { getAuth } = await loadAuth();
    const user = getAuth(app).currentUser;
    return user ? cleanText(user.email || user.uid || "", MAX_ACTOR) : "";
  } catch {
    return "";
  }
}

// --- validation -------------------------------------------------------------

/**
 * Normalise and validate admin-supplied alert input. Throws a user-safe Error
 * when a required field is missing or invalid. Exported so the admin form can
 * validate before calling a write.
 */
export function cleanAlert(data = {}) {
  const title = cleanText(data.title, MAX_TITLE);
  const summary = cleanText(data.summary, MAX_SUMMARY);
  const category = cleanText(data.category, 40);
  const sourceName = cleanText(data.sourceName, MAX_SOURCE_NAME);
  const sourceUrl = cleanText(data.sourceUrl, MAX_URL);

  if (title.length < 3) {
    throw new Error("Please enter a title (at least 3 characters).");
  }
  if (!summary) {
    throw new Error("Please enter a short summary.");
  }
  if (!ALERT_CATEGORY_IDS.includes(category)) {
    throw new Error("Please choose a valid category.");
  }
  if (!sourceUrl) {
    throw new Error("Please add the official source link.");
  }
  if (!isHttpUrl(sourceUrl)) {
    throw new Error("The source link must be a valid http(s) URL.");
  }

  return {
    title,
    summary,
    category,
    sourceName,
    sourceUrl,
    status:
      data.status === ALERT_STATUS.PUBLISHED
        ? ALERT_STATUS.PUBLISHED
        : ALERT_STATUS.DRAFT,
    pinned: Boolean(data.pinned),
    audience: cleanList(data.audience),
    tags: cleanList(data.tags),
    publishedAt: toDateOrNull(data.publishedAt),
    deadlineAt: toDateOrNull(data.deadlineAt),
    schemaVersion: SCHEMA_VERSION,
  };
}

// --- public reads -----------------------------------------------------------

/** Public: published alerts only, safe to render for visitors. */
export async function fetchPublishedAlerts() {
  const app = await getFirebaseApp();
  if (!app) return [];
  try {
    const { getFirestore, collection, getDocs, query, where } =
      await loadFirestore();
    const db = getFirestore(app);
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where("status", "==", ALERT_STATUS.PUBLISHED)
      )
    );
    return sortAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.warn("[alerts] public read failed:", err?.code || err);
    return [];
  }
}

/** Public: a single published alert by id, or null when absent/unpublished. */
export async function fetchPublishedAlert(id) {
  if (!id) return null;
  const app = await getFirebaseApp();
  if (!app) return null;
  try {
    const { getFirestore, doc, getDoc } = await loadFirestore();
    const db = getFirestore(app);
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    const data = { id: snap.id, ...snap.data() };
    return data.status === ALERT_STATUS.PUBLISHED ? data : null;
  } catch (err) {
    // A draft read is denied by the rules, so a missing permission is expected
    // for anyone who is not an administrator.
    console.warn("[alerts] public read failed:", err?.code || err);
    return null;
  }
}

// --- admin reads / writes ---------------------------------------------------

/** Admin: every alert, draft or published. */
export async function fetchAllAlerts() {
  const app = await getFirebaseApp();
  if (!app) return [];
  const { getFirestore, collection, getDocs } = await loadFirestore();
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, COLLECTION));
  return sortAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/** Admin: create an alert. Published alerts are stamped as verified. */
export async function createAlert(input, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, collection, addDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);

  const fields = cleanAlert(input);
  const published = fields.status === ALERT_STATUS.PUBLISHED;
  if (published && !fields.publishedAt) fields.publishedAt = new Date();
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    return await addDoc(collection(db, COLLECTION), {
      ...fields,
      verifiedAt: published ? serverTimestamp() : null,
      verifiedBy: published ? who : "",
      createdBy: who,
      updatedBy: who,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] create failed:", err?.code || err);
    throw new Error("Could not save the alert. Please try again.");
  }
}

/** Admin: update an alert's content (does not change verification metadata). */
export async function updateAlert(id, input, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, updateDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);

  const fields = cleanAlert(input);
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      ...fields,
      updatedBy: who,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] update failed:", err?.code || err);
    throw new Error("Could not update the alert. Please try again.");
  }
}

/** Admin: publish an alert and record who verified it. */
export async function publishAlert(id, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, updateDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      status: ALERT_STATUS.PUBLISHED,
      verifiedAt: serverTimestamp(),
      verifiedBy: who,
      updatedBy: who,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] publish failed:", err?.code || err);
    throw new Error("Could not publish the alert. Please try again.");
  }
}

/** Admin: move an alert back to draft (verification metadata is kept). */
export async function unpublishAlert(id, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, updateDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      status: ALERT_STATUS.DRAFT,
      updatedBy: who,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] unpublish failed:", err?.code || err);
    throw new Error("Could not unpublish the alert. Please try again.");
  }
}

/** Admin: permanently delete an alert. */
export async function deleteAlert(id) {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, deleteDoc } = await loadFirestore();
  const db = getFirestore(app);

  try {
    return await deleteDoc(doc(db, COLLECTION, id));
  } catch (err) {
    console.warn("[alerts] delete failed:", err?.code || err);
    throw new Error("Could not delete the alert. Please try again.");
  }
}
