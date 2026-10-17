import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import notifications from "../sources/notifications.mjs";
import { dedupeByCanonicalUrl } from "../lib/dedup.mjs";
import {
  ALLOWED_ALERT_KEYS,
  DraftError,
  assertDraftOnly,
  toAlertDraft,
} from "../lib/alertDraft.mjs";
import { ALERT_CATEGORY_IDS } from "../../src/data/alertSources.js";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const baseNotice = {
  sourceId: "notifications",
  title: "Circular about examinations",
  noticeDate: new Date(Date.UTC(2026, 9, 15)),
  category: "general",
  sourceName: "JNTUH Notifications",
  sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  documentUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  canonicalUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
};

test("a draft carries only the keys firestore.rules allows", () => {
  const { alert } = toAlertDraft(baseNotice);
  assert.deepEqual(
    Object.keys(alert).sort(),
    [...ALLOWED_ALERT_KEYS].filter((k) => k !== "createdAt" && k !== "updatedAt").sort(),
  );
  assert.ok(Object.keys(alert).every((key) => ALLOWED_ALERT_KEYS.includes(key)));
});

test("the draft-only invariant holds: never published, never pre-verified", () => {
  const { alert, collector } = toAlertDraft(baseNotice);
  assert.equal(alert.status, "draft");
  assert.equal(alert.verifiedAt, null);
  assert.equal(alert.verifiedBy, "");
  assert.equal(alert.pinned, false);
  assert.equal(alert.schemaVersion, 1);
  assert.equal(alert.createdBy, "collector:notifications");
  assert.match(collector.contentHash, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => assertDraftOnly(alert));
});

test("nothing is invented: no date stays null, no summary is fabricated", () => {
  const { alert, collector } = toAlertDraft({ ...baseNotice, noticeDate: null });
  assert.equal(alert.publishedAt, null);
  assert.equal(alert.summary, "", "summary must be left for an admin to write");
  assert.ok(collector.reviewReasons.includes("summary-required"));
  assert.ok(collector.reviewReasons.includes("date-missing"));
});

test("a parsed date becomes publishedAt and a stated deadline is never guessed", () => {
  const { alert } = toAlertDraft(baseNotice);
  assert.equal(alert.publishedAt?.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(alert.deadlineAt, null);
});

test("only the eight shared category ids are accepted", () => {
  for (const category of ALERT_CATEGORY_IDS) {
    assert.doesNotThrow(() => toAlertDraft({ ...baseNotice, category }));
  }
  assert.throws(
    () => toAlertDraft({ ...baseNotice, category: "breaking-news" }),
    (e) => e instanceof DraftError && /not one of the allowed ids/.test(e.message),
  );
  assert.throws(() => toAlertDraft({ ...baseNotice, category: "" }), DraftError);
});

test("an unusable notice is rejected instead of producing a broken alert", () => {
  assert.throws(
    () => toAlertDraft({ ...baseNotice, title: "ab" }),
    (e) => e instanceof DraftError && /shorter than 3 characters/.test(e.message),
  );
  assert.throws(
    () => toAlertDraft({ ...baseNotice, sourceUrl: "" }),
    (e) => e instanceof DraftError && /no source URL/.test(e.message),
  );
  assert.throws(
    () => toAlertDraft({ ...baseNotice, sourceUrl: "javascript:alert(1)" }),
    (e) => e instanceof DraftError && /not a valid http/.test(e.message),
  );
  assert.throws(() => toAlertDraft(null), DraftError);
});

test("an over-long title is clipped to the rules limit and flagged for review", () => {
  const { alert, collector } = toAlertDraft({
    ...baseNotice,
    title: `${"word ".repeat(80)}tail`,
  });
  assert.ok(alert.title.length <= 200);
  assert.ok(collector.reviewReasons.includes("title-clipped"));
  assert.ok(collector.titleFull.length > 200, "the full title is kept for the reviewer");
});

test("assertDraftOnly refuses anything that is not a clean draft", () => {
  const { alert } = toAlertDraft(baseNotice);

  assert.throws(
    () => assertDraftOnly({ ...alert, status: "published" }),
    (e) => e instanceof DraftError && /non-draft/.test(e.message),
  );
  assert.throws(
    () => assertDraftOnly({ ...alert, verifiedAt: new Date() }),
    (e) => e instanceof DraftError && /pre-verified/.test(e.message),
  );
  assert.throws(
    () => assertDraftOnly({ ...alert, verifiedBy: "someone@example.com" }),
    DraftError,
  );
  assert.throws(
    () => assertDraftOnly({ ...alert, pinned: true }),
    (e) => e instanceof DraftError && /must not be pinned/.test(e.message),
  );
  assert.throws(
    () => assertDraftOnly({ ...alert, collectedAt: new Date() }),
    (e) => e instanceof DraftError && /not allowed by firestore.rules/.test(e.message),
  );
  assert.throws(() => assertDraftOnly({}), DraftError);
});

test("every notice parsed from a real fixture becomes a valid draft", () => {
  const { notices } = notifications.parse(fixture("notifications.html"));
  const { unique } = dedupeByCanonicalUrl(notices);

  let built = 0;
  for (const notice of unique) {
    const { alert } = toAlertDraft(notice);
    assert.equal(alert.status, "draft");
    assert.doesNotThrow(() => assertDraftOnly(alert));
    built += 1;
  }
  assert.equal(built, 7);
});
