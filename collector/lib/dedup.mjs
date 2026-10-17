// ---------------------------------------------------------------------------
// Collector - duplicate detection (pure, deterministic, dependency-free).
//
// Duplicates are detected on **identity**, never on wording:
//
//   * item key .... `${sourceId}|${canonicalUrl}`  where the canonical URL is
//                    the notice's own document/notice URL.
//   * content hash  sha256 over title + date + document URL, used later to spot
//                    a *revised* notice that was re-uploaded under the same URL.
//
// Two different notices are NEVER merged because their titles look similar -
// titles are not part of the identity key at all. Titles only enter the content
// hash, which exists to detect edits to an already-known URL.
//
// Nothing here writes anywhere; results are plain values the caller can print
// or (in a later phase) persist outside the `alerts` documents - `firestore.rules`
// uses `keys().hasOnly([...])`, so collector bookkeeping must never be stored
// inside an alert document.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/** Collapse whitespace so cosmetic markup changes do not alter a hash. */
export function canonicalText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** Stable identity for one notice: source + canonical notice/document URL. */
export function itemKey(sourceId, canonicalUrl) {
  return `${canonicalText(sourceId)}|${canonicalText(canonicalUrl)}`;
}

/**
 * Content hash for a notice. Includes the URL so two notices with identical
 * wording but different URLs produce different hashes (they are different
 * notices), and includes the title/date so a re-upload under the same URL
 * produces a different hash (a revision).
 */
export function contentHash({ title = "", noticeDate = null, documentUrl = "" } = {}) {
  const datePart = noticeDate instanceof Date && !Number.isNaN(noticeDate.getTime())
    ? noticeDate.toISOString().slice(0, 10)
    : canonicalText(noticeDate);

  return createHash("sha256")
    .update([canonicalText(title), datePart, canonicalText(documentUrl)].join("\n"), "utf8")
    .digest("hex");
}

/**
 * Split notices into unique and duplicate buckets.
 *
 * @param {Array<{sourceId: string, canonicalUrl: string|null}>} notices
 * @param {{baselineKeys?: Set<string>}} [options] previously seen keys, e.g. from
 *        a run log. Reading a baseline is read-only; this phase does not write one.
 * @returns {{unique: Array, duplicates: Array<{notice: object, reason: string, key: string}>}}
 */
export function dedupeByCanonicalUrl(notices, { baselineKeys } = {}) {
  const seen = new Set(baselineKeys instanceof Set ? baselineKeys : []);
  const unique = [];
  const duplicates = [];

  for (const notice of notices) {
    const key = notice.canonicalUrl
      ? itemKey(notice.sourceId, notice.canonicalUrl)
      : null;

    if (!key) {
      // No usable URL at all: keep it, but flag it. It can never be matched
      // against a later run, so it must be reviewed by hand.
      unique.push(notice);
      continue;
    }

    if (seen.has(key)) {
      duplicates.push({ notice, reason: "already-seen", key });
      continue;
    }
    seen.add(key);
    unique.push(notice);
  }

  return { unique, duplicates };
}
