// ---------------------------------------------------------------------------
// JNTUH Alert Radar - admin client for the ingestion STAGING collections:
//
//   ingestItems        one document per staged notice the collector saw
//   ingestRuns         one document per collector run ("what happened?")
//   ingestSourceHealth one document per official source (last attempt / success)
//
// STAGING LIVES IN ITS OWN DATABASE. Those three collections are read and
// written in the named Firestore database `staging`, never in `(default)`. The
// public `alerts` collection - and every other app collection - stays in
// `(default)`. This module therefore opens TWO Firestore handles from the one
// app: `db` (staging) for the ingest collections and `alertsDb` (default) for
// the alert a promotion creates. Nothing here can read or write the public
// `alerts` collection through the staging handle, and nothing can read or write
// the ingest collections through the default handle: the two rulesets
// (firestore.staging.rules / firestore.rules) deny each other's collections.
// See collector/SECURITY.md for why the split exists.
//
// This module is the ONLY frontend code that talks to those collections, the
// same way lib/alerts.js owns `alerts/{id}` and lib/channels.js owns its
// collection. It reuses the single Firebase bootstrap in lib/firebase.js and
// the existing admin authorization (custom claim `admin == true`) enforced in
// the rules - it never creates a second Firebase *app*, never imports the
// Firebase Admin SDK, and never touches `firebase/firestore` directly (the SDK
// is loaded on demand so public visitors never download it).
//
// What this module deliberately does NOT do:
//   * it never verifies or publishes an alert (that stays exclusive to
//     lib/alerts.js - verifyAlert / publishAlert);
//   * it never fabricates a summary, deadline, rating or count. A promotion
//     carries only what an administrator typed plus the real notice metadata
//     the collector recorded.
//
// Promotion spans two databases, and Firestore has no cross-database
// transaction, so `promoteIngestItem()` is two steps that are each safe to
// retry: (1) create the alert DRAFT in `(default)` with a deterministic id and
// only if that document does not already exist, then (2) claim the staged item
// in `staging` inside a transaction. A notice can therefore never produce two
// alerts, an existing alert is never overwritten, and an interruption between
// the steps leaves the item re-promotable (the retry finds the draft it already
// made and finishes the claim) - it can never strand or duplicate a notice.
//
// Testability: every function accepts an optional final `deps` argument whose
// `context` supplies `{ db, sdk, app, alertsDb? }`. Production callers omit it
// and the real Firebase instance is used; tests inject fakes or an emulator
// instance. When an injected context has no `alertsDb`, the alert write falls
// back to `db` so single-database fakes stay simple.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadFirestore, loadAuth } from "./firebase.js";
import {
  ALERT_COLLECTION,
  ALERT_STATUS,
  buildAlertDocument,
  cleanAlert,
} from "./alerts.js";

/** Staging collection names. They must match firestore.staging.rules and the collector. */
export const INGEST_COLLECTIONS = Object.freeze({
  ITEMS: "ingestItems",
  RUNS: "ingestRuns",
  HEALTH: "ingestSourceHealth",
});

/**
 * The named Firestore database that holds the collector's staging collections.
 * `(default)` is deliberately NOT accepted as a value here: staging data must
 * never share the public database, and a mismatch must fail loudly rather than
 * silently write to the wrong place. Must match collector/lib/runReport.mjs.
 */
export const STAGING_DATABASE_ID = "staging";

/**
 * The alert document id a promotion derives from a staged notice id. It is
 * deterministic on purpose: retrying a promotion targets the same document, so
 * a second alert can never be created for one notice even if the two steps
 * (create draft, claim item) are split by a failure.
 */
export function promotionAlertId(itemId) {
  const clean = String(itemId || "").trim();
  if (!clean) throw new Error("A staged notice id is required.");
  // Firestore document ids cannot contain "/"; keep the id short (the rules cap
  // `promotedAlertId` at 200 characters).
  const safe = clean.replace(/\//g, "_").slice(0, 180);
  return `ingest-${safe}`;
}

/** True when `databaseId` names the staging database (and only that). */
export function isStagingDatabase(databaseId) {
  return databaseId === STAGING_DATABASE_ID;
}

/** The only review states the rules allow on a staged item. */
export const REVIEW_STATE = Object.freeze({
  NEW: "new",
  PROMOTED: "promoted",
  IGNORED: "ignored",
});

/** Ordered list, handy for filters and validation. */
export const REVIEW_STATES = Object.freeze([
  REVIEW_STATE.NEW,
  REVIEW_STATE.PROMOTED,
  REVIEW_STATE.IGNORED,
]);

/** Review-state values the UI can filter by, including the "no filter" option. */
export const REVIEW_FILTER_ALL = "all";

export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_RUN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const MAX_ACTOR = 200;

// --- small helpers ----------------------------------------------------------

function clampPageSize(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
}

function cleanText(value, maxLen) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return maxLen && trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function isPermissionError(err) {
  return err?.code === "permission-denied";
}

function isNotFoundError(err) {
  return err?.code === "not-found";
}

/** Wrap an SDK error in a clear, user-facing message while keeping its code. */
function userError(err, message) {
  const wrapped = new Error(message);
  if (err?.code) wrapped.code = err.code;
  return wrapped;
}

/**
 * Resolve the Firestore context. Production callers get two handles from the
 * one app; tests inject `{ context: { db, sdk, app, alertsDb? } }`.
 *
 *   db        - the `staging` database: the ingest* collections
 *   alertsDb  - the `(default)` database: the public alerts collection
 */
async function resolveContext(deps) {
  if (deps && deps.context) return deps.context;
  const app = await getFirebaseApp();
  if (!app) throw new Error("Firebase is not configured for this deployment.");
  const sdk = await loadFirestore();
  return {
    app,
    sdk,
    db: sdk.getFirestore(app, STAGING_DATABASE_ID),
    alertsDb: sdk.getFirestore(app),
  };
}

/** The database that holds the public `alerts` collection. */
function resolveAlertsDb(ctx) {
  // Real callers always get `alertsDb` from resolveContext(); injected test
  // contexts may opt into a single database by leaving it undefined.
  return ctx.alertsDb || ctx.db;
}

/** The administrator handle written to review fields (`promotedBy`). */
async function resolveActor(ctx, actor) {
  const given = cleanText(actor, MAX_ACTOR);
  if (given) return given;
  try {
    const app = ctx.app || (await getFirebaseApp());
    if (!app) return "";
    const { getAuth } = await loadAuth();
    const user = getAuth(app).currentUser;
    return user ? cleanText(user.email || user.uid || "", MAX_ACTOR) : "";
  } catch {
    return "";
  }
}

// --- error sanitiser (defence in depth) -------------------------------------

/**
 * The collector already stores a sanitised `{ code, message, phase }`, but the
 * admin UI is a hard boundary: even if a raw error ever reached Firestore, we
 * must never render credentials. This strips PEM blocks, private-key fields and
 * credential-ish file names/paths from any text shown to an operator.
 */
export function redactErrorText(value) {
  if (!value) return "";
  let text = String(value);
  // 1. Whole PEM key blocks.
  text = text.replace(
    /-----BEGIN[\s\S]*?-----END[^-]*-----/g,
    "[redacted key material]"
  );
  // 2. Credential key/value pairs (bare, single- or double-quoted values).
  text = text.replace(
    /"?(?:private_key|client_email|client_id|access_token|refresh_token|api[_-]?key|password|secret)"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^",}\s]+)/gi,
    "[redacted credential]"
  );
  // 3. Anything that looks like a credential file or path.
  text = text.replace(
    /\S*(?:serviceAccount|service-account|adminsdk|\.json)\S*/gi,
    "[redacted]"
  );
  return text.trim().slice(0, 500);
}

// --- normalisers (never invent a value) -------------------------------------

/**
 * A count is only real when it is a finite, non-negative number. Anything else
 * (missing, null, a string, NaN, negative) returns null so callers can fall back
 * to another field name rather than reporting a fabricated 0.
 */
function countOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** First valid count among the candidates, else 0 (a safe default). */
function firstCount(...values) {
  for (const value of values) {
    const n = countOrNull(value);
    if (n !== null) return n;
  }
  return 0;
}

/** Normalise one staged item into a stable, render-safe shape. */
export function normaliseIngestItem(id, data = {}) {
  const src = data || {};
  return {
    id,
    itemId: src.itemId || id,
    sourceId: cleanText(src.sourceId, 120),
    sourceName: cleanText(src.sourceName, 120),
    title: cleanText(src.title, 400),
    category: cleanText(src.category, 60),
    canonicalUrl: src.canonicalUrl || null,
    documentUrl: src.documentUrl || null,
    sourceUrl: src.sourceUrl || null,
    sourceUrlFallback: Boolean(src.sourceUrlFallback),
    noticeDate: src.noticeDate || null,
    attachments: Array.isArray(src.attachments)
      ? src.attachments.filter((u) => typeof u === "string")
      : [],
    pane: src.pane || null,
    contentHash: src.contentHash || null,
    previousHash: src.previousHash || null,
    changedAt: src.changedAt || null,
    firstSeenAt: src.firstSeenAt || null,
    lastSeenAt: src.lastSeenAt || null,
    lastRunId: src.lastRunId || null,
    seenCount: Number(src.seenCount) || 0,
    reviewState: src.reviewState || REVIEW_STATE.NEW,
    promotedAlertId: src.promotedAlertId || null,
    promotedAt: src.promotedAt || null,
    promotedBy: cleanText(src.promotedBy, MAX_ACTOR),
  };
}

/** True when the collector recorded that this notice's content changed. */
export function hasContentChange(item) {
  if (!item) return false;
  if (item.changedAt) return true;
  return Boolean(
    item.previousHash && item.contentHash && item.previousHash !== item.contentHash
  );
}

/** Normalise one ingestion run report. */
export function normaliseIngestRun(id, data = {}) {
  const src = data || {};
  const counts = src.counts || {};
  return {
    id,
    runId: src.runId || id,
    status: cleanText(src.status, 40) || "unknown",
    mode: cleanText(src.mode, 40),
    dryRun: Boolean(src.dryRun),
    trigger: cleanText(src.trigger, 40),
    actor: cleanText(src.actor, MAX_ACTOR),
    projectId: cleanText(src.projectId, 120),
    collectorVersion: cleanText(src.collectorVersion, 60),
    startedAt: src.startedAt || null,
    finishedAt: src.finishedAt || null,
    durationMs: Number(src.durationMs) || 0,
    counts: {
      sources: firstCount(counts.sources),
      // The collector records source outcomes as sourcesOk / sourcesDegraded /
      // sourcesFailed / sourcesRefused. Older run documents may instead carry
      // the legacy succeeded / failed names, so those win when present, keeping
      // both document shapes correct.
      succeeded: firstCount(counts.succeeded, counts.sourcesOk),
      failed: firstCount(counts.failed, counts.sourcesFailed),
      degraded: firstCount(counts.sourcesDegraded),
      refused: firstCount(counts.sourcesRefused),
      notices: firstCount(counts.notices),
      itemsCreated: firstCount(counts.itemsCreated),
      itemsRefreshed: firstCount(counts.itemsRefreshed),
      itemsChanged: firstCount(counts.itemsChanged),
      itemsDeferred: firstCount(counts.itemsDeferred),
    },
    sources: Array.isArray(src.sources) ? src.sources : [],
    warnings: Array.isArray(src.warnings) ? src.warnings : [],
    error: src.error ? redactErrorText(src.error.message || src.error) : "",
  };
}

/** Normalise one per-source health record, sanitising any stored error. */
export function normaliseSourceHealth(id, data = {}) {
  const src = data || {};
  const rawError = src.lastError || null;
  return {
    id,
    sourceId: src.sourceId || id,
    name: cleanText(src.name, 120),
    status: cleanText(src.status, 40) || "unknown",
    lastOutcome: cleanText(src.lastOutcome, 40),
    consecutiveFailures: Number(src.consecutiveFailures) || 0,
    totalRuns: Number(src.totalRuns) || 0,
    totalFailures: Number(src.totalFailures) || 0,
    lastNotices: Number(src.lastNotices) || 0,
    lastRunId: src.lastRunId || "",
    lastRunAt: src.lastRunAt || null,
    lastSuccessAt: src.lastSuccessAt || null,
    updatedAt: src.updatedAt || null,
    lastFingerprint: src.lastFingerprint || null,
    lastError: rawError
      ? {
          code: cleanText(rawError.code, 60),
          phase: cleanText(rawError.phase, 60),
          message: redactErrorText(rawError.message),
        }
      : null,
  };
}

// --- reads ------------------------------------------------------------------

/**
 * Admin: one page of staged notices, newest first.
 *
 * Ordering uses only `firstSeenAt` (a single-field, automatically indexed
 * query) plus a cursor, deliberately avoiding a composite index - the same
 * convention lib/alerts.js and lib/channels.js follow so the feature works on a
 * fresh project with no index deployment. Review-state / source / text
 * filtering is applied client-side with `filterIngestItems`.
 */
export async function fetchIngestItems(
  { pageSize = DEFAULT_PAGE_SIZE, cursor = null } = {},
  deps = {}
) {
  const ctx = await resolveContext(deps);
  const { collection, query, orderBy, limit, startAfter, getDocs } = ctx.sdk;
  const size = clampPageSize(pageSize, DEFAULT_PAGE_SIZE);

  const constraints = [orderBy("firstSeenAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  let snap;
  try {
    snap = await getDocs(
      query(collection(ctx.db, INGEST_COLLECTIONS.ITEMS), ...constraints)
    );
  } catch (err) {
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
      );
    }
    throw userError(err, "Could not load staged notices. Please try again.");
  }

  const docs = snap.docs || [];
  return {
    items: docs.map((d) => normaliseIngestItem(d.id, d.data())),
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore: docs.length >= size,
  };
}

/** Admin: recent ingestion run reports, newest first. */
export async function fetchIngestRuns(
  { pageSize = DEFAULT_RUN_PAGE_SIZE, cursor = null } = {},
  deps = {}
) {
  const ctx = await resolveContext(deps);
  const { collection, query, orderBy, limit, startAfter, getDocs } = ctx.sdk;
  const size = clampPageSize(pageSize, DEFAULT_RUN_PAGE_SIZE);

  const constraints = [orderBy("startedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  let snap;
  try {
    snap = await getDocs(
      query(collection(ctx.db, INGEST_COLLECTIONS.RUNS), ...constraints)
    );
  } catch (err) {
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim."
      );
    }
    throw userError(err, "Could not load ingestion runs. Please try again.");
  }

  const docs = snap.docs || [];
  return {
    runs: docs.map((d) => normaliseIngestRun(d.id, d.data())),
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore: docs.length >= size,
  };
}

/** Admin: every source-health record (one per source - a small collection). */
export async function fetchSourceHealth(deps = {}) {
  const ctx = await resolveContext(deps);
  const { collection, getDocs } = ctx.sdk;

  let snap;
  try {
    snap = await getDocs(collection(ctx.db, INGEST_COLLECTIONS.HEALTH));
  } catch (err) {
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim."
      );
    }
    throw userError(err, "Could not load source health. Please try again.");
  }

  return (snap.docs || []).map((d) => normaliseSourceHealth(d.id, d.data()));
}

// --- writes -----------------------------------------------------------------

/**
 * Admin: mark a staged notice as ignored.
 *
 * Only `reviewState` changes - the rules permit exactly the four review fields
 * and nothing else, so no timestamp or actor is written here (there is nowhere
 * safe to put it). Ignoring never touches the alert collection.
 */
export async function ignoreIngestItem({ itemId, actor = "" } = {}, deps = {}) {
  if (!itemId) throw new Error("A staged notice id is required.");
  const ctx = await resolveContext(deps);
  const { doc, updateDoc } = ctx.sdk;

  try {
    await updateDoc(doc(ctx.db, INGEST_COLLECTIONS.ITEMS, itemId), {
      reviewState: REVIEW_STATE.IGNORED,
    });
  } catch (err) {
    if (isNotFoundError(err)) {
      throw userError(err, "This staged notice no longer exists. Refresh the list.");
    }
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
      );
    }
    throw userError(err, "Could not ignore this notice. Please try again.");
  }

  return { itemId, reviewState: REVIEW_STATE.IGNORED, actor: cleanText(actor, MAX_ACTOR) };
}

/**
 * Admin: return an IGNORED staged notice to the review queue.
 *
 * This is the only transition back into `new`, and it is deliberately narrow:
 *   * it is human-triggered only - the collector never resurrects an item;
 *   * the item is read INSIDE a transaction and updated in the same commit, so
 *     the `reviewState` we branch on is still current when the write lands - a
 *     concurrent promote/ignore can never be overwritten by a stale read;
 *   * a missing item is rejected;
 *   * only an item whose current state is exactly `ignored` may move. A
 *     `promoted` item can never return (its alert exists and the state machine
 *     is one-way), and a notice that is already `new` is rejected rather than
 *     silently accepted;
 *   * an item that still carries a `promotedAlertId` is rejected too, even when
 *     its stored state says `ignored`. That combination is inconsistent - the
 *     only writer of the metadata set `reviewState: "promoted"` atomically - and
 *     letting it back into the queue would invite a second promotion;
 *   * only `reviewState` is written - notice fields and promotion metadata are
 *     left exactly as they were.
 */
export async function returnIngestItemToReview({ itemId } = {}, deps = {}) {
  if (!itemId) throw new Error("A staged notice id is required.");
  const ctx = await resolveContext(deps);
  const { doc, runTransaction } = ctx.sdk;

  const itemRef = doc(ctx.db, INGEST_COLLECTIONS.ITEMS, itemId);

  try {
    await runTransaction(ctx.db, async (tx) => {
      // Read and write in one transaction, as Firestore requires (reads before
      // writes). If the callback throws, nothing is committed.
      const snap = await tx.get(itemRef);
      if (!snap.exists()) {
        const missing = new Error(
          "This staged notice no longer exists. Refresh the list and try again."
        );
        missing.code = "not-found";
        throw missing;
      }

      const current = snap.data() || {};
      if (current.reviewState !== REVIEW_STATE.IGNORED) {
        // Tag our own deliberate rejection so the catch below can pass its
        // message through while unexpected commit failures get the friendly
        // fallback.
        const invalid = new Error("Only an ignored notice can be returned to review.");
        invalid.code = "invalid-review-state";
        throw invalid;
      }

      // The metadata is the authoritative record that an alert exists. A
      // document can only carry it in a `promoted` state, so seeing it here is
      // an inconsistent (legacy/out-of-band) document. Refuse rather than
      // resurrect a notice that already produced an alert.
      if (current.promotedAlertId) {
        const invalid = new Error(
          "This notice already has an alert and cannot be returned to review."
        );
        invalid.code = "invalid-review-state";
        throw invalid;
      }

      tx.update(itemRef, { reviewState: REVIEW_STATE.NEW });
    });
  } catch (err) {
    if (isNotFoundError(err)) {
      throw userError(err, "This staged notice no longer exists. Refresh the list.");
    }
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
      );
    }
    if (err?.code === "invalid-review-state") {
      throw userError(err, err.message);
    }
    throw userError(err, "Could not return this notice to review. Please try again.");
  }

  return { itemId, reviewState: REVIEW_STATE.NEW };
}

/**
 * Admin: promote a staged notice into an alert DRAFT - once, and never twice.
 *
 * The public `alerts` collection lives in `(default)` while the staged notice
 * lives in `staging`, and Firestore offers no cross-database transaction, so
 * the operation is two steps that are each individually safe to retry:
 *
 *   1. read ingestItems/{itemId} in `staging`   (admin-only read)
 *   2. if it already has an alert id, return that (idempotent - no second alert)
 *   3. validate `input`                          (cleanAlert, existing rules)
 *   4. create alerts/{deterministicId} in `(default)` ONLY IF IT DOES NOT EXIST
 *   5. claim the item in a `staging` transaction (mark promoted + link the id)
 *
 * Safety properties that survive the split:
 *   * the alert id is derived from the item id, so a retry always targets the
 *     same document and a notice can never fork two alerts;
 *   * step 4 never overwrites an existing alert, so an admin edit made between
 *     a failure and a retry can never be clobbered;
 *   * a failure after step 4 but before step 5 leaves the item un-promoted, and
 *     re-promoting finds the draft already there (step 4 is a no-op) and simply
 *     finishes step 5 - the notice is never stranded and never duplicated;
 *   * a concurrent double-click resolves through step 5's transaction: the
 *     loser sees the winner's id and keeps it.
 *
 * The created alert is a plain draft: `status: "draft"`, `verifiedAt: null`,
 * `verifiedBy: ""`. It is never verified or published here.
 */
export async function promoteIngestItem(
  { itemId, input, actor = "" } = {},
  deps = {}
) {
  if (!itemId) throw new Error("A staged notice id is required.");
  const ctx = await resolveContext(deps);
  const { doc, getDoc, runTransaction, serverTimestamp } = ctx.sdk;
  const alertsDb = resolveAlertsDb(ctx);

  const who = await resolveActor(ctx, actor);
  if (!who) {
    throw new Error(
      "Could not determine your administrator identity. Please sign in again."
    );
  }

  const itemRef = doc(ctx.db, INGEST_COLLECTIONS.ITEMS, itemId);

  let result;
  try {
    // 1 + 2. Read the staged item first. A repeat promotion must write nothing
    // at all, not even a conflicting draft, so the already-promoted check runs
    // before any validation or write.
    const snap = await getDoc(itemRef);
    if (!snap.exists()) {
      const missing = new Error(
        "This staged notice no longer exists. Refresh the list and try again."
      );
      missing.code = "not-found";
      throw missing;
    }

    const item = snap.data() || {};

    // Keyed on `promotedAlertId` (the alert that actually exists) rather than
    // on `reviewState`, so a document whose state drifted - an inconsistent
    // legacy/out-of-band `ignored` or `new` that still carries promotion
    // metadata - can never create a second alert or overwrite the first.
    if (item.promotedAlertId) {
      result = {
        alertId: item.promotedAlertId,
        created: false,
        reviewState: item.reviewState || REVIEW_STATE.PROMOTED,
        promotedAt: item.promotedAt || null,
        promotedBy: cleanText(item.promotedBy, MAX_ACTOR),
      };
      return { itemId, ...result };
    }

    // 3. Validate only when we are actually going to write, so re-submitting an
    // already-promoted item stays a harmless no-op even if the form changed.
    const fields = cleanAlert(input);
    if (fields.status === ALERT_STATUS.PUBLISHED) {
      throw new Error(
        "Promotion creates a draft. Verify and publish it from Alert Radar afterwards."
      );
    }

    const alertId = promotionAlertId(itemId);
    const alertDocRef = doc(alertsDb, ALERT_COLLECTION, alertId);

    // 4. Create the draft in the PUBLIC database, but only if that exact
    // document does not already exist. Making this a transaction on the alerts
    // database gives an atomic create-if-absent, so even two concurrent
    // promotions produce exactly one draft and exactly one `created: true`.
    const created = await runTransaction(alertsDb, async (tx) => {
      const existing = await tx.get(alertDocRef);
      if (existing.exists()) return false;
      tx.set(alertDocRef, buildAlertDocument(fields, who, serverTimestamp));
      return true;
    });

    // 5. Claim the notice in the STAGING database. Re-reading inside the
    // transaction keeps the claim safe against a concurrent promotion: the
    // loser keeps the winner's alert id instead of overwriting it.
    const claimed = await runTransaction(ctx.db, async (tx) => {
      const current = await tx.get(itemRef);
      if (!current.exists()) {
        const missing = new Error(
          "This staged notice no longer exists. Refresh the list and try again."
        );
        missing.code = "not-found";
        throw missing;
      }
      const data = current.data() || {};
      if (data.promotedAlertId) return data.promotedAlertId;
      tx.update(itemRef, {
        reviewState: REVIEW_STATE.PROMOTED,
        promotedAlertId: alertId,
        promotedAt: serverTimestamp(),
        promotedBy: who,
      });
      return alertId;
    });

    result = {
      alertId: claimed || alertId,
      created,
      reviewState: REVIEW_STATE.PROMOTED,
      promotedAt: null,
      promotedBy: who,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      throw userError(err, "This staged notice no longer exists. Refresh the list.");
    }
    if (isPermissionError(err)) {
      throw userError(
        err,
        "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed for both databases."
      );
    }
    // Validation and other explicit messages pass through unchanged.
    throw userError(err, err?.message || "Could not promote this notice. Please try again.");
  }

  return { itemId, ...result };
}

// --- pure client-side filtering / aggregation -------------------------------

const dateMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Filter staged items in memory (no composite index required). Filters apply to
 * the items currently loaded; the page offers "load more" to reach older ones.
 */
export function filterIngestItems(
  items,
  { query = "", reviewState = REVIEW_FILTER_ALL, sourceId = REVIEW_FILTER_ALL } = {}
) {
  const list = Array.isArray(items) ? items : [];
  const needle = cleanText(query, 200).toLowerCase();
  return list.filter((item) => {
    if (reviewState !== REVIEW_FILTER_ALL && item.reviewState !== reviewState) {
      return false;
    }
    if (sourceId !== REVIEW_FILTER_ALL && item.sourceId !== sourceId) {
      return false;
    }
    if (needle) {
      const haystack = `${item.title} ${item.sourceName} ${item.sourceId}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Distinct sources present in the loaded items, for the source filter. */
export function ingestSourceOptions(items) {
  const seen = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item.sourceId || seen.has(item.sourceId)) continue;
    seen.set(item.sourceId, item.sourceName || item.sourceId);
  }
  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Counts per review state plus a total, for the summary stat cards. */
export function countIngestStates(items) {
  const counts = { all: 0, new: 0, promoted: 0, ignored: 0, changed: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    counts.all += 1;
    if (item.reviewState in counts) counts[item.reviewState] += 1;
    if (hasContentChange(item)) counts.changed += 1;
  }
  return counts;
}

// Re-exported so the admin page can sort/format without importing alerts.js.
export { dateMs };
