import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  canonicalText,
  contentHash,
  dedupeByCanonicalUrl,
  itemKey,
} from "../lib/dedup.mjs";

const notice = (sourceId, url, title = "t") => ({
  sourceId,
  canonicalUrl: url,
  title,
});

test("itemKey is stable across runs", () => {
  assert.equal(
    itemKey("notifications", "https://jntuh.ac.in/a.pdf"),
    itemKey("notifications", "https://jntuh.ac.in/a.pdf"),
  );
  assert.notEqual(
    itemKey("notifications", "https://jntuh.ac.in/a.pdf"),
    itemKey("exams", "https://jntuh.ac.in/a.pdf"),
  );
});

test("titles are NOT part of identity: identical titles on different URLs stay separate", () => {
  const { unique, duplicates } = dedupeByCanonicalUrl([
    notice("notifications", "https://jntuh.ac.in/a.pdf", "Fee notification"),
    notice("notifications", "https://jntuh.ac.in/b.pdf", "Fee notification"),
  ]);
  assert.equal(unique.length, 2, "two different documents must not be merged");
  assert.equal(duplicates.length, 0);
  assert.notEqual(
    contentHash({ title: "Fee notification", documentUrl: "https://jntuh.ac.in/a.pdf" }),
    contentHash({ title: "Fee notification", documentUrl: "https://jntuh.ac.in/b.pdf" }),
  );
});

test("the same URL is a duplicate even when the title was reworded", () => {
  const { unique, duplicates } = dedupeByCanonicalUrl([
    notice("notifications", "https://jntuh.ac.in/a.pdf", "Original title"),
    notice("notifications", "https://jntuh.ac.in/a.pdf", "A completely reworded title"),
  ]);
  assert.equal(unique.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].reason, "already-seen");
});

test("different sources with the same URL are kept apart", () => {
  const { unique, duplicates } = dedupeByCanonicalUrl([
    notice("notifications", "https://jntuh.ac.in/a.pdf"),
    notice("exams", "https://jntuh.ac.in/a.pdf"),
  ]);
  assert.equal(unique.length, 2);
  assert.equal(duplicates.length, 0);
});

test("a baseline marks items already seen by a previous run", () => {
  const baseline = new Set([itemKey("notifications", "https://jntuh.ac.in/a.pdf")]);
  const { unique, duplicates } = dedupeByCanonicalUrl(
    [
      notice("notifications", "https://jntuh.ac.in/a.pdf"),
      notice("notifications", "https://jntuh.ac.in/b.pdf"),
    ],
    { baselineKeys: baseline },
  );
  assert.equal(unique.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].notice.canonicalUrl, "https://jntuh.ac.in/a.pdf");
});

test("notices without a usable URL are kept, never silently dropped", () => {
  const { unique, duplicates } = dedupeByCanonicalUrl([
    { sourceId: "notifications", canonicalUrl: null, title: "link-less notice" },
  ]);
  assert.equal(unique.length, 1);
  assert.equal(duplicates.length, 0);
});

test("contentHash detects a revision under the same URL", () => {
  const url = "https://jntuh.ac.in/a.pdf";
  const first = contentHash({ title: "Notice", noticeDate: new Date(Date.UTC(2026, 9, 15)), documentUrl: url });
  const revised = contentHash({ title: "Notice (revised)", noticeDate: new Date(Date.UTC(2026, 9, 15)), documentUrl: url });
  assert.notEqual(first, revised, "a re-uploaded document must be seen as a change");
});

test("contentHash is deterministic for the same input", () => {
  const value = contentHash({
    title: "  Fee   notification ",
    noticeDate: new Date(Date.UTC(2026, 9, 15)),
    documentUrl: "https://jntuh.ac.in/a.pdf",
  });
  assert.equal(
    value,
    contentHash({
      title: "Fee notification",
      noticeDate: "2026-10-15",
      documentUrl: "https://jntuh.ac.in/a.pdf",
    }),
  );
  assert.match(value, /^[0-9a-f]{64}$/);
});

test("canonicalText collapses whitespace only", () => {
  assert.equal(canonicalText("  a \n\t b  "), "a b");
  assert.equal(canonicalText(null), "");
});
