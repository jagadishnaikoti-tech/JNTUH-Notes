// ---------------------------------------------------------------------------
// Source adapter #2: https://exams1.jntuh.ac.in/
//
// What the portal actually is (verified during Phase 1 discovery):
//   * `/` answers with <meta http-equiv=Refresh> -> /Portal/common/load
//   * `/Portal/common/load` is a public page titled "JNTUH University Exam
//     Portal" containing three Bootstrap tab panes:
//         #notification  40 items   /Portal/common/downloadFile?fileName=*.pdf
//         #timetable     20 items   /Portal/common/downloadTimetable?fileName=*
//         #others        20 items   /Portal/common/downloadOther?fileName=*
//                                    plus links to results/studentservices/epay
//   * each item is
//         <div class="notification-item">
//           <div class="row">
//             <div class="col-md-2 notification-date"> 16-10-2026 </div>
//             <div class="col-md-10"> <a href="...">Title</a> </div>
//   * date format is DD-MM-YYYY
//   * links carry a servlet session token: .../downloadFile;jsessionid=ABC?fileName=...
//     which changes every visit and is therefore stripped (see lib/url.mjs).
//     The token is not required - the endpoint serves the file without it.
//
// Only the "notification" pane is collected by default (that is the
// notification listing); the other panes are opt-in via { panes } so timetables
// and "other" service links are not silently mixed into the alert feed.
// ---------------------------------------------------------------------------

import { getAlertSource } from "../../src/data/alertSources.js";
import { ParseError } from "../lib/errors.mjs";
import { decodeEntities, matchIndexed, removeComments, textOf } from "../lib/html.mjs";
import { parseNoticeDate } from "../lib/date.mjs";
import { canonicalizeUrl, isFileUrl } from "../lib/url.mjs";

const META = getAlertSource("exams");

export const SOURCE = Object.freeze({
  id: "exams",
  name: META?.name ?? "JNTUH Examinations Portal",
  listingUrl: "https://exams1.jntuh.ac.in/Portal/common/load",
  homeUrl: META?.url ?? "https://exams1.jntuh.ac.in/",
  description:
    "Examination branch portal: exam notifications, timetables and service links (public HTML).",
  /** Pane id -> established alert category (see src/data/alertSources.js). */
  paneCategory: Object.freeze({
    notification: "exams",
    timetable: "timetable",
    others: "general",
  }),
  /** Panes collected unless the caller overrides them. */
  defaultPanes: Object.freeze(["notification"]),
});

const PANE_START = /<div\b[^>]*\bid\s*=\s*["'](notification|timetable|others)["'][^>]*>/gi;
const ITEM_START = /<div\b[^>]*class\s*=\s*["'][^"']*notification-item[^"']*["'][^>]*>/i;
const DATE_CELL = /<div\b[^>]*class\s*=\s*["'][^"']*notification-date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
const ANCHOR = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

/** Structural markers that prove we are looking at the expected portal page. */
export function hasSkeleton(html) {
  const body = String(html ?? "");
  return ITEM_START.test(body) || /JNTUH University Exam Portal/i.test(body);
}

/**
 * Parse the exam portal listing.
 *
 * @param {string} html raw response body of /Portal/common/load
 * @param {{panes?: string[], baseUrl?: string}} [options]
 * @returns {{notices: Array, warnings: string[]}}
 * @throws {ParseError} when the markup does not match the expected structure
 */
export function parse(html, options = {}) {
  const baseUrl = options.baseUrl ?? SOURCE.listingUrl;
  const panes = options.panes ?? [...SOURCE.defaultPanes];
  const body = removeComments(html);

  if (!hasSkeleton(body)) {
    throw new ParseError(
      "The exam portal page no longer contains the expected structure " +
        "(no '.notification-item' blocks and no portal title). The markup has probably changed.",
      { sourceId: SOURCE.id, marker: "notification-item", url: baseUrl },
    );
  }

  const warnings = [];
  const notices = [];
  let totalChunks = 0;

  // Locate the pane boundaries so items are attributed to the right tab.
  const boundaries = matchIndexed(body, PANE_START).map((m) => ({
    id: m.groups[0],
    at: m.index,
  }));
  const paneRange = (id) => {
    const start = boundaries.find((b) => b.id === id);
    if (!start) return null;
    const next = boundaries.find((b) => b.at > start.at);
    return { from: start.at, to: next ? next.at : body.length };
  };

  for (const pane of panes) {
    const category = SOURCE.paneCategory[pane];
    if (!category) {
      warnings.push(`unknown pane "${pane}" - ignored (expected notification|timetable|others)`);
      continue;
    }

    const range = paneRange(pane);
    if (!range) {
      warnings.push(`pane "${pane}" not found in the page - skipped`);
      continue;
    }

    const segment = body.slice(range.from, range.to);
    const chunks = segment.split(ITEM_START).slice(1);
    totalChunks += chunks.length;

    if (chunks.length === 0) {
      warnings.push(`pane "${pane}" contains no items`);
      continue;
    }

    chunks.forEach((chunk, index) => {
      const dateRaw = textOf(chunk.match(DATE_CELL)?.[1] ?? "");
      const anchor = chunk.match(ANCHOR);
      // href attribute values are entity-encoded; decode before canonicalising.
      const noticeHref = anchor ? decodeEntities(anchor[1]).trim() : "";
      const title = anchor ? textOf(anchor[2]) : "";

      if (!title) {
        warnings.push(`pane "${pane}" item #${index + 1}: empty title or missing link - skipped`);
        return;
      }

      const canonical = noticeHref ? canonicalizeUrl(noticeHref, baseUrl) : null;
      const documentUrl = canonical && isFileUrl(canonical) ? canonical : null;

      notices.push({
        sourceId: SOURCE.id,
        sourceName: SOURCE.name,
        listingUrl: SOURCE.listingUrl,
        pane,
        category,
        title,
        dateRaw,
        noticeDate: parseNoticeDate(dateRaw),
        noticeHref: noticeHref || null,
        sourceUrl: canonical ?? SOURCE.listingUrl,
        sourceUrlFallback: !canonical,
        documentUrl,
        canonicalUrl: canonical,
        attachments: [],
        position: index + 1,
      });
    });
  }

  // Same guard as the notifications adapter: finding items but extracting no
  // notice means the markup changed shape and must be reported, not ignored.
  if (totalChunks > 0 && notices.length === 0) {
    throw new ParseError(
      `Matched ${totalChunks} exam portal item(s) but could not extract a single notice. ` +
        "The item markup has probably changed.",
      { sourceId: SOURCE.id, marker: "notification-item content", url: baseUrl },
    );
  }

  return { notices, warnings };
}

/** Fetch the portal listing page (public, read-only). */
export async function fetchListing(options = {}) {
  const { fetchText, looksLikeAccessWall } = await import("../lib/http.mjs");
  const html = await fetchText(SOURCE.listingUrl, options);
  if (looksLikeAccessWall(html)) {
    throw new ParseError(
      "The exam portal returned an access wall / bot challenge. Not attempting to bypass it.",
      { sourceId: SOURCE.id, url: SOURCE.listingUrl },
    );
  }
  return html;
}

export default { SOURCE, hasSkeleton, parse, fetchListing };
