import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import notifications, { SOURCE } from "../sources/notifications.mjs";
import { ParseError } from "../lib/errors.mjs";
import { dedupeByCanonicalUrl } from "../lib/dedup.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("parses the listing into notices with title, date, source and document URLs", () => {
  const { notices, warnings } = notifications.parse(fixture("notifications.html"));

  assert.equal(notices.length, 9, "all nine rows should parse");
  assert.deepEqual(warnings, []);

  const first = notices[0];
  assert.match(first.title, /Permission for Late Submission/);
  assert.ok(!first.title.includes("new_icon"), "the <img> marker is not part of the title");
  assert.equal(first.dateRaw, "15 Oct 2026");
  assert.equal(first.noticeDate?.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(
    first.sourceUrl,
    "https://jntuh.ac.in/uploads/notifications/OTC_project_permissionforlatesubmissionproceeding1.pdf",
  );
  assert.equal(first.documentUrl, first.sourceUrl, "a PDF is both the source and the document");
  assert.equal(first.category, SOURCE.categoryDefault);
  assert.equal(first.sourceName, SOURCE.name);
  assert.equal(first.sourceUrlFallback, false);
});

test("resolves relative and protocol-relative links against the listing URL", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  const relative = notices[1];
  assert.equal(
    relative.sourceUrl,
    "https://jntuh.ac.in/content/notification-for-admission-into-b.tech.-for-working-professionals/140/868a6f3b25b2e478ca162f15d9d0ab8f",
  );
  assert.equal(relative.documentUrl, null, "an HTML notice page is not a document");

  assert.equal(notices[2].sourceUrl, "https://doa.jntuh.ac.in/pages/mtech_spot_notification");
});

test("HTML entities in titles and hrefs are decoded", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  assert.ok(
    notices[1].title.includes("& Guidelines"),
    `expected decoded ampersand, got: ${notices[1].title}`,
  );
  // rows 8 and 9 differ only in query-parameter order / &amp; encoding
  assert.equal(notices[7].sourceUrl, notices[8].sourceUrl);
});

test("a missing date is reported as null, never guessed", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  const undated = notices[3];
  assert.equal(undated.dateRaw, "");
  assert.equal(undated.noticeDate, null);
  assert.equal(undated.title, "Circular without a published date");
});

test("a row with no link keeps its title and falls back to the listing URL", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  const linkless = notices[4];
  assert.equal(linkless.title, "Notice text with no anchor at all");
  assert.equal(linkless.canonicalUrl, null);
  assert.equal(linkless.documentUrl, null);
  assert.equal(linkless.sourceUrl, SOURCE.listingUrl);
  assert.equal(linkless.sourceUrlFallback, true);
});

test("ZIP/DOC style attachments are recognised as documents", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  assert.match(notices[6].documentUrl ?? "", /\.zip$/i);
  assert.match(notices[6].title, /Revised syllabus bundle/);
});

test("duplicate rows collapse to one notice, by URL not by wording", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  const { unique, duplicates } = dedupeByCanonicalUrl(notices);

  assert.equal(unique.length, 7);
  assert.equal(duplicates.length, 2);
  // The two duplicated rows carry *different* titles from their originals.
  assert.ok(duplicates.every((d) => d.reason === "already-seen"));
  assert.ok(duplicates.every((d) => d.notice.canonicalUrl !== null));
});

test("an empty but well-formed listing parses to zero notices without erroring", () => {
  const { notices, warnings } = notifications.parse(fixture("notifications-empty.html"));
  assert.equal(notices.length, 0);
  assert.deepEqual(warnings, []);
});

test("unexpected markup raises a clear ParseError", () => {
  assert.throws(
    () => notifications.parse(fixture("unexpected.html")),
    (error) => {
      assert.ok(error instanceof ParseError, "expected a ParseError");
      assert.match(error.message, /no longer contains the expected table structure/);
      assert.equal(error.sourceId, "notifications");
      return true;
    },
  );
});

test("rows that match but yield nothing are an error, not a silent empty list", () => {
  const html = `
    <table>
      <tr class="grideheader"><td>S.No.</td><td>Date</td><td>Title</td></tr>
      <tr class="griderow1"><td>only one cell</td></tr>
      <tr class="griderow2"><td>also one cell</td></tr>
    </table>`;
  assert.throws(
    () => notifications.parse(html),
    (error) => error instanceof ParseError && /could not extract a single notice/.test(error.message),
  );
});
