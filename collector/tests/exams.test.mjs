import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import exams, { SOURCE } from "../sources/exams.mjs";
import { ParseError } from "../lib/errors.mjs";
import { dedupeByCanonicalUrl } from "../lib/dedup.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("collects only the Notifications pane by default", () => {
  const { notices, warnings } = exams.parse(fixture("exams.html"));

  assert.equal(notices.length, 4, "four link-bearing items in the pane");
  assert.deepEqual(warnings, [
    'pane "notification" item #4: empty title or missing link - skipped',
  ]);
  assert.ok(notices.every((n) => n.pane === "notification"));
  assert.ok(notices.every((n) => n.category === "exams"));
});

test("strips the servlet session id from every link and keeps the file name", () => {
  const { notices } = exams.parse(fixture("exams.html"));
  const first = notices[0];

  assert.equal(
    first.documentUrl,
    "https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=duex-261016-122832-OTC+project+-+permission+for+late+submission+proceeding.pdf",
  );
  assert.ok(!first.documentUrl.includes("jsessionid"));
  assert.ok(first.noticeHref.includes("jsessionid"), "raw href keeps what the page actually had");
});

test("session ids differing per visit do not create a duplicate notice", () => {
  const { notices } = exams.parse(fixture("exams.html"));
  const { unique, duplicates } = dedupeByCanonicalUrl(notices);

  assert.equal(unique.length, 3);
  assert.equal(duplicates.length, 1, "item 5 reuses item 1's file with a new session id");
  assert.equal(duplicates[0].reason, "already-seen");
  assert.match(duplicates[0].notice.title, /different session id/);
});

test("a missing date is null, a missing link is skipped - nothing is invented", () => {
  const { notices, warnings } = exams.parse(fixture("exams.html"));

  const undated = notices.find((n) => n.title.includes("no published date"));
  assert.ok(undated, "the undated notice is still collected");
  assert.equal(undated.dateRaw, "");
  assert.equal(undated.noticeDate, null);

  assert.ok(
    warnings.some((w) => w.includes("item #4")),
    "the link-less item is reported as a warning",
  );
});

test("timetable and other panes are opt-in and map to the shared categories", () => {
  const base = { panes: ["timetable"] };
  const timetable = exams.parse(fixture("exams.html"), base);
  assert.equal(timetable.notices.length, 1);
  assert.equal(timetable.notices[0].category, "timetable");
  assert.match(timetable.notices[0].documentUrl, /downloadTimetable\?fileName=.*\.docx$/);

  const others = exams.parse(fixture("exams.html"), { panes: ["others"] });
  assert.equal(others.notices.length, 2);
  assert.equal(others.notices[0].category, "general");
  assert.equal(
    others.notices[0].documentUrl,
    "https://exams1.jntuh.ac.in/Portal/common/downloadOther?fileName=duex-261015-091500-Result+notification.jpg",
  );
  // an item pointing at another JNTUH service is a link, not a document
  assert.equal(others.notices[1].documentUrl, null);
  assert.equal(others.notices[1].sourceUrl, "http://results.jntuh.ac.in/");
});

test("collecting every pane yields the union of the panes", () => {
  const { notices } = exams.parse(fixture("exams.html"), {
    panes: ["notification", "timetable", "others"],
  });
  assert.equal(notices.length, 7);
  assert.deepEqual(
    [...new Set(notices.map((n) => n.category))].sort(),
    ["exams", "general", "timetable"],
  );
});

test("an unknown pane is reported rather than silently accepted", () => {
  const { notices, warnings } = exams.parse(fixture("exams.html"), { panes: ["bogus"] });
  assert.equal(notices.length, 0);
  assert.match(warnings[0], /unknown pane "bogus"/);
});

test("a known pane that is missing from the page is reported", () => {
  const html = `<div id="notification" class="tab-pane active"><div class="notification-item">
      <div class="notification-date">01-01-2026</div>
      <div><a href="/Portal/common/downloadFile?fileName=a.pdf">Only item</a></div>
    </div></div>`;
  const { notices, warnings } = exams.parse(html, { panes: ["timetable"] });
  assert.equal(notices.length, 0);
  assert.match(warnings[0], /pane "timetable" not found/);
});

test("unexpected markup raises a clear ParseError", () => {
  assert.throws(
    () => exams.parse(fixture("unexpected.html")),
    (error) => {
      assert.ok(error instanceof ParseError, "expected a ParseError");
      assert.match(error.message, /no longer contains the expected structure/);
      assert.equal(error.sourceId, "exams");
      return true;
    },
  );
});
