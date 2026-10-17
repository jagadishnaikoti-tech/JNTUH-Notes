// ---------------------------------------------------------------------------
// Collector - alert draft builder (NOT yet wired to Firestore).
//
// Phase 1 never writes to a database. This module exists so that the field
// conventions are decided once, in one place, and can be unit-tested before
// anything is allowed to touch production data.
//
// The rules in `firestore.rules` (`validAlert`) are the contract:
//   * `d.keys().hasOnly([...18 fields...])` - no extra keys may ever be added
//     to an alert document, so collector bookkeeping (hashes, canonical URLs,
//     run ids) must live OUTSIDE the alert document;
//   * `title` 3..200, `summary` 1..600, `sourceName` <=80, `sourceUrl` <=500
//     and matching `^https?://.+`;
//   * `category` must be one of the eight ids shared with
//     `src/data/alertSources.js`;
//   * `status in ['draft','published']` and `published => verifiedAt is a
//     timestamp && verifiedBy is a non-empty string`.
//
// This builder can ONLY produce a draft: `status` is a literal "draft",
// `verifiedAt` is null and `verifiedBy` is "". Publishing remains a manual
// administrator action (see src/lib/alerts.js publishAlert).
// ---------------------------------------------------------------------------

import { ALERT_CATEGORY_IDS } from "../../src/data/alertSources.js";
import { contentHash } from "./dedup.mjs";

/** Exactly the 18 keys `validAlert` allows on an alert document. */
export const ALLOWED_ALERT_KEYS = Object.freeze([
  "title", "summary", "category", "sourceName", "sourceUrl",
  "publishedAt", "deadlineAt", "status", "pinned", "audience", "tags",
  "verifiedAt", "verifiedBy", "createdBy", "updatedBy",
  "createdAt", "updatedAt", "schemaVersion",
]);

/** Keys that must be written by the backend as real Firestore timestamps. */
export const WRITE_TIME_KEYS = Object.freeze(["createdAt", "updatedAt"]);

const MAX_TITLE = 200;
const MAX_SUMMARY = 600;
const MAX_SOURCE_NAME = 80;
const MAX_URL = 500;
const MAX_ACTOR = 200;
const SCHEMA_VERSION = 1;

export class DraftError extends Error {
  constructor(message, { notice } = {}) {
    super(message);
    this.name = "DraftError";
    this.notice = notice ?? null;
  }
}

/** Mirror of `normaliseHttpUrl` in src/lib/alerts.js: lower-case the scheme. */
function normaliseHttpUrl(value) {
  const text = String(value ?? "").trim().slice(0, MAX_URL);
  return text.replace(/^(https?):\/\//i, (_, scheme) => `${scheme.toLowerCase()}://`);
}

function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Truncate to `max` characters, preferring to stop on a word boundary. */
function clip(text, max) {
  const clean = String(text ?? "").trim();
  if (clean.length <= max) return { text: clean, clipped: false };
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return { text: (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim(), clipped: true };
}

/**
 * Build a draft alert from a parsed notice.
 *
 * @param {object} notice a notice produced by a source adapter
 * @param {{collectedAt?: Date, actor?: string}} [options]
 * @returns {{alert: object, collector: object}}
 *   `alert` holds ONLY the allowed alert keys; `collector` holds bookkeeping
 *   that must be persisted outside the alert document.
 * @throws {DraftError} when the notice cannot produce a valid draft
 */
export function toAlertDraft(notice, options = {}) {
  const collectedAt = options.collectedAt instanceof Date ? options.collectedAt : new Date();
  const actor = String(options.actor ?? "").trim().slice(0, MAX_ACTOR);

  if (!notice || typeof notice !== "object") {
    throw new DraftError("Notice is missing or not an object.");
  }

  const title = clip(notice.title, MAX_TITLE);
  if (title.text.length < 3) {
    throw new DraftError("Title is shorter than 3 characters - not usable as an alert.", { notice });
  }

  const sourceUrl = normaliseHttpUrl(notice.sourceUrl);
  if (!sourceUrl) {
    throw new DraftError("Notice has no source URL - cannot build an alert.", { notice });
  }
  if (!isHttpUrl(sourceUrl)) {
    throw new DraftError(`Source URL is not a valid http(s) URL: ${sourceUrl}`, { notice });
  }

  const category = String(notice.category ?? "").trim();
  if (!ALERT_CATEGORY_IDS.includes(category)) {
    throw new DraftError(
      `Category "${category}" is not one of the allowed ids (${ALERT_CATEGORY_IDS.join(", ")}).`,
      { notice },
    );
  }

  const sourceName = String(notice.sourceName ?? "").trim().slice(0, MAX_SOURCE_NAME);

  // Never invent: only a real parsed notice date becomes publishedAt.
  const publishedAt =
    notice.noticeDate instanceof Date && !Number.isNaN(notice.noticeDate.getTime())
      ? notice.noticeDate
      : null;

  const reviewReasons = [];
  if (title.clipped) reviewReasons.push("title-clipped");
  if (!publishedAt) reviewReasons.push("date-missing");
  // `summary` is intentionally left empty - the rules require >= 1 character
  // for a WRITE, so an admin must supply the summary during review. Fabricating
  // one from the title would present invented text as an official notice.
  reviewReasons.push("summary-required");

  const alert = {
    title: title.text,
    summary: "",
    category,
    sourceName,
    sourceUrl,
    publishedAt,
    deadlineAt: null, // never derived - only set when a notice states a deadline
    status: "draft",
    pinned: false,
    audience: [],
    tags: [],
    verifiedAt: null, // only verifyAlert() may set this (admin, manual)
    verifiedBy: "",   // only verifyAlert() may set this (admin, manual)
    createdBy: actor || `collector:${notice.sourceId ?? "unknown"}`,
    updatedBy: actor || `collector:${notice.sourceId ?? "unknown"}`,
    schemaVersion: SCHEMA_VERSION,
  };

  assertDraftOnly(alert);

  const collector = {
    sourceId: notice.sourceId ?? "",
    pane: notice.pane ?? null,
    canonicalUrl: notice.canonicalUrl ?? null,
    documentUrl: notice.documentUrl ?? null,
    noticeHref: notice.noticeHref ?? null,
    attachments: Array.isArray(notice.attachments) ? [...notice.attachments] : [],
    contentHash: contentHash({
      title: notice.title ?? title.text,
      noticeDate: publishedAt,
      documentUrl: notice.documentUrl ?? notice.canonicalUrl ?? "",
    }),
    collectedAt,
    sourceUrlFallback: Boolean(notice.sourceUrlFallback),
    titleFull: String(notice.title ?? title.text),
    reviewReasons,
    writeHints: { setTimestamps: [...WRITE_TIME_KEYS] },
  };

  return { alert, collector };
}

/**
 * Safety invariant for the future ingestion step: an alert produced here can
 * only ever be a draft with verification cleared, and may only carry keys the
 * security rules allow. Throws when violated.
 */
export function assertDraftOnly(alert) {
  if (!alert || typeof alert !== "object") {
    throw new DraftError("Alert is missing.");
  }

  const extra = Object.keys(alert).filter((key) => !ALLOWED_ALERT_KEYS.includes(key));
  if (extra.length) {
    throw new DraftError(`Alert contains keys not allowed by firestore.rules: ${extra.join(", ")}`);
  }

  if (alert.status !== "draft") {
    throw new DraftError(`Refusing to build a non-draft alert (status: ${alert.status}).`);
  }
  if (alert.verifiedAt !== null) {
    throw new DraftError("Refusing to build a pre-verified alert: verification is an admin action.");
  }
  if (alert.verifiedBy !== "" && alert.verifiedBy != null) {
    throw new DraftError("Refusing to build a pre-verified alert: verifiedBy must be empty.");
  }
  if (alert.pinned !== false) {
    throw new DraftError("Collector-built alerts must not be pinned.");
  }
  if (alert.title.length > MAX_TITLE || alert.summary.length > MAX_SUMMARY) {
    throw new DraftError("Alert exceeds the field lengths allowed by firestore.rules.");
  }
  if (alert.sourceUrl.length > MAX_URL) {
    throw new DraftError("sourceUrl exceeds the 500 characters allowed by firestore.rules.");
  }
  return true;
}
