import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  BROKEN_AFTER_FAILURES,
  INTENDED_PROJECT_ID,
  MAX_BATCH_SIZE,
  RUN_STATUS,
  SOURCE_OUTCOME,
  SOURCE_STATUS,
  STAGING_COLLECTION_NAMES,
  alreadyApplied,
  buildRunDocument,
  chunkOperations,
  computeRunStatus,
  emptyCounts,
  isStagingCollection,
  isSuspiciousSwing,
  nextSourceHealth,
  sanitiseActor,
  sanitiseError,
} from "../lib/runReport.mjs";

test("chunkOperations splits into batches of at most MAX_BATCH_SIZE", () => {
  const items = Array.from({ length: 123 }, (_, i) => i);
  const batches = chunkOperations(items);
  assert.equal(batches.length, Math.ceil(123 / MAX_BATCH_SIZE));
  const merged = batches.flat();
  assert.deepEqual(merged, items);

  const small = chunkOperations([1, 2, 3, 4, 5], 2);
  assert.deepEqual(small, [[1, 2], [3, 4], [5]]);
});

test("chunkOperations validates size", () => {
  assert.throws(() => chunkOperations([], 0));
  assert.throws(() => chunkOperations([], -1));
  assert.throws(() => chunkOperations([], MAX_BATCH_SIZE + 1));
});

test("isStagingCollection only accepts the three staging collections", () => {
  for (const name of STAGING_COLLECTION_NAMES) assert.ok(isStagingCollection(name));
  assert.ok(!isStagingCollection("alerts"));
  assert.ok(!isStagingCollection("users"));
  assert.ok(!isStagingCollection("ingestitems"));
});

test("INTENDED_PROJECT_ID is set", () => {
  assert.ok(INTENDED_PROJECT_ID);
});

test("alreadyApplied detects re-use of the same runId", () => {
  assert.equal(alreadyApplied({ lastRunId: "run-1" }, "run-1"), true);
  assert.equal(alreadyApplied({ lastRunId: "run-2" }, "run-1"), false);
  assert.equal(alreadyApplied(null, "run-1"), false);
  assert.equal(alreadyApplied({}, ""), false);
});

test("sanitiseActor caps and trims", () => {
  assert.equal(sanitiseActor("  alice@jntuh.example  "), "alice@jntuh.example");
  const long = "x".repeat(500);
  assert.equal(sanitiseActor(long).length, 200);
  assert.equal(sanitiseActor(null), "");
});

test("sanitiseError redacts secrets and caps length", () => {
  const raw = `Request failed: https://example.com/project/jntuh-notes-6ef74-firebase-adminsdk-fbsvc-abc123.json\nPRIVATE KEY-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...\n-----END PRIVATE KEY-----\nBearer eyJhbGciOiJSUzI1NiIsImtpZCI6abc\n"private_key": "-----BEGIN PRIVATE KEY-----ABC\n",\nclient_email: svc@proj.iam.gserviceaccount.com\nblob ${"A".repeat(80)}`;
  const clean = sanitiseError(new Error(raw));
  assert.ok(clean);
  assert.ok(clean.message.includes("[redacted-keyfile]") || clean.message.includes("[redacted"));
  assert.ok(!/MIIEvQ/.test(clean.message));
  assert.ok(!/eyJhbGci/.test(clean.message));
  assert.ok(!/firebase-adminsdk/.test(clean.message));
  assert.ok(clean.message.length <= 300);
});

test("computeRunStatus maps outcomes", () => {
  assert.equal(computeRunStatus(["ok", "ok"]), RUN_STATUS.OK);
  assert.equal(computeRunStatus(["ok", "degraded"]), RUN_STATUS.PARTIAL);
  assert.equal(computeRunStatus(["failed", "failed"]), RUN_STATUS.FAILED);
  assert.equal(computeRunStatus(["failed", "ok"]), RUN_STATUS.PARTIAL);
  assert.equal(computeRunStatus(["ok", "skipped"]), RUN_STATUS.PARTIAL);
  assert.equal(computeRunStatus([]), RUN_STATUS.FAILED);
});

test("isSuspiciousSwing flags large jumps only with history", () => {
  const limits = { swingFactor: 5, swingFloor: 50, swingMinHistory: 10 };
  assert.ok(isSuspiciousSwing(40, 612, limits));
  assert.equal(isSuspiciousSwing(5, 612, limits), false);
  assert.equal(isSuspiciousSwing(40, 120, limits), false);
  assert.equal(isSuspiciousSwing(40, 40, limits), false);
  assert.equal(isSuspiciousSwing(40, 49, limits), false);
});

test("nextSourceHealth counts consecutive failures and resets on success", () => {
  const at = new Date("2026-10-17T12:00:00Z");
  const first = nextSourceHealth(undefined, { status: SOURCE_OUTCOME.FAILED, notices: 3 }, { sourceId: "exams", runId: "r1", at });
  assert.equal(first.status, SOURCE_STATUS.DEGRADED);
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(first.lastOutcome, SOURCE_OUTCOME.FAILED);

  const second = nextSourceHealth(first, { status: SOURCE_OUTCOME.FAILED, notices: 3 }, { sourceId: "exams", runId: "r2", at: new Date("2026-10-18T12:00:00Z") });
  assert.equal(second.consecutiveFailures, 2);
  assert.equal(second.status, SOURCE_STATUS.DEGRADED);

  const third = nextSourceHealth(second, { status: SOURCE_OUTCOME.FAILED, notices: 3 }, { sourceId: "exams", runId: "r3", at: new Date("2026-10-19T12:00:00Z") });
  assert.equal(third.consecutiveFailures, 3);
  assert.equal(third.status, SOURCE_STATUS.BROKEN);

  const recovered = nextSourceHealth(third, { status: SOURCE_OUTCOME.OK, notices: 5 }, { sourceId: "exams", runId: "r4", at: new Date("2026-10-20T12:00:00Z") });
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.status, SOURCE_STATUS.OK);
  assert.equal(recovered.lastOutcome, SOURCE_OUTCOME.OK);
});

test("nextSourceHealth marks skipped as degraded without counting failure", () => {
  const at = new Date("2026-10-17T12:00:00Z");
  const h = nextSourceHealth(undefined, { status: SOURCE_OUTCOME.SKIPPED, notices: 612 }, { sourceId: "exams", runId: "r1", at });
  assert.equal(h.status, SOURCE_STATUS.DEGRADED);
  assert.equal(h.consecutiveFailures, 0);
  assert.equal(h.lastOutcome, SOURCE_OUTCOME.SKIPPED);
});

test("buildRunDocument produces a valid start and final document", () => {
  const started = new Date("2026-10-17T12:00:00Z");
  const startedDoc = buildRunDocument({
    runId: "r1",
    status: RUN_STATUS.RUNNING,
    startedAt: started,
    projectId: INTENDED_PROJECT_ID,
    mode: "write",
  });
  assert.equal(startedDoc.status, RUN_STATUS.RUNNING);
  assert.equal(startedDoc.finishedAt, null);
  assert.equal(startedDoc.durationMs, null);
  assert.deepEqual(startedDoc.counts, emptyCounts());

  const finished = new Date("2026-10-17T12:05:00Z");
  const finalDoc = buildRunDocument({
    runId: "r1",
    status: RUN_STATUS.OK,
    startedAt: started,
    finishedAt: finished,
    projectId: INTENDED_PROJECT_ID,
    mode: "write",
    sources: [{ sourceId: "exams", outcome: SOURCE_OUTCOME.OK }],
    counts: { ...emptyCounts(), operations: 5, batches: 1 },
  });
  assert.equal(finalDoc.status, RUN_STATUS.OK);
  assert.equal(finalDoc.finishedAt, finished);
  assert.equal(finalDoc.durationMs, 5 * 60 * 1000);
});
