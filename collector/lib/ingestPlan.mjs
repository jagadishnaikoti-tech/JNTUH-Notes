// ---------------------------------------------------------------------------
// Collector - ingestion planning (pure, deterministic, dependency-free).
//
// `planIngest` merges the notices a run just discovered with the item documents
// a previous run already stored, and returns the documents that should be
// written. It performs no I/O of any kind: it takes plain values in and returns
// plain values out, which is what makes the whole write path testable without a
// database.
//
// Review state machine (the only states an item can be in):
//
//   new      -> in the admin review queue; a human decides promote or ignore
//   promoted -> an alert was created from it; NEVER returns to the queue
//   ignored  -> a human dismissed it; NEVER resurrected automatically
//
// A content revision (same URL, re-uploaded/edited notice) records `changedAt`
// and `previousHash` but can never move an item *back* into review: an item that
// is `promoted` stays `promoted` and an item that is `ignored` stays `ignored`.
//
// This module deliberately knows nothing about the public `alerts` collection;
// the review state uses the name `reviewState`, never `status`, so an ingest
// document can never be mistaken for an alert.
// ---------------------------------------------------------------------------

import { canonicalText, contentHash } from "./dedup.mjs";
import { ingestItemId } from "./ingestIds.mjs";

/** The only three review states. Kept in sync with the rules in a later phase. */
export const REVIEW_STATE = Object.freeze({
  NEW: "new",
  PROMOTED: "promoted",
  IGNORED: "ignored",
});

export const REVIEW_STATES = Object.freeze(Object.values(REVIEW_STATE));

/**
 * Fields written by the collector on every run (merged, never authoritative for
 * anything the admin UI owns).
 */
export const COLLECTOR_ITEM_FIELDS = Object.freeze([
  "itemId", "sourceId", "sourceName", "title", "category",
  "canonicalUrl", "documentUrl", "sourceUrl", "sourceUrlFallback",
  "noticeDate", "attachments", "pane",
  "contentHash", "previousHash", "changedAt",
  "firstSeenAt", "lastSeenAt", "lastRunId", "seenCount",
  "reviewState",
]);

/**
 * Fields owned by the admin UI / promotion flow. The planner copies them across
 * verbatim and never invents a value for them.
 */
export const ADMIN_ITEM_FIELDS = Object.freeze(["promotedAlertId", "promotedAt", "promotedBy"]);

/** True when an item still waits for a human decision. */
export function isInReviewQueue(document) {
  return Boolean(document) && document.reviewState === REVIEW_STATE.NEW;
}

/** Collapse whitespace only (never truncate - the review UI shows the source text). */
function clean(value) {
  return canonicalText(value);
}

/** A revision hash over exactly the fields lib/dedup.mjs hashes, for one notice. */
function noticeContentHash(notice) {
  return contentHash({
    title: notice.title,
    noticeDate: notice.noticeDate ?? null,
    documentUrl: notice.documentUrl ?? notice.canonicalUrl ?? "",
  });
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normaliseAttachments(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => clean(entry)).filter(Boolean))];
}

/** `maxItems` limits how many *new* items a run may create. */
function normaliseBudget(maxItems) {
  if (maxItems === undefined || maxItems === null) return Number.POSITIVE_INFINITY;
  const n = Number(maxItems);
  if (Number.isNaN(n)) return 0;
  if (!Number.isFinite(n)) return n > 0 ? Number.POSITIVE_INFINITY : 0;
  return n < 0 ? 0 : Math.floor(n);
}

/**
 * Normalise the "already stored" input into `Map<itemId, documentData>`.
 * Accepts a Map, a plain object keyed by id, or an array of documents that carry
 * their own `id`/`itemId` (the shape a Firestore read produces).
 */
function toLookup(existing) {
  const lookup = new Map();
  if (!existing) return lookup;

  if (existing instanceof Map) {
    for (const [id, data] of existing) if (id) lookup.set(String(id), data ?? {});
    return lookup;
  }

  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (!entry || typeof entry !== "object") continue;
      const id = entry.itemId ?? entry.id;
      if (!id) continue;
      const data = entry.data && typeof entry.data === "object" ? entry.data : entry;
      lookup.set(String(id), data);
    }
    return lookup;
  }

  if (typeof existing === "object") {
    for (const [id, data] of Object.entries(existing)) if (id) lookup.set(String(id), data ?? {});
  }
  return lookup;
}

/** The only place a review state is ever decided. */
function nextReviewState(existingState, isNew) {
  if (isNew) return REVIEW_STATE.NEW;
  if (existingState === REVIEW_STATE.PROMOTED) return REVIEW_STATE.PROMOTED;
  if (existingState === REVIEW_STATE.IGNORED) return REVIEW_STATE.IGNORED;
  // "new", plus any legacy/unknown value, is surfaced for review. Losing an item
  // is worse than reviewing it twice.
  return REVIEW_STATE.NEW;
}

/** Build the merged document for one candidate, plus its classification. */
function buildItemDocument(candidate, { runId, now }) {
  const { id, notice, existing } = candidate;
  const isNew = existing === null;
  const hash = noticeContentHash(notice);

  // A missing previous hash (legacy/partial doc) is not a revision - we simply
  // adopt the current hash instead of inventing a `previousHash: undefined`.
  const changed =
    !isNew &&
    typeof existing.contentHash === "string" &&
    existing.contentHash.length > 0 &&
    existing.contentHash !== hash;

  const document = {
    itemId: id,
    sourceId: clean(notice.sourceId),
    sourceName: clean(notice.sourceName),
    title: clean(notice.title),
    category: clean(notice.category),
    canonicalUrl: notice.canonicalUrl,
    documentUrl: notice.documentUrl ?? null,
    sourceUrl: notice.sourceUrl ?? notice.canonicalUrl,
    sourceUrlFallback: Boolean(notice.sourceUrlFallback),
    noticeDate: notice.noticeDate ?? null,
    attachments: normaliseAttachments(notice.attachments),
    pane: notice.pane ?? null,
    contentHash: hash,
    firstSeenAt: isNew ? now : existing.firstSeenAt ?? now,
    lastSeenAt: now,
    lastRunId: runId,
    seenCount: toCount(existing?.seenCount) + 1,
    reviewState: nextReviewState(existing?.reviewState, isNew),
  };

  // History of a revision: recorded when it happens, preserved afterwards.
  const previousHash = changed ? existing.contentHash : existing?.previousHash;
  const changedAt = changed ? now : existing?.changedAt;
  if (previousHash !== undefined) document.previousHash = previousHash;
  if (changedAt !== undefined) document.changedAt = changedAt;

  // Admin-owned fields are copied, never created.
  if (!isNew) {
    for (const field of ADMIN_ITEM_FIELDS) {
      if (existing[field] !== undefined) document[field] = existing[field];
    }
  }

  const kind = isNew ? "created" : changed ? "changed" : "refreshed";
  return { document, kind };
}

/**
 * Plan the merge of freshly discovered notices with the stored items.
 *
 * @param {Array<object>} notices notices from the source adapters, already
 *        de-duplicated within the run by the caller.
 * @param {object} [options]
 * @param {Map|object|Array} [options.existing] previously stored item documents.
 * @param {string} [options.runId] identifier of this run, stored as `lastRunId`.
 * @param {Date} [options.now] the run timestamp (pass it explicitly for
 *        determinism; it defaults to "now" only for convenience).
 * @param {number} [options.maxItems] maximum number of *new* items to create.
 *        Already-known items are always refreshed and never consume the budget.
 * @returns {{
 *   documents: Array<object>,
 *   stats: object,
 *   deferredItemIds: string[],
 *   unaddressableNotices: Array<object>,
 * }}
 */
export function planIngest(notices, options = {}) {
  const {
    existing = null,
    runId = "",
    now = new Date(),
    maxItems = Number.POSITIVE_INFINITY,
  } = options;

  const lookup = toLookup(existing);
  const budget = normaliseBudget(maxItems);
  const list = Array.isArray(notices) ? notices : [];

  const seenIds = new Set();
  const candidates = [];
  const unaddressableNotices = [];
  let duplicateInput = 0;

  for (const notice of list) {
    if (!notice || typeof notice !== "object") {
      unaddressableNotices.push(notice ?? null);
      continue;
    }
    const id = ingestItemId(notice.sourceId, notice.canonicalUrl);
    if (!id) {
      // No usable identity: it can never be matched to a later run, so it must
      // be reported for a human rather than silently planned.
      unaddressableNotices.push(notice);
      continue;
    }
    if (seenIds.has(id)) {
      duplicateInput += 1;
      continue;
    }
    seenIds.add(id);
    candidates.push({ id, notice, existing: lookup.has(id) ? lookup.get(id) : null });
  }

  // Only brand-new items are budgeted. Candidates are ordered by id so the
  // admitted set does not depend on the order the caller happened to pass.
  const newIds = candidates.filter((c) => c.existing === null).map((c) => c.id).sort();
  const admittedList = newIds.slice(0, budget);
  const admitted = new Set(admittedList);
  const deferredItemIds = newIds.slice(admittedList.length);

  const documents = [];
  const stats = {
    planned: 0,
    created: 0,
    refreshed: 0,
    changed: 0,
    queued: 0,
    promoted: 0,
    ignored: 0,
    deferred: deferredItemIds.length,
    unaddressable: unaddressableNotices.length,
    duplicateInput,
  };

  for (const candidate of candidates) {
    if (candidate.existing === null && !admitted.has(candidate.id)) continue;
    const { document, kind } = buildItemDocument(candidate, { runId, now });
    documents.push(document);
    stats[kind] += 1;
    if (document.reviewState === REVIEW_STATE.PROMOTED) stats.promoted += 1;
    else if (document.reviewState === REVIEW_STATE.IGNORED) stats.ignored += 1;
    else stats.queued += 1;
  }

  stats.planned = documents.length;
  return { documents, stats, deferredItemIds, unaddressableNotices };
}
