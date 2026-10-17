import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ingestItemId, isIngestItemId } from "../lib/ingestIds.mjs";
import {
  REVIEW_STATE,
  isInReviewQueue,
  planIngest,
} from "../lib/ingestPlan.mjs";

const NOW = new Date(Date.UTC(2026, 9, 17, 6, 0, 0));
const EARLIER = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));

/** A URL for a fabricated notice. */
const link = (slug) => `https://jntuh.ac.in/uploads/notifications/${slug}.pdf`;

/**
 * A notice shaped exactly like the ones the source adapters emit
 * (see collector/sources/notifications.mjs). `documentUrl` follows
 * `canonicalUrl` unless the test overrides it.
 */
function notice(overrides = {}) {
  const canonicalUrl = overrides.canonicalUrl === undefined ? link("a") : overrides.canonicalUrl;
  return {
    sourceId: "notifications",
    sourceName: "JNTUH Notifications",
    listingUrl: "https://jntuh.ac.in/notifications",
    category: "general",
    title: "Fee notification",
    dateRaw: "15 Oct 2026",
    noticeDate: new Date(Date.UTC(2026, 9, 15)),
    noticeHref: "a.pdf",
    sourceUrl: canonicalUrl ?? "https://jntuh.ac.in/notifications",
    sourceUrlFallback: !canonicalUrl,
    documentUrl: canonicalUrl,
    canonicalUrl,
    attachments: [],
    position: 1,
    ...overrides,
  };
}

/**
 * The stored item document for `n`, produced by the planner itself so the test
 * never has to recompute the content hash by hand.
 */
function storedFor(n, overrides = {}) {
  const { documents } = planIngest([n], { runId: "run-1", now: EARLIER });
  return { ...documents[0], ...overrides };
}

/** Alert lifecycle fields that must never appear on an ingest document. */
const ALERT_LIFECYCLE_FIELDS = [
  "status", "pinned", "audience", "tags",
  "publishedAt", "deadlineAt", "verifiedAt", "verifiedBy",
  "createdBy", "updatedBy", "schemaVersion",
];

test("a brand-new notice is created as a reviewable item", () => {
  const n = notice();
  const { documents, stats } = planIngest([n], { runId: "run-1", now: NOW });

  assert.equal(documents.length, 1);
  const doc = documents[0];

  assert.equal(doc.itemId, ingestItemId("notifications", n.canonicalUrl));
  assert.equal(isIngestItemId(doc.itemId), true);
  assert.equal(doc.reviewState, REVIEW_STATE.NEW);
  assert.equal(doc.seenCount, 1);
  assert.equal(doc.firstSeenAt, NOW);
  assert.equal(doc.lastSeenAt, NOW);
  assert.equal(doc.lastRunId, "run-1");
  assert.match(doc.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(doc.changedAt, undefined);
  assert.equal(doc.previousHash, undefined);
  assert.equal(isInReviewQueue(doc), true);

  for (const field of ALERT_LIFECYCLE_FIELDS) {
    assert.ok(!(field in doc), `an ingest document must not carry "${field}"`);
  }

  assert.deepEqual(stats, {
    planned: 1, created: 1, refreshed: 0, changed: 0,
    queued: 1, promoted: 0, ignored: 0,
    deferred: 0, unaddressable: 0, duplicateInput: 0,
  });
});

test("an unchanged notice is refreshed, not re-created", () => {
  const n = notice();
  const stored = storedFor(n, {
    seenCount: 3, firstSeenAt: EARLIER, lastSeenAt: EARLIER, lastRunId: "run-1",
  });

  const { documents, stats } = planIngest([n], {
    existing: { [stored.itemId]: stored },
    runId: "run-2",
    now: NOW,
  });

  const doc = documents[0];
  assert.equal(doc.reviewState, REVIEW_STATE.NEW);
  assert.equal(doc.seenCount, 4, "seenCount must increment");
  assert.equal(doc.firstSeenAt, EARLIER, "firstSeenAt must be preserved");
  assert.equal(doc.lastSeenAt, NOW, "lastSeenAt must advance");
  assert.equal(doc.lastRunId, "run-2", "lastRunId must advance");
  assert.equal(doc.changedAt, undefined, "an unchanged notice is not a revision");
  assert.equal(doc.previousHash, undefined);

  assert.equal(stats.created, 0);
  assert.equal(stats.refreshed, 1);
});

test("a revision records previousHash and changedAt", () => {
  const before = notice({ title: "Original notice" });
  const stored = storedFor(before, { firstSeenAt: EARLIER });

  const after = notice({ title: "Original notice (revised)" });
  const { documents, stats } = planIngest([after], {
    existing: { [stored.itemId]: stored },
    runId: "run-2",
    now: NOW,
  });

  const doc = documents[0];
  assert.notEqual(doc.contentHash, stored.contentHash);
  assert.equal(doc.previousHash, stored.contentHash);
  assert.equal(doc.changedAt, NOW);
  assert.equal(doc.reviewState, REVIEW_STATE.NEW, "an already-new item may stay new");
  assert.equal(stats.changed, 1);
});

test("a promoted item is never reset to new", () => {
  const n = notice();
  const stored = storedFor(n, {
    reviewState: REVIEW_STATE.PROMOTED,
    promotedAlertId: "alert-1",
    promotedAt: EARLIER,
    promotedBy: "admin@jntuh.example",
    firstSeenAt: EARLIER,
  });
  const existing = { [stored.itemId]: stored };

  const unchanged = planIngest([n], { existing, runId: "run-2", now: NOW }).documents[0];
  assert.equal(unchanged.reviewState, REVIEW_STATE.PROMOTED);
  assert.equal(unchanged.promotedAlertId, "alert-1");
  assert.equal(unchanged.promotedAt, EARLIER);
  assert.equal(unchanged.promotedBy, "admin@jntuh.example");
  assert.equal(isInReviewQueue(unchanged), false);

  const revised = notice({ title: "Revised after promotion" });
  const changed = planIngest([revised], { existing, runId: "run-3", now: NOW }).documents[0];
  assert.equal(changed.reviewState, REVIEW_STATE.PROMOTED, "a revision must not re-queue it");
  assert.equal(changed.promotedAlertId, "alert-1");
  assert.equal(changed.previousHash, stored.contentHash);
  assert.equal(changed.changedAt, NOW);
  assert.equal(isInReviewQueue(changed), false);
});

test("an ignored item is never resurrected", () => {
  const n = notice();
  const stored = storedFor(n, { reviewState: REVIEW_STATE.IGNORED, firstSeenAt: EARLIER });
  const existing = { [stored.itemId]: stored };

  const unchanged = planIngest([n], { existing, runId: "run-2", now: NOW }).documents[0];
  assert.equal(unchanged.reviewState, REVIEW_STATE.IGNORED);
  assert.equal(isInReviewQueue(unchanged), false);

  const revised = notice({ title: "Revised after ignore" });
  const afterChange = planIngest([revised], { existing, runId: "run-3", now: NOW }).documents[0];
  assert.equal(afterChange.reviewState, REVIEW_STATE.IGNORED, "a revision must not resurrect it");
  assert.equal(afterChange.changedAt, NOW, "the revision is still recorded for audit");
  assert.equal(isInReviewQueue(afterChange), false);
});

test("an unrecognised review state is surfaced as new rather than lost", () => {
  const n = notice();
  const stored = storedFor(n, { reviewState: "archived-legacy" });
  const doc = planIngest([n], {
    existing: { [stored.itemId]: stored },
    runId: "run-2",
    now: NOW,
  }).documents[0];

  assert.equal(doc.reviewState, REVIEW_STATE.NEW);
  assert.equal(isInReviewQueue(doc), true);
});

test("maxItems caps new items; known items never consume the budget", () => {
  const known = notice({ canonicalUrl: link("known") });
  const stored = storedFor(known, { firstSeenAt: EARLIER });
  const fresh = [
    notice({ canonicalUrl: link("1") }),
    notice({ canonicalUrl: link("2") }),
    notice({ canonicalUrl: link("3") }),
  ];

  const { documents, stats, deferredItemIds } = planIngest([known, ...fresh], {
    existing: { [stored.itemId]: stored },
    runId: "run-2",
    now: NOW,
    maxItems: 2,
  });

  assert.equal(stats.created, 2);
  assert.equal(stats.refreshed, 1, "the known item is still refreshed");
  assert.equal(stats.deferred, 1);
  assert.equal(stats.planned, 3);
  assert.equal(documents.length, 3);
  assert.equal(deferredItemIds.length, 1);
});

test("maxItems truncation does not depend on input order", () => {
  const notices = Array.from({ length: 5 }, (_, i) => notice({ canonicalUrl: link(`n${i}`) }));
  const forward = planIngest(notices, { runId: "r", now: NOW, maxItems: 2 });
  const backward = planIngest([...notices].reverse(), { runId: "r", now: NOW, maxItems: 2 });

  const ids = (result) => result.documents.map((d) => d.itemId).sort();
  assert.equal(forward.documents.length, 2);
  assert.deepEqual(ids(forward), ids(backward));
  assert.deepEqual([...forward.deferredItemIds].sort(), [...backward.deferredItemIds].sort());
});

test("deferred items are admitted on the next run", () => {
  const notices = Array.from({ length: 4 }, (_, i) => notice({ canonicalUrl: link(`n${i}`) }));

  const first = planIngest(notices, { runId: "r1", now: NOW, maxItems: 2 });
  assert.equal(first.stats.deferred, 2);

  const existing = Object.fromEntries(first.documents.map((d) => [d.itemId, d]));
  const second = planIngest(notices, { existing, runId: "r2", now: NOW, maxItems: 2 });

  assert.equal(second.stats.created, 2, "the deferred items get their turn");
  assert.equal(second.stats.deferred, 0);
  assert.equal(
    new Set([...first.documents, ...second.documents].map((d) => d.itemId)).size,
    4,
  );
});

test("maxItems 0 defers everything; Infinity and no cap admit everything", () => {
  const notices = Array.from({ length: 3 }, (_, i) => notice({ canonicalUrl: link(`n${i}`) }));

  const none = planIngest(notices, { runId: "r", now: NOW, maxItems: 0 });
  assert.equal(none.documents.length, 0);
  assert.equal(none.stats.deferred, 3);

  const infinite = planIngest(notices, { runId: "r", now: NOW, maxItems: Infinity });
  assert.equal(infinite.documents.length, 3);
  assert.equal(infinite.stats.deferred, 0);

  const uncapped = planIngest(notices, { runId: "r", now: NOW });
  assert.equal(uncapped.documents.length, 3);
});

test("notices with no canonical URL are reported, never planned", () => {
  const { documents, stats, unaddressableNotices } = planIngest(
    [notice({ canonicalUrl: null }), notice()],
    { runId: "r", now: NOW },
  );

  assert.equal(documents.length, 1);
  assert.equal(stats.unaddressable, 1);
  assert.equal(stats.created, 1);
  assert.equal(unaddressableNotices.length, 1);
  assert.equal(unaddressableNotices[0].canonicalUrl, null);
});

test("the same item passed twice is collapsed and counted", () => {
  const n = notice();
  const { documents, stats } = planIngest([n, { ...n, title: "rephrased" }], {
    runId: "r",
    now: NOW,
  });

  assert.equal(documents.length, 1);
  assert.equal(stats.duplicateInput, 1);
});

test("planning never mutates its inputs and is repeatable", () => {
  const n = Object.freeze(notice());
  const notices = Object.freeze([n]);
  const stored = storedFor(n, { firstSeenAt: EARLIER });
  const existing = Object.freeze({ [stored.itemId]: Object.freeze({ ...stored }) });

  const first = planIngest(notices, { existing, runId: "r", now: NOW });
  const second = planIngest(notices, { existing, runId: "r", now: NOW });
  assert.deepEqual(first, second);

  first.documents[0].title = "mutated after the fact";
  const third = planIngest(notices, { existing, runId: "r", now: NOW });
  assert.equal(third.documents[0].title, "Fee notification", "each call returns fresh values");
});

test("attachments are de-duplicated and blanks dropped", () => {
  const n = notice({
    attachments: ["https://x/a.pdf", " https://x/a.pdf ", "", "https://x/b.pdf"],
  });
  const doc = planIngest([n], { runId: "r", now: NOW }).documents[0];
  assert.deepEqual(doc.attachments, ["https://x/a.pdf", "https://x/b.pdf"]);
});

test("stats account for every planned document", () => {
  const known = notice({ canonicalUrl: link("known") });
  const promoted = notice({ canonicalUrl: link("promoted") });
  const changed = notice({ canonicalUrl: link("changed"), title: "changed since" });

  const existing = {
    [storedFor(known).itemId]: storedFor(known),
    [storedFor(promoted).itemId]: storedFor(promoted, { reviewState: REVIEW_STATE.PROMOTED }),
    [storedFor(notice({ canonicalUrl: link("changed") })).itemId]: storedFor(notice({ canonicalUrl: link("changed") })),
  };

  const { documents, stats } = planIngest([known, promoted, changed, notice({ canonicalUrl: link("fresh") })], {
    existing,
    runId: "r",
    now: NOW,
  });

  assert.equal(stats.created + stats.refreshed + stats.changed, stats.planned);
  assert.equal(stats.queued + stats.promoted + stats.ignored, stats.planned);
  assert.equal(documents.length, stats.planned);
});

test("a promoted item never returns to the review queue over repeated runs", () => {
  const n = notice();
  let existing = null;

  const first = planIngest([n], { existing, runId: "r1", now: NOW });
  assert.equal(first.documents[0].reviewState, REVIEW_STATE.NEW);
  assert.equal(first.stats.queued, 1);

  // A human promotes it.
  const promoted = {
    ...first.documents[0],
    reviewState: REVIEW_STATE.PROMOTED,
    promotedAlertId: "alert-1",
    promotedAt: NOW,
    promotedBy: "admin@jntuh.example",
  };
  existing = { [promoted.itemId]: promoted };

  for (const runId of ["r2", "r3", "r4"]) {
    const plan = planIngest([n], { existing, runId, now: NOW });
    const doc = plan.documents[0];
    assert.equal(doc.reviewState, REVIEW_STATE.PROMOTED);
    assert.equal(doc.promotedAlertId, "alert-1");
    assert.equal(isInReviewQueue(doc), false);
    assert.equal(plan.stats.queued, 0);
    existing = { [doc.itemId]: doc };
  }
});
