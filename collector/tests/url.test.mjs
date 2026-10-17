import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  absolutizeUrl,
  canonicalizeUrl,
  isFileUrl,
  stripSessionTokens,
} from "../lib/url.mjs";

test("stripSessionTokens removes the portal's ;jsessionid path token", () => {
  const input =
    "https://exams1.jntuh.ac.in/Portal/common/downloadFile;jsessionid=072ECD543E3342FDAD2F25A04259D5FD?fileName=a.pdf";
  const expected = "https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=a.pdf";
  assert.equal(stripSessionTokens(input), expected);
});

test("stripSessionTokens leaves ordinary URLs untouched", () => {
  const input = "https://jntuh.ac.in/uploads/notifications/notice.pdf";
  assert.equal(stripSessionTokens(input), input);
});

test("session ids change every visit but the canonical URL stays identical", () => {
  const a = canonicalizeUrl(
    "/Portal/common/downloadFile;jsessionid=072ECD543E3342FDAD2F25A04259D5FD?fileName=duex-1.pdf",
    "https://exams1.jntuh.ac.in",
  );
  const b = canonicalizeUrl(
    "/Portal/common/downloadFile;jsessionid=AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD?fileName=duex-1.pdf",
    "https://exams1.jntuh.ac.in",
  );
  assert.equal(a, b);
  assert.equal(
    a,
    "https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=duex-1.pdf",
  );
});

test("absolute, root-relative and protocol-relative links all resolve", () => {
  const base = "https://jntuh.ac.in/notifications";
  assert.equal(
    canonicalizeUrl("https://jntuh.ac.in/uploads/notifications/x.pdf", base),
    "https://jntuh.ac.in/uploads/notifications/x.pdf",
  );
  assert.equal(
    canonicalizeUrl("/content/notice/140/abc", base),
    "https://jntuh.ac.in/content/notice/140/abc",
  );
  assert.equal(
    canonicalizeUrl("//doa.jntuh.ac.in/pages/mtech_spot_notification", base),
    "https://doa.jntuh.ac.in/pages/mtech_spot_notification",
  );
  assert.equal(
    canonicalizeUrl("notice.pdf", "https://jntuh.ac.in/uploads/notifications/"),
    "https://jntuh.ac.in/uploads/notifications/notice.pdf",
  );
});

test("canonicalization is order/encoding/format independent", () => {
  const base = "https://jntuh.ac.in/";
  assert.equal(
    canonicalizeUrl("https://jntuh.ac.in/content/n/210/x?a=1&b=2", base),
    canonicalizeUrl("https://jntuh.ac.in/content/n/210/x?b=2&a=1", base),
  );
  assert.equal(
    canonicalizeUrl("https://jntuh.ac.in/content/n/210/x?fileName=a%20b.pdf", base),
    canonicalizeUrl("https://jntuh.ac.in/content/n/210/x?fileName=a+b.pdf", base),
  );
  assert.equal(
    canonicalizeUrl("HTTPS://JNTUH.AC.IN/Path//Double/?", base),
    canonicalizeUrl("https://jntuh.ac.in/Path/Double", base),
  );
  assert.equal(
    canonicalizeUrl("https://jntuh.ac.in/notice#section", base),
    "https://jntuh.ac.in/notice",
  );
});

test("different files never canonicalise to the same URL", () => {
  const base = "https://exams1.jntuh.ac.in";
  assert.notEqual(
    canonicalizeUrl("/Portal/common/downloadFile?fileName=a.pdf", base),
    canonicalizeUrl("/Portal/common/downloadFile?fileName=b.pdf", base),
  );
});

test("non-http and unusable inputs return null instead of a bogus key", () => {
  assert.equal(canonicalizeUrl("", "https://jntuh.ac.in"), null);
  assert.equal(canonicalizeUrl(null, "https://jntuh.ac.in"), null);
  assert.equal(canonicalizeUrl("mailto:dean@jntuh.ac.in", "https://jntuh.ac.in"), null);
  assert.equal(canonicalizeUrl("javascript:void(0)", "https://jntuh.ac.in"), null);
  assert.equal(canonicalizeUrl("not a url at all", "also not a url"), null);
});

test("absolutizeUrl keeps session stripping but skips canonicalisation", () => {
  assert.equal(
    absolutizeUrl("/x;jsessionid=ABC?y=1", "https://exams1.jntuh.ac.in"),
    "https://exams1.jntuh.ac.in/x?y=1",
  );
  assert.equal(absolutizeUrl("   ", "https://jntuh.ac.in"), null);
});

test("isFileUrl recognises files in the path and in the query string", () => {
  // main site: extension in the path
  assert.equal(isFileUrl("https://jntuh.ac.in/uploads/notifications/a.pdf"), true);
  assert.equal(isFileUrl("https://jntuh.ac.in/uploads/notifications/b.ZIP"), true);
  assert.equal(isFileUrl("https://jntuh.ac.in/uploads/calendars/c.docx"), true);
  // exam portal: extension only in a query parameter
  assert.equal(
    isFileUrl("https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=duex-1.pdf"),
    true,
  );
  assert.equal(
    isFileUrl("https://exams1.jntuh.ac.in/Portal/common/downloadTimetable?fileName=tt.docx"),
    true,
  );
  // plain pages / false positives
  assert.equal(isFileUrl("https://jntuh.ac.in/content/notice/210/abc123"), false);
  assert.equal(isFileUrl("https://jntuh.ac.in/notifications"), false);
  assert.equal(isFileUrl("http://results.jntuh.ac.in/"), false);
  assert.equal(isFileUrl("https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=pdf"), false);
  assert.equal(isFileUrl(""), false);
  assert.equal(isFileUrl(null), false);
});
