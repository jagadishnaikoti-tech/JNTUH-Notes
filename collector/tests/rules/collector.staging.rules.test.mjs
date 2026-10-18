// ---------------------------------------------------------------------------
// Automatic collection into staging: new notice, duplicate re-run, and an
// unavailable source - against the REAL Firestore emulator and the REAL
// firestore.rules.
//
// This is the scheduling phase's local proof (validation items 1-3):
//
//   1. a new notice is collected into `ingestItems`;
//   2. running again with the same notice creates no duplicate candidate, and a
//      notice a human already dismissed is never resurrected;
//   3. an unavailable source is reported accurately - as a failed run and a
//      degraded health record with a redacted error - not as a clean collection;
//   4. and staging never touches the public `alerts` collection.
//
// It drives the collector's real write path (planRun + executeRun through the
// allowlisted Admin SDK store) with in-memory notices, so it needs no network.
//
// The project id is a `demo-` id on purpose: firebase-tools refuses to talk to a
// real project for `demo-*` ids, so this suite can never touch live data.
//
// Run with `npm run test:rules` (wrapped in `firebase emulators:exec`).
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestoreSdk from "firebase/firestore";

import { INGEST_COLLECTIONS, REVIEW_STATE, ignoreIngestItem } from "../../../src/lib/ingest.js";
import { createIngestStore } from "../../lib/firestoreAdmin.mjs";
import { executeRun, itemIdsForSources, planRun } from "../../write.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const PROJECT_ID = "demo-jntuh-notes";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [host, portRaw] = EMULATOR_HOST.split(":");
const port = Number(portRaw);

const SOURCE_ID = "notifications";
const CANONICAL_A = "https://jntuh.ac.in/uploads/notifications/collector-staging-a.pdf";
const CANONICAL_B = "https://jntuh.ac.in/uploads/notifications/collector-staging-b.pdf";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host, port },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const collection of Object.values(INGEST_COLLECTIONS)) {
      const snap = await firestoreSdk.getDocs(firestoreSdk.collection(db, collection));
      assert.equal(snap.size, 0, `temporary ${collection} documents remain`);
    }
    const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
    assert.equal(alerts.size, 0, "temporary alerts documents remain");
  });
  await testEnv.cleanup();
});

function adminContext() {
  return testEnv.authenticatedContext("admin-1", { admin: true }).firestore();
}

const contextFor = (db) => ({ context: { db, sdk: firestoreSdk } });

/** The collector's allowlisted Admin SDK store, pointed at the emulator. */
function makeStore() {
  return createIngestStore({
    projectId: PROJECT_ID,
    emulator: true,
    allowedProjects: [PROJECT_ID],
    // Only the emulator host is supplied, so an ambient GOOGLE_CLOUD_PROJECT
    // cannot trip the collector's own project check.
    env: { FIRESTORE_EMULATOR_HOST: EMULATOR_HOST },
    quiet: true,
  });
}

const notice = (canonicalUrl, title) => ({
  sourceId: SOURCE_ID,
  sourceName: "JNTUH Notifications",
  title,
  category: "general",
  canonicalUrl,
  documentUrl: canonicalUrl,
  sourceUrl: canonicalUrl,
  sourceUrlFallback: false,
  noticeDate: null,
  attachments: [],
  pane: null,
});

const SOURCE_IDENTITY = { id: SOURCE_ID, name: "JNTUH Notifications" };

/** Two healthy notices from one source. */
const healthySource = () => ({
  ...SOURCE_IDENTITY,
  status: "ok",
  notices: [notice(CANONICAL_A, "Collector staging notice A"), notice(CANONICAL_B, "Collector staging notice B")],
  duplicates: [],
  warnings: [],
  drafts: 2,
  draftProblems: 0,
});

/** One source that could not be fetched, with a credential-ish error string. */
const failedSource = () => ({
  ...SOURCE_IDENTITY,
  status: "error",
  phase: "fetch",
  notices: [],
  duplicates: [],
  warnings: [],
  drafts: 0,
  draftProblems: 0,
  error:
    "HttpError: Request timed out after 15000ms: https://exams1.jntuh.ac.in/Portal/common/load " +
    "(key /secrets/firebase-adminsdk-abcde.json)",
});

/**
 * One collector pass, mirroring exactly what collector/index.mjs does before it
 * calls planRun: read the items it is about to touch, and this source's health.
 */
async function runCollector(store, sources, maxItems = 10) {
  const runId = `staging-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { ids } = itemIdsForSources(sources);
  const [existingItems, existingHealth] = await Promise.all([
    store.readItems(ids),
    store.readSourceHealth([SOURCE_ID]),
  ]);
  const plan = planRun({
    sources,
    existingItems,
    existingHealth,
    runId,
    startedAt: new Date(),
    trigger: "manual",
    actor: "collector-staging-test",
    dryRun: false,
    projectId: PROJECT_ID,
    maxItems,
  });
  assert.equal(plan.refused, false, "the staging plan must not be refused");
  await executeRun({ plan, store });
  return { runId, plan };
}

async function counts(db) {
  const items = await firestoreSdk.getDocs(firestoreSdk.collection(db, INGEST_COLLECTIONS.ITEMS));
  const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
  return { items: items.size, alerts: alerts.size };
}

describe("scheduled collection stages notices, de-duplicates, and reports failures honestly", () => {
  it("collects a new notice into staging without creating an alert", async () => {
    const store = makeStore();
    try {
      const { runId, plan } = await runCollector(store, [healthySource()]);
      const db = adminContext();

      assert.equal(plan.counts.itemsCreated, 2, "both unknown notices are created");
      assert.equal(plan.counts.sourcesOk, 1);
      assert.equal(plan.status, "ok");

      const staged = await firestoreSdk.getDocs(firestoreSdk.collection(db, INGEST_COLLECTIONS.ITEMS));
      assert.equal(staged.size, 2);
      for (const doc of staged.docs) {
        const data = doc.data();
        assert.equal(data.reviewState, REVIEW_STATE.NEW);
        assert.equal(data.lastRunId, runId);
        assert.equal(data.sourceId, SOURCE_ID);
        assert.ok(data.canonicalUrl, "the canonical source URL is recorded, never invented");
        assert.equal(data.noticeDate, null, "a missing date is stored as null, never fabricated");
        assert.equal(data.status, undefined, "a staged item is not an alert record");
      }

      const run = await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.RUNS, runId));
      assert.equal(run.exists(), true);
      assert.equal(run.data().status, "ok");

      const health = await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.HEALTH, SOURCE_ID));
      assert.equal(health.data().status, "ok");
      assert.equal(health.data().consecutiveFailures, 0);

      assert.equal((await counts(db)).alerts, 0, "collection staging never creates an alert");
    } finally {
      await store.close();
    }
  });

  it("re-running with the same notices creates no duplicate candidate and never resurrects a dismissed one", async () => {
    const store = makeStore();
    try {
      await runCollector(store, [healthySource()]);
      const db = adminContext();

      const first = await firestoreSdk.getDocs(firestoreSdk.collection(db, INGEST_COLLECTIONS.ITEMS));
      const idsBefore = first.docs.map((d) => d.id).sort();
      assert.equal(idsBefore.length, 2);

      // An administrator dismisses one of them.
      await ignoreIngestItem({ itemId: idsBefore[0] }, contextFor(db));

      // A second run sees exactly the same notices (a retry, or the source
      // being polled again before anything changed).
      const second = await runCollector(store, [healthySource()]);
      assert.equal(second.plan.counts.itemsCreated, 0, "a retry creates no new candidates");
      assert.equal(second.plan.counts.itemsRefreshed, 2);
      assert.ok(second.plan.counts.itemsSkipped >= 0);

      const after = await firestoreSdk.getDocs(firestoreSdk.collection(db, INGEST_COLLECTIONS.ITEMS));
      assert.deepEqual(after.docs.map((d) => d.id).sort(), idsBefore, "the item ids did not change");

      const refreshed = await firestoreSdk.getDoc(
        firestoreSdk.doc(db, INGEST_COLLECTIONS.ITEMS, idsBefore[0])
      );
      assert.equal(refreshed.data().reviewState, REVIEW_STATE.IGNORED, "a dismissed notice stays dismissed");
      assert.equal(refreshed.data().seenCount, 2);

      const queued = await firestoreSdk.getDoc(
        firestoreSdk.doc(db, INGEST_COLLECTIONS.ITEMS, idsBefore[1])
      );
      assert.equal(queued.data().reviewState, REVIEW_STATE.NEW, "the untouched notice is still in review");
      assert.equal((await counts(db)).alerts, 0);
    } finally {
      await store.close();
    }
  });

  it("reports an unavailable source as a failed run and degraded health, never as a success", async () => {
    const store = makeStore();
    try {
      const { runId, plan } = await runCollector(store, [failedSource()]);
      const db = adminContext();

      assert.equal(plan.status, "failed", "the run is failed when the only source failed");
      assert.equal(plan.counts.sourcesFailed, 1);
      assert.equal(plan.counts.itemsCreated, 0, "an unavailable source stages nothing");

      const run = await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.RUNS, runId));
      assert.equal(run.data().status, "failed");

      const health = await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.HEALTH, SOURCE_ID));
      assert.equal(health.data().status, "degraded", "fewer than three failures in a row is degraded");
      assert.equal(health.data().lastOutcome, "failed");
      assert.equal(health.data().consecutiveFailures, 1);
      assert.equal(health.data().totalFailures, 1);
      assert.ok(health.data().lastError?.message, "the failure reason is recorded");
      assert.ok(
        !health.data().lastError.message.includes("firebase-adminsdk"),
        "a credential-like path in an error is redacted before it is stored"
      );

      assert.equal((await counts(db)).items, 0, "no candidate is invented for an unavailable source");
      assert.equal((await counts(db)).alerts, 0);
    } finally {
      await store.close();
    }
  });
});
