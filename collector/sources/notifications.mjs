// ---------------------------------------------------------------------------
// Source adapter #1: https://jntuh.ac.in/notifications
//
// What the page actually is (verified during Phase 1 discovery):
//   * a server-rendered HTML table: S.No | Date | Title(+link)
//   * header row  -> <tr class="grideheader">
//   * data rows   -> <tr class="griderow1|griderow2...>
//   * date format -> "15 Oct 2026"
//   * the Title cell holds a single <a href> pointing either at a file
//     (uploads/notifications/*.pdf|zip|jpg|doc...) or at an internal
//     jntuh.ac.in/content/... notice page or a subdomain page
//   * rows may contain commented-out cells (`<!--<td>-</td>-->`) and a
//     <img> "new" marker after the link
//
// Nothing else on the page is parsed. If the structure changes the adapter
// raises a ParseError instead of silently returning an empty list.
// ---------------------------------------------------------------------------

import { getAlertSource } from "../../src/data/alertSources.js";
import { ParseError } from "../lib/errors.mjs";
import { decodeEntities, matchAll, removeComments, textOf } from "../lib/html.mjs";
import { parseNoticeDate } from "../lib/date.mjs";
import { canonicalizeUrl, isFileUrl } from "../lib/url.mjs";

const META = getAlertSource("notifications");

export const SOURCE = Object.freeze({
  id: "notifications",
  name: META?.name ?? "JNTUH Notifications",
  listingUrl: "https://jntuh.ac.in/notifications",
  description:
    "University notifications from DAP, DUEX, admissions and more (public HTML table).",
  // The listing does not expose the directorate per row, so the category cannot
  // be derived from the page - "general" is the honest default. See README.md.
  categoryDefault: "general",
});

const ROW_PATTERN = /<tr\b[^>]*\bclass\s*=\s*["']?griderow\d+["']?[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_PATTERN = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_PATTERN = /href\s*=\s*["']([^"']+)["']/i;

/** Structural markers that prove we are looking at the expected listing. */
export function hasSkeleton(html) {
  return /class\s*=\s*["']?grideheader["']?/i.test(html) || /class\s*=\s*["']?griderow\d/i.test(html);
}

/**
 * Parse the notifications listing.
 *
 * @param {string} html raw response body of the listing page
 * @param {{baseUrl?: string}} [options]
 * @returns {{notices: Array, warnings: string[]}}
 * @throws {ParseError} when the markup does not match the expected structure
 */
export function parse(html, options = {}) {
  const baseUrl = options.baseUrl ?? SOURCE.listingUrl;
  const body = removeComments(html);

  if (!hasSkeleton(body)) {
    throw new ParseError(
      "JNTUH notifications page no longer contains the expected table structure " +
        "(no 'grideheader'/'griderow' rows). The site markup has probably changed.",
      { sourceId: SOURCE.id, marker: "grideheader|griderow", url: baseUrl },
    );
  }

  const rows = matchAll(body, ROW_PATTERN);
  const warnings = [];
  const notices = [];

  rows.forEach((row, index) => {
    const rowHtml = row[0];
    const cells = matchAll(rowHtml, CELL_PATTERN);

    if (cells.length < 3) {
      warnings.push(`row #${index + 1}: expected 3 cells, found ${cells.length} - skipped`);
      return;
    }

    const dateRaw = textOf(cells[1][0]);
    const titleCell = cells[2][0];

    const anchors = matchAll(titleCell, ANCHOR_PATTERN).map((anchor) => {
      const href = anchor[0].match(HREF_PATTERN)?.[1] ?? "";
      // href attribute values are entity-encoded (`?a=1&amp;b=2`).
      return { href: decodeEntities(href).trim(), text: textOf(anchor[1]) };
    });

    const noticeHref = anchors[0]?.href || "";
    // Title comes from the link text; fall back to the whole cell so a row with
    // no link still yields its (link-less) title rather than inventing anything.
    const title = anchors[0]?.text || textOf(titleCell);

    if (!title) {
      warnings.push(`row #${index + 1}: empty title - skipped`);
      return;
    }

    const canonical = noticeHref ? canonicalizeUrl(noticeHref, baseUrl) : null;
    const documentUrl = canonical && isFileUrl(canonical) ? canonical : null;

    const attachments = anchors
      .slice(1)
      .map((a) => canonicalizeUrl(a.href, baseUrl))
      .filter((url) => url && isFileUrl(url) && url !== documentUrl);

    notices.push({
      sourceId: SOURCE.id,
      sourceName: SOURCE.name,
      listingUrl: SOURCE.listingUrl,
      category: SOURCE.categoryDefault,
      title,
      dateRaw,
      noticeDate: parseNoticeDate(dateRaw),
      noticeHref: noticeHref || null,
      sourceUrl: canonical ?? SOURCE.listingUrl,
      sourceUrlFallback: !canonical,
      documentUrl,
      canonicalUrl: canonical,
      attachments,
      position: index + 1,
    });
  });

  // A structural change can still leave the row markers intact while breaking
  // the cell layout. Matching rows but extracting nothing must be an error, not
  // a suspiciously clean "0 notices".
  if (rows.length > 0 && notices.length === 0) {
    throw new ParseError(
      `Matched ${rows.length} notification row(s) but could not extract a single notice. ` +
        "The cell layout has probably changed.",
      { sourceId: SOURCE.id, marker: "griderow cells", url: baseUrl },
    );
  }

  return { notices, warnings };
}

/** Fetch the listing page (public, read-only). */
export async function fetchListing(options = {}) {
  const { fetchText, looksLikeAccessWall } = await import("../lib/http.mjs");
  const html = await fetchText(SOURCE.listingUrl, options);
  if (looksLikeAccessWall(html)) {
    throw new ParseError(
      "The notifications page returned an access wall / bot challenge. " +
        "Not attempting to bypass it.",
      { sourceId: SOURCE.id, url: SOURCE.listingUrl },
    );
  }
  return html;
}

export default { SOURCE, hasSkeleton, parse, fetchListing };
