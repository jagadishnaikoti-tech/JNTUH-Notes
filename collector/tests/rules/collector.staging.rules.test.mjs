// ---------------------------------------------------------------------------
// Automatic collection into the STAGING DATABASE: new notice, duplicate re-run,
// and an unavailable source - against the REAL Firestore emulator, the REAL
// firestore.staging.rules, and the REAL two-database layout.
//
// This is the scheduling phase's local proof (validation items 1-3):
//
//   1. a new notice is collected into `ingestItems` in the `staging` database;
//   2. running again with the same notice creates no duplicate candidate, and a
//      notice a human already dismissed is never resurrected;
//   3. an unavailable source is reported accurately - as a failed run and a
//      degraded health record with a redacted error - not as a clean collection;
//   4. and staging never touches the public `alerts` collection, in either
//      database.
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

import * as firestoreSdk from "firebase/firestore";

import { INGEST_COLLECTIONS, REVIEW_STATE, ignoreIngestItem } from "../../../src/lib/ingest.js";
import { createIngestStore } from "../../lib/firestoreAdmin.mjs";
import { executeRun, itemIdsForSources, planRun } from "../../write.mjs";
import {
  DEFAULT_DATABASE,
  STAGING_DATABASE,
  clearDatabase,
  emulatorEndpoint,
  loadRules,
  makeDbEnv,
} from "./emulatorDb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STAGING_RULES = readFileSync(path.join(ROOT, "firestore.staging.rules"), "utf8");
const PUBLIC_RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const PROJECT_ID = "demo-jntuh-notes";
const { host, port } = emulatorEndpoint();
const EMULATOR_HOST = `${host}:${port}`;

const STAGING = { projectId: PROJECT_ID, databaseId: STAGING_DATABASE, host, port };
const DEFAULTS = { projectId: PROJECT_ID, databaseId: DEFAULT_DATABASE, host, port };

const SOURCE_ID = "notifications";
const CANONICAL_A = "https://jntuh.ac.in/uploads/notifications/collector-staging-a.pdf";
const CANONICAL_B = "https://jntuh.ac.in/uploads/notifications/collector-staging-b.pdf";

let staging;
let defaults;

before(async () => {
  await loadRules({ ...STAGING, rules: STAGING_RULES });
  await loadRules({ ...DEFAULTS, rules: PUBLIC_RULES });
  staging = makeDbEnv(STAGING);
  defaults = makeDbEnv(DEFAULTS);
});

beforeEach(async () => {
  await clearDatabase(STAGING);
  await clearDatabase(DEFAULTS);
});

afterEach(async () => {
  await clearDatabase(STAGING);
  await clearDatabase(DEFAULTS);
});

after(async () => {
  // The test must not leave debris behind in either database.
  for (const env of [staging, defaults]) {
    for (const collection of Object.values(INGEST_COLLECTIONS)) {
      assert.equal(await env.count(collection), 0, `temporary ${collection} documents remain`);
    }
  }
  assert.equal(await staging.count("alerts"), 0, "temporary staging alerts remain");
  assert.equal(await defaults.count("alerts"), 0, "temporary public alerts remain");
  await Promise.all([staging.cleanup(), defaults.cleanup()]);
});

/** The admin client, on the staging database, with the admin claim. */
const adminContext = () => staging.admin;

/** An injected context: staging `db`, public `alertsDb`. */
const contextFor = (db) => ({ context: { db, alertsDb: defaults.admin, sdk: firestoreSdk } });

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
    databaseId: store.databaseId,
    maxItems,
  });
  assert.equal(plan.refused, false, "the staging plan must not be refused");
  await executeRun({ plan, store });
  return { runId, plan };
}

describe("the collector's store is pinned to the staging database", () => {
  it("reports staging as its database and echoes it into the run document", async () => {
    const store = makeStore();
    try {
      assert.equal(store.databaseId, STAGING_DATABASE);
      const { runId } = await runCollector(store, [healthySource()]);
      const run = await staging.get([INGEST_COLLECTIONS.RUNS, runId]);
      assert.equal(run.databaseId, STAGING_DATABASE, "the audit trail records the database it wrote to");
      assert.equal(run.projectId, PROJECT_ID);
    } finally {
      await store.close();
    }
  });
});

describe("scheduled collection stages notices, de-duplicates, and reports failures honestly", () => {
  it("collects a new notice into staging without creating an alert", async () => {
    const store = makeStore();
    try {
      const { runId, plan } = await runCollector(store, [healthySource()]);

      assert.equal(plan.counts.itemsCreated, 2, "both unknown notices are created");
      assert.equal(plan.counts.sourcesOk, 1);
      assert.equal(plan.status, "ok");

      const staged = await staging.docs(INGEST_COLLECTIONS.ITEMS);
      assert.equal(staged.length, 2);
      for (const { data } of staged) {
        assert.equal(data.reviewState, REVIEW_STATE.NEW);
        assert.equal(data.lastRunId, runId);
        assert.equal(data.sourceId, SOURCE_ID);
        assert.ok(data.canonicalUrl, "the canonical source URL is recorded, never invented");
        assert.equal(data.noticeDate, null, "a missing date is stored as null, never fabricated");
        assert.equal(data.status, undefined, "a staged item is not an alert record");
      }

      const run = await staging.get([INGEST_COLLECTIONS.RUNS, runId]);
      assert.equal(run.status, "ok");

      const health = await staging.get([INGEST_COLLECTIONS.HEALTH, SOURCE_ID]);
      assert.equal(health.status, "ok");
      assert.equal(health.consecutiveFailures, 0);

      assert.equal(await staging.count("alerts"), 0, "collection staging never creates an alert in staging");
      // Nothing leaked into the public database, under any name.
      assert.equal(await defaults.count(INGEST_COLLECTIONS.ITEMS), 0);
      assert.equal(await defaults.count(INGEST_COLLECTIONS.RUNS), 0);
      assert.equal(await defaults.count(INGEST_COLLECTIONS.HEALTH), 0);
      assert.equal(await defaults.count("alerts"), 0);
    } finally {
      await store.close();
    }
  });

  it("re-running with the same notices creates no duplicate candidate and never resurrects a dismissed one", async () => {
    const store = makeStore();
    try {
      await runCollector(store, [healthySource()]);

      const first = await staging.docs(INGEST_COLLECTIONS.ITEMS);
      const idsBefore = first.map((d) => d.id).sort();
      assert.equal(idsBefore.length, 2);

      // An administrator dismisses one of them, through the rules, in staging.
      await ignoreIngestItem({ itemId: idsBefore[0] }, contextFor(adminContext()));

      // A second run sees exactly the same notices (a retry, or the source
      // being polled again before anything changed).
      const second = await runCollector(store, [healthySource()]);
      assert.equal(second.plan.counts.itemsCreated, 0, "a retry creates no new candidates");
      assert.equal(second.plan.counts.itemsRefreshed, 2);
      assert.ok(second.plan.counts.itemsSkipped >= 0);

      const afterIds = (await staging.docs(INGEST_COLLECTIONS.ITEMS)).map((d) => d.id).sort();
      assert.deepEqual(afterIds, idsBefore, "the item ids did not change");

      const refreshed = await staging.get([INGEST_COLLECTIONS.ITEMS, idsBefore[0]]);
      assert.equal(refreshed.reviewState, REVIEW_STATE.IGNORED, "a dismissed notice stays dismissed");
      assert.equal(refreshed.seenCount, 2);

      const queued = await staging.get([INGEST_COLLECTIONS.ITEMS, idsBefore[1]]);
      assert.equal(queued.reviewState, REVIEW_STATE.NEW, "the untouched notice is still in review");
      assert.equal(await staging.count("alerts"), 0);
      assert.equal(await defaults.count(INGEST_COLLECTIONS.ITEMS), 0);
    } finally {
      await store.close();
    }
  });

  it("reports an unavailable source as a failed run and degraded health, never as a success", async () => {
    const store = makeStore();
    try {
      const { runId, plan } = await runCollector(store, [failedSource()]);

      assert.equal(plan.status, "failed", "the run is failed when the only source failed");
      assert.equal(plan.counts.sourcesFailed, 1);
      assert.equal(plan.counts.itemsCreated, 0, "an unavailable source stages nothing");

      const run = await staging.get([INGEST_COLLECTIONS.RUNS, runId]);
      assert.equal(run.status, "failed");

      const health = await staging.get([INGEST_COLLECTIONS.HEALTH, SOURCE_ID]);
      assert.equal(health.status, "degraded", "fewer than three failures in a row is degraded");
      assert.equal(health.lastOutcome, "failed");
      assert.equal(health.consecutiveFailures, 1);
      assert.equal(health.totalFailures, 1);
      assert.ok(health.lastError?.message, "the failure reason is recorded");
      assert.ok(
        !health.lastError.message.includes("firebase-adminsdk"),
        "a credential-like path in an error is redacted before it is stored"
      );

      assert.equal(await staging.count(INGEST_COLLECTIONS.ITEMS), 0, "no candidate is invented for an unavailable source");
      assert.equal(await staging.count("alerts"), 0);
      assert.equal(await defaults.count("alerts"), 0);
    } finally {
      await store.close();
    }
  });
});
