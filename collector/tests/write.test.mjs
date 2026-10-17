import { strict as assert } from "node:assert";
import { test } from "node:test";

import { RUN_STATUS, SOURCE_OUTCOME, SOURCE_STATUS, STAGING_COLLECTIONS } from "../lib/runReport.mjs";
import { RUN_WRITE_FAILED, createRunId, executeRun, planRun } from "../write.mjs";

function makeStore({ failOn = null, failure = null } = {}) {
  const items = new Map();
  const health = new Map();
  const runs = new Map();
  const commits = [];
  let calls = 0;

  return {
    projectId: "jntuh-notes-6ef74",
    mode: "test",
    isEmulator: true,
    async readItems(ids) {
      const out = new Map();
      for (const id of ids ?? []) if (items.has(id)) out.set(id, items.get(id));
      return out;
    },
    async readSourceHealth(ids) {
      const out = new Map();
      for (const id of ids ?? []) if (health.has(id)) out.set(id, health.get(id));
      return out;
    },
    async readRuns(ids) {
      const out = new Map();
      for (const id of ids ?? []) if (runs.has(id)) out.set(id, runs.get(id));
      return out;
    },
    async commitMutations(mutations) {
      const call = calls;
      calls += 1;
      commits.push([...mutations]);
      if (typeof failOn === "function" && failOn(call, mutations)) {
        const error = typeof failure === "function" ? failure(call, mutations) : failure;
        throw error instanceof Error ? error : new Error(`simulated commit failure at call ${call}`);
      }
      for (const m of mutations) {
        if (m.delete) {
          if (m.collection === STAGING_COLLECTIONS.ITEMS) items.delete(m.id);
          if (m.collection === STAGING_COLLECTIONS.HEALTH) health.delete(m.id);
          if (m.collection === STAGING_COLLECTIONS.RUNS) runs.delete(m.id);
          continue;
        }
        const data = m.data ?? {};
        if (m.collection === STAGING_COLLECTIONS.ITEMS) items.set(m.id, data);
        if (m.collection === STAGING_COLLECTIONS.HEALTH) health.set(m.id, data);
        if (m.collection === STAGING_COLLECTIONS.RUNS) runs.set(m.id, data);
      }
      return { operations: mutations.length, batches: Math.ceil(mutations.length / 400) };
    },
    close() {},
    _items: items,
    _health: health,
    _runs: runs,
    _commits: commits,
  };
}

const NOW = new Date("2026-10-17T06:00:00Z");

function makeNotice({ canonicalUrl = "https://jntuh.ac.in/uploads/notifications/a.pdf", title = "Fee notice" } = {}) {
  return {
    sourceId: "notifications",
    sourceName: "JNTUH Notifications",
    listingUrl: "https://jntuh.ac.in/notifications",
    category: "general",
    title,
    dateRaw: "15 Oct 2026",
    noticeDate: new Date("2026-10-15T00:00:00Z"),
    noticeHref: "a.pdf",
    sourceUrl: canonicalUrl,
    sourceUrlFallback: false,
    documentUrl: canonicalUrl,
    canonicalUrl,
    attachments: [],
    position: 1,
  };
}

/** A source result that yields one new notice, so a plan always has mutations. */
function okSource(id = "notifications") {
  return {
    id,
    name: "JNTUH Notifications",
    status: "ok",
    notices: [makeNotice()],
    duplicates: [],
    warnings: [],
    drafts: 1,
    draftProblems: 0,
    fingerprint: "fp1",
    error: null,
  };
}

/** Build a write-approved plan for one ok source, with an injected clock. */
function makePlan({ runId = "r1", now = () => NOW, dryRun = false, ...rest } = {}) {
  return planRun({
    sources: [okSource()],
    existingItems: new Map(),
    existingHealth: new Map(),
    runId,
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    dryRun,
    now,
    ...rest,
  });
}

test("planRun plans new items and health", () => {
  const store = makeStore();
  const sources = [{
    id: "notifications",
    name: "JNTUH Notifications",
    status: "ok",
    notices: [makeNotice()],
    duplicates: [],
    warnings: [],
    drafts: 1,
    draftProblems: 0,
    fingerprint: "fp1",
    error: null,
  }];
  const plan = planRun({
    sources,
    existingItems: new Map(),
    existingHealth: new Map(),
    runId: "r1",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    now: () => NOW,
  });
  assert.equal(plan.status, RUN_STATUS.OK);
  assert.ok(plan.mutations.length >= 2); // at least item + health
  const itemMut = plan.mutations.find(m => m.collection === STAGING_COLLECTIONS.ITEMS);
  const healthMut = plan.mutations.find(m => m.collection === STAGING_COLLECTIONS.HEALTH);
  assert.ok(itemMut);
  assert.ok(healthMut);
  assert.equal(itemMut.data.reviewState, "new");
  assert.equal(itemMut.data.seenCount, 1);
});

test("executeRun writes running then final, updates store", async () => {
  const store = makeStore();
  const sources = [{
    id: "notifications",
    status: "ok",
    notices: [makeNotice()],
    duplicates: [],
    warnings: [],
    drafts: 1,
    draftProblems: 0,
    fingerprint: "fp1",
    error: null,
  }];
  const plan = planRun({
    sources,
    existingItems: new Map(),
    existingHealth: new Map(),
    runId: "r1",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    dryRun: false,
    now: () => NOW,
  });
  const res = await executeRun({ plan, store, now: () => new Date("2026-10-17T06:05:00Z") });
  assert.equal(res.status, RUN_STATUS.OK);
  assert.ok(store._runs.has("r1"));
  const runDoc = store._runs.get("r1");
  assert.equal(runDoc.status, RUN_STATUS.OK);
  assert.ok(runDoc.finishedAt);
  assert.ok(store._items.size >= 1);
  assert.ok(store._health.has("notifications"));
});

test("idempotency guard skips items already applied to the same runId", async () => {
  const store = makeStore();
  const notice = makeNotice();
  const sources = [{
    id: "notifications",
    status: "ok",
    notices: [notice],
    duplicates: [],
    warnings: [],
    drafts: 1,
    draftProblems: 0,
    fingerprint: "fp1",
    error: null,
  }];
  const runId = "r1";
  const plan = planRun({
    sources,
    existingItems: new Map(),
    existingHealth: new Map(),
    runId,
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    dryRun: false,
    now: () => NOW,
  });
  await executeRun({ plan, store, now: () => NOW });
  const itemsBefore = store._items.size;
  const plan2 = planRun({
    sources,
    existingItems: store._items,
    existingHealth: store._health,
    runId,
    startedAt: new Date("2026-10-18T00:00:00Z"),
    projectId: "jntuh-notes-6ef74",
    dryRun: false,
    now: () => new Date("2026-10-18T00:00:00Z"),
  });
  assert.equal(plan2.counts.itemsSkipped, 1);
  assert.equal(plan2.mutations.length, 1); // only health update
  await executeRun({ plan: plan2, store, now: () => new Date("2026-10-18T00:05:00Z") });
  assert.equal(store._items.size, itemsBefore);
});

test("suspicious swing causes source to be skipped (isolated)", () => {
  const store = makeStore();
  // seed health with history
  store._health.set("exams", {
    lastNotices: 40,
    lastRunAt: new Date("2026-10-16T00:00:00Z"),
    lastRunId: "old",
    consecutiveFailures: 0,
  });
  const sources = [{
    id: "exams",
    status: "ok",
    notices: Array.from({ length: 612 }, (_, i) => makeNotice({ canonicalUrl: `https://exams1/a${i}.pdf` })),
    duplicates: [],
    warnings: [],
    drafts: 612,
    draftProblems: 0,
    fingerprint: "fp2",
    error: null,
  }];
  const plan = planRun({
    sources,
    existingItems: new Map(),
    existingHealth: store._health,
    runId: "r2",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    now: () => NOW,
  });
  assert.equal(plan.status, RUN_STATUS.PARTIAL);
  assert.equal(plan.counts.sourcesRefused, 1);
  const refused = plan.refusedSources.find(r => r.sourceId === "exams");
  assert.ok(refused);
  // only health mutation (no item mutations) for that source
  const itemMuts = plan.mutations.filter(m => m.collection === STAGING_COLLECTIONS.ITEMS);
  assert.equal(itemMuts.length, 0);
});

test("operation cap causes run to be refused", () => {
  const sources = [{
    id: "notifications",
    status: "ok",
    notices: Array.from({ length: 500 }, (_, i) => makeNotice({ canonicalUrl: `https://jntuh.ac.in/n${i}.pdf` })),
    duplicates: [],
    warnings: [],
    drafts: 500,
    draftProblems: 0,
    fingerprint: "fp3",
    error: null,
  }];
  const plan = planRun({
    sources,
    existingItems: new Map(),
    existingHealth: new Map(),
    runId: "r3",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    now: () => NOW,
    maxItems: 2000, // allow new items
    limits: { maxOperations: 100 }, // cap low
  });
  assert.equal(plan.refused, true);
  assert.equal(plan.status, RUN_STATUS.FAILED);
  assert.match(plan.refusalReason || "", /operation cap/);
});

// ---------------------------------------------------------------------------
// Clock evaluation and write-failure handling (Phase 2, Step 4 review fixes).
// ---------------------------------------------------------------------------

test("planRun evaluates the injected clock exactly once", () => {
  let calls = 0;
  const at = new Date("2026-10-17T06:30:00Z");
  const plan = makePlan({
    runId: "r-clock",
    now: () => {
      calls += 1;
      return at;
    },
  });

  assert.equal(calls, 1, "the clock must be read exactly once per run plan");
  assert.equal(plan.healthDocuments[0].data.lastRunAt.getTime(), at.getTime());
  assert.equal(plan.itemDocuments[0].firstSeenAt.getTime(), at.getTime());
  assert.equal(plan.itemDocuments[0].lastSeenAt.getTime(), at.getTime());
});

test("planRun accepts a Date clock and falls back when the clock is invalid", () => {
  const at = new Date("2026-10-17T06:31:00Z");
  const direct = makePlan({ runId: "r-date", now: at });
  assert.equal(direct.healthDocuments[0].data.lastRunAt.getTime(), at.getTime());

  let calls = 0;
  const before = Date.now();
  const fallback = makePlan({
    runId: "r-invalid",
    now: () => {
      calls += 1;
      return new Date("not-a-real-date");
    },
  });
  const after = Date.now();
  assert.equal(calls, 1, "an invalid clock must still be read only once");
  const fallbackAt = fallback.healthDocuments[0].data.lastRunAt.getTime();
  assert.ok(!Number.isNaN(fallbackAt));
  assert.ok(fallbackAt >= before && fallbackAt <= after, "an invalid clock must fall back to the current time");

  // A non-Date, non-function value must also fall back rather than crash.
  const scalar = makePlan({ runId: "r-scalar", now: "not a date" });
  assert.ok(scalar.healthDocuments[0].data.lastRunAt instanceof Date);
});

test("executeRun evaluates the injected clock exactly once and falls back when invalid", async () => {
  const store = makeStore();
  const at = new Date("2026-10-17T07:00:00Z");
  let calls = 0;
  const res = await executeRun({
    plan: makePlan({ runId: "r-clock-exec" }),
    store,
    now: () => {
      calls += 1;
      return at;
    },
  });
  assert.equal(calls, 1, "the clock must be read exactly once per execution");
  assert.equal(res.finalDoc.finishedAt.getTime(), at.getTime());

  const before = Date.now();
  const res2 = await executeRun({
    plan: makePlan({ runId: "r-clock-exec-bad" }),
    store: makeStore(),
    now: () => new Date("nonsense"),
  });
  const after = Date.now();
  const finished = res2.finalDoc.finishedAt;
  assert.ok(finished instanceof Date && !Number.isNaN(finished.getTime()));
  assert.ok(finished.getTime() >= before && finished.getTime() <= after);
});

test("executeRun propagates an initial running-write failure without claiming it was recorded", async () => {
  const failure = new Error("running write failed");
  const store = makeStore({ failOn: (call) => call === 0, failure });
  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-no-running" }), store, now: () => NOW }),
    (error) => error === failure,
  );
  assert.equal(store._runs.has("r-no-running"), false, "a run that never started is never recorded");
  assert.equal(store._commits.length, 1, "only the attempted running write is issued");
});

test("executeRun marks a run failed when item mutations fail, then rethrows the original error", async () => {
  const original = new Error("original mutation failure");
  original.code = "UNAVAILABLE";
  const store = makeStore({ failOn: (call) => call === 1, failure: original });

  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-mutation" }), store, now: () => NOW }),
    (error) => error === original,
  );

  const runDoc = store._runs.get("r-mutation");
  assert.ok(runDoc, "the run must still be recorded");
  assert.equal(runDoc.status, RUN_STATUS.FAILED);
  assert.equal(runDoc.error?.code, RUN_WRITE_FAILED);
  assert.equal(runDoc.error?.phase, "write");
  assert.match(runDoc.error?.message ?? "", /original mutation failure/);
  // No unsafe rollback of writes that already committed.
  assert.ok(!store._commits.flat().some((m) => m.delete), "no rollback mutations may be issued");
});

test("executeRun marks a run failed when the final status write fails", async () => {
  const boom = new Error("final status write failed");
  const store = makeStore({ failOn: (call) => call === 2, failure: boom });

  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-final" }), store, now: () => NOW }),
    (error) => error === boom,
  );

  const runDoc = store._runs.get("r-final");
  assert.equal(runDoc.status, RUN_STATUS.FAILED);
  assert.equal(runDoc.error?.code, RUN_WRITE_FAILED);
  assert.equal(runDoc.error?.phase, "write");
});

test("executeRun preserves the original error when recording the failure also fails", async () => {
  const original = new Error("original mutation failure");
  original.code = "DEADLINE_EXCEEDED";
  const secondary = new Error("failed-run write also failed");
  const store = makeStore({
    failOn: (call) => call === 1 || call === 2,
    failure: (call) => (call === 1 ? original : secondary),
  });

  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-double" }), store, now: () => NOW }),
    (error) => error === original,
  );

  // The `running` record landed, but the failure record could not be written;
  // never claim otherwise.
  const runDoc = store._runs.get("r-double");
  assert.equal(runDoc.status, RUN_STATUS.RUNNING);
});

// ---------------------------------------------------------------------------
// Dry-run protection: a read-only plan must never reach the store.
// ---------------------------------------------------------------------------

test("planRun still defaults to a dry-run plan and exposes the flag", () => {
  const plan = planRun({
    sources: [okSource()],
    existingItems: new Map(),
    existingHealth: new Map(),
    runId: "r-default-dry",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    now: () => NOW,
  });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.runDocument.dryRun, true);

  assert.equal(makePlan({ runId: "r-approved" }).dryRun, false);
  assert.equal(makePlan({ runId: "r-approved-2", dryRun: true }).dryRun, true);
});

test("a default (dry-run) plan is refused and causes zero commitMutations calls", async () => {
  const store = makeStore();
  const plan = planRun({
    sources: [okSource()],
    existingItems: new Map(),
    existingHealth: new Map(),
    runId: "r-default-exec",
    startedAt: NOW,
    projectId: "jntuh-notes-6ef74",
    now: () => NOW,
  });

  await assert.rejects(
    () => executeRun({ plan, store, now: () => NOW }),
    /dry-run plan/i,
  );
  assert.equal(store._commits.length, 0, "a dry-run plan must not touch the store");
  assert.equal(store._runs.size, 0);
  assert.equal(store._items.size, 0);
  assert.equal(store._health.size, 0);
});

test("a dry-run plan causes zero commitMutations calls with writeRunning true", async () => {
  const store = makeStore();
  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-dry-running", dryRun: true }), store, now: () => NOW, writeRunning: true }),
    /dry-run plan/i,
  );
  assert.equal(store._commits.length, 0, "no running record and no mutations may be written");
  assert.equal(store._runs.size, 0);
});

test("a dry-run plan causes zero commitMutations calls with writeRunning false", async () => {
  const store = makeStore();
  await assert.rejects(
    () => executeRun({ plan: makePlan({ runId: "r-dry-noop", dryRun: true }), store, now: () => NOW, writeRunning: false }),
    /dry-run plan/i,
  );
  assert.equal(store._commits.length, 0);
});

test("an explicitly approved write plan (dryRun false) still writes", async () => {
  const store = makeStore();
  const res = await executeRun({ plan: makePlan({ runId: "r-write-approved", dryRun: false }), store, now: () => NOW });
  assert.equal(res.status, RUN_STATUS.OK);
  assert.ok(store._commits.length >= 2, "the running record and the mutations are written");
  assert.ok(store._runs.has("r-write-approved"));
  assert.ok(store._items.size >= 1);
  assert.ok(store._health.has("notifications"));
});
