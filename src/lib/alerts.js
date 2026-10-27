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

/**
 * The Firestore collection alerts live in. Exported so other modules (the
 * atomic ingestion promotion in lib/ingest.js) share one constant instead of
 * hard-coding the string.
 */
export const ALERT_COLLECTION = COLLECTION;

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

/**
 * Force the scheme to lower case. `new URL()` accepts `HTTPS://…` but the
 * rules require `sourceUrl.matches('^https?://.+')`, which is case-sensitive,
 * so normalising here keeps the client validation and the authoritative rules
 * in agreement instead of surfacing as an opaque permission error.
 */
function normaliseHttpUrl(value) {
  return cleanText(value, MAX_URL).replace(
    /^(https?):\/\//i,
    (_, scheme) => `${scheme.toLowerCase()}://`
  );
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

/**
 * Re-throw with a user-safe message while preserving Firestore's `code`
 * (e.g. `permission-denied`) so the admin UI can explain what actually
 * failed instead of showing a generic failure.
 */
function userError(err, message) {
  const wrapped = new Error(message);
  if (err?.code) wrapped.code = err.code;
  return wrapped;
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
  const sourceUrl = normaliseHttpUrl(data.sourceUrl);

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

/**
 * Resolve the Firestore context for a public read. Production callers get the
 * real instance; tests inject `{ context: { db, sdk } }` (the same seam
 * lib/ingest.js uses). Returns null when Firebase is not configured, so an
 * unconfigured deployment degrades to an empty feed rather than an error.
 */
async function publicReadContext(deps) {
  if (deps && deps.context) return deps.context;
  const app = await getFirebaseApp();
  if (!app) return null;
  const sdk = await loadFirestore();
  return { app, sdk, db: sdk.getFirestore(app) };
}

/**
 * The single public read behind every alert list. Returns `{ alerts, error }`
 * so callers can tell an empty feed apart from a failed read - a distinction
 * public alert views need to show a real error state.
 *
 * The query filters `status == "published"`, which firestore.rules require for
 * an anonymous read, so a draft can never be returned here even if the rules
 * were ever loosened on the write side.
 */
export async function readPublishedAlerts(deps) {
  try {
    const ctx = await publicReadContext(deps);
    if (!ctx) return { alerts: [], error: false };
    const { sdk, db } = ctx;
    const snap = await sdk.getDocs(
      sdk.query(
        sdk.collection(db, COLLECTION),
        sdk.where("status", "==", ALERT_STATUS.PUBLISHED)
      )
    );
    return {
      alerts: sortAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      error: false,
    };
  } catch (err) {
    console.warn("[alerts] public read failed:", err?.code || err);
    return { alerts: [], error: true };
  }
}

/** Resolve the public feed view state from its load state and read result. */
export function getPublishedAlertsViewState({
  loading = false,
  error = false,
  alerts = [],
} = {}) {
  if (loading) return "loading";
  if (error) return "error";
  return alerts.length > 0 ? "ready" : "empty";
}

/**
 * Public: published alerts only, safe to render for visitors. Retains the
 * original array return type; callers that need read-failure details should
 * use `readPublishedAlerts`.
 */
export async function fetchPublishedAlerts(deps) {
  const { alerts } = await readPublishedAlerts(deps);
  return alerts;
}

/** How many alerts the homepage "Latest alerts" section shows. */
export const HOME_ALERTS_LIMIT = 4;

/**
 * Public: the newest few published alerts for the homepage. `sortAlerts` puts
 * pinned notices first and then the most recently published, so this is
 * genuinely the "latest". The read's success flag travels with the list so the
 * section can distinguish "no alerts yet" from "the read failed".
 */
export async function fetchLatestPublishedAlerts(deps) {
  const { alerts, error } = await readPublishedAlerts(deps);
  return { alerts: alerts.slice(0, HOME_ALERTS_LIMIT), error };
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

/**
 * The exact field set written for a NEW alert document (everything except the
 * document id). Pure and SDK-agnostic, so the SAME draft shape is produced by
 * `createAlert()` below and by the atomic promotion transaction in
 * `lib/ingest.js` - there is only ever one way a draft gets built.
 *
 * `serverTimestamp` is injected so the caller supplies the SDK sentinel (a
 * plain marker object Firestore resolves server-side, which is also valid
 * inside a transaction). Verification metadata is always cleared here: only
 * `verifyAlert()` may set it, so nothing created through this builder can be
 * born verified or published.
 */
export function buildAlertDocument(fields, actor, serverTimestamp) {
  const who = cleanText(actor, MAX_ACTOR);
  return {
    ...fields,
    verifiedAt: null,
    verifiedBy: "",
    createdBy: who,
    updatedBy: who,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/** Admin: create an alert. Every alert starts as an unverified draft. */
export async function createAlert(input, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, collection, addDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);

  const fields = cleanAlert(input);
  if (fields.status === ALERT_STATUS.PUBLISHED) {
    // Verification is a deliberate act (verifyAlert) - never a side effect of
    // creating or publishing, so a published doc always carries real metadata.
    throw new Error(
      "New alerts always start as drafts. Save it, verify it, then publish."
    );
  }
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    return await addDoc(
      collection(db, COLLECTION),
      buildAlertDocument(fields, who, serverTimestamp)
    );
  } catch (err) {
    console.warn("[alerts] create failed:", err?.code || err);
    throw userError(err, "Could not save the alert. Please try again.");
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
    throw userError(err, "Could not update the alert. Please try again.");
  }
}

/**
 * Admin: record that an alert was checked against the official source. This is
 * deliberately separate from publishing, so a draft can be marked verified
 * without becoming public and verification never happens as a side effect of
 * another action. `verifiedAt` / `verifiedBy` are the Phase 0 fields for this;
 * no schema change is required.
 */
export async function verifyAlert(id, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, updateDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      verifiedAt: serverTimestamp(),
      verifiedBy: who,
      updatedBy: who,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] verify failed:", err?.code || err);
    throw userError(err, "Could not record verification. Please try again.");
  }
}

/**
 * Admin: publish an alert. Publishing is only offered after verification and
 * REQUIRES it: an unverified notice is refused rather than stamped, so
 * `verifiedAt` / `verifiedBy` are only ever written by verifyAlert(). The rules
 * enforce the same invariant server-side (published => valid verification
 * metadata).
 */
export async function publishAlert(id, actor = "") {
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  const { getFirestore, doc, getDoc, updateDoc, serverTimestamp } =
    await loadFirestore();
  const db = getFirestore(app);
  const who = cleanText(actor, MAX_ACTOR) || (await currentActor(app));
  const ref = doc(db, COLLECTION, id);

  let existing;
  try {
    const snap = await getDoc(ref);
    existing = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("[alerts] publish read failed:", err?.code || err);
    throw userError(err, "Could not read the alert. Please try again.");
  }

  // Thrown outside the catch blocks below so the message reaches the UI intact.
  if (!existing) {
    throw new Error("This alert no longer exists. Refresh the list and try again.");
  }
  if (!existing.verifiedAt) {
    throw new Error(
      "Verify this alert against the official source before publishing it."
    );
  }

  try {
    await updateDoc(ref, {
      status: ALERT_STATUS.PUBLISHED,
      updatedBy: who,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[alerts] publish failed:", err?.code || err);
    throw userError(err, "Could not publish the alert. Please try again.");
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
    throw userError(err, "Could not unpublish the alert. Please try again.");
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
    throw userError(err, "Could not delete the alert. Please try again.");
  }
}
