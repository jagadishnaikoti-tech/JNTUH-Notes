// ---------------------------------------------------------------------------
// Collector - deterministic ingestion identifiers (pure, dependency-free).
//
// Phase 2 keys every discovered notice by a *deterministic* id so that re-running
// the collector merges into the same document instead of creating a duplicate:
//
//   itemId = sha256(sourceId + "\0" + canonicalUrl) -> first 32 hex chars
//
// `sourceId` is a fixed internal adapter id ("notifications", "exams") and
// `canonicalUrl` is the notice's own notice/document URL, already canonicalised
// by lib/url.mjs. The raw `sourceId|canonicalUrl` pair is what lib/dedup.mjs
// uses as `itemKey`; this module offers the same identity in a form that is safe
// to use as a Firestore document id.
//
// The NUL separator makes the concatenation *injective*: without it, the pairs
// ("ab", "c") and ("a", "bc") would both hash "abc". Because neither a source id
// nor an http(s) URL can legitimately contain a NUL byte, an input that does is
// refused (returns null) rather than silently producing a colliding id.
//
// Structure fingerprints are the source-change detector: they describe *how*
// a listing is marked up (element names, class/id attribute values) and
// deliberately ignore the visible text, so a page that merely publishes a new
// notice produces the same fingerprint while a re-skinned page does not.
//
// Nothing here reads a clock, touches the network, or writes anywhere.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

import { removeComments } from "./html.mjs";

/** Length (in hex characters) of every id and fingerprint this module mints. */
export const INGEST_ID_LENGTH = 32;

/** The one separator used when composing a hash input. */
const SEPARATOR = "\u0000";

/** A fixed number of structural tokens, so huge pages still hash deterministically. */
const STRUCTURE_TOKEN_LIMIT = 400;

const ITEM_ID_PATTERN = new RegExp(`^[0-9a-f]{${INGEST_ID_LENGTH}}$`);

const HASH_INPUT = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/** `class="a b"` / `class='a b'` / `class=a` - one capture per quoting style.
 *  The lookbehind keeps `data-id="5"` from being read as `id:5`. */
const CLASS_OR_ID_PATTERN =
  /(?<![\w-])(class|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/** Any opening tag name, e.g. `tr`, `div`, `a`. */
const TAG_PATTERN = /<\s*([a-zA-Z][a-zA-Z0-9-]*)/g;

/**
 * Deterministic ingestion id for one notice.
 *
 * @param {string} sourceId      adapter id, e.g. "notifications"
 * @param {string|null} canonicalUrl the notice's own canonical http(s) URL
 * @returns {string|null} 32 lower-case hex chars, or null when the notice has no
 *   usable identity (missing source/URL, or an input containing the separator).
 */
export function ingestItemId(sourceId, canonicalUrl) {
  const source = String(sourceId ?? "").trim();
  const url = String(canonicalUrl ?? "").trim();
  if (!source || !url) return null;
  if (source.includes(SEPARATOR) || url.includes(SEPARATOR)) return null;
  return HASH_INPUT(`${source}${SEPARATOR}${url}`).slice(0, INGEST_ID_LENGTH);
}

/** True when `value` looks like an id minted by {@link ingestItemId}. */
export function isIngestItemId(value) {
  return typeof value === "string" && ITEM_ID_PATTERN.test(value);
}

/**
 * Structural tokens for a listing page: every opening tag name plus every
 * `class`/`id` attribute value (each class token kept separately).
 *
 * Comments are stripped first, so commented-out scaffolding does not count.
 * The result is sorted and de-duplicated, which makes it independent of both
 * markup order and cosmetic whitespace.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function structureTokens(html) {
  const body = removeComments(html);
  const tokens = new Set();

  for (const match of body.matchAll(CLASS_OR_ID_PATTERN)) {
    const kind = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    for (const piece of value.trim().split(/\s+/)) {
      if (piece) tokens.add(`${kind}:${piece}`);
    }
  }

  for (const match of body.matchAll(TAG_PATTERN)) {
    tokens.add(`tag:${match[1].toLowerCase()}`);
  }

  return [...tokens].sort().slice(0, STRUCTURE_TOKEN_LIMIT);
}

/**
 * Hash an arbitrary list of structural tokens.
 * Order-independent and duplicate-insensitive by construction.
 */
export function fingerprintOfTokens(tokens) {
  const list = Array.isArray(tokens) ? tokens : tokens == null ? [] : [tokens];
  const unique = [...new Set(list.map((token) => String(token ?? "").trim()).filter(Boolean))].sort();
  return HASH_INPUT(unique.join("\n")).slice(0, INGEST_ID_LENGTH);
}

/**
 * Fingerprint of a page's *structure* only - text content is irrelevant.
 * Compare this across runs to detect a re-skinned source.
 */
export function structureFingerprint(html) {
  return fingerprintOfTokens(structureTokens(html));
}
