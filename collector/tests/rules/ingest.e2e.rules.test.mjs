// ---------------------------------------------------------------------------
// End-to-end ingestion -> admin review -> promotion, against the REAL Firestore
// emulator, the REAL two-project layout and both real rulesets.
//
// It drives the whole local workflow with synthetic data only:
//
//   1. stage  : the collector's real write path (planRun + executeRun through the
//               allowlisted Admin SDK store) writes one `ingestItems` document
//               into the `jntuh-notes-staging` project;
//   2. review : the admin client (src/lib/ingest.js) retrieves it from staging,
//               ignores it and returns it to the queue;
//   3. promote: promotion creates exactly one unverified DRAFT alert in the
//               production project, and a repeat adds no second alert;
//   4. safety : nothing is auto-published, no draft is publicly readable, and no
//               staging collection ever appears in the production project.
//
// The project ids are `demo-` ids on purpose: firebase-tools refuses to talk to
// a real project for `demo-*` ids, so this suite can never touch live data.
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

import {
  INGEST_COLLECTIONS,
  REVIEW_STATE,
  fetchIngestItems,
  ignoreIngestItem,
  promoteIngestItem,
  returnIngestItemToReview,
} from "../../../src/lib/ingest.js";
import { createIngestStore } from "../../lib/firestoreAdmin.mjs";
import { executeRun, itemIdsForSources, planRun } from "../../write.mjs";
import {
  DEFAULT_DATABASE,
  STAGING_PROJECT,
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

const STAGING = { projectId: STAGING_PROJECT, databaseId: DEFAULT_DATABASE, host, port };
const DEFAULTS = { projectId: PROJECT_ID, databaseId: DEFAULT_DATABASE, host, port };

const ADMIN_ACTOR = "admin@jntuh.example";

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
  // Prove the emulator holds no temporary test documents before shutdown.
  for (const collection of Object.values(INGEST_COLLECTIONS)) {
    assert.equal(await staging.count(collection), 0, `temporary ${collection} documents remain`);
  }
  assert.equal(await staging.count("alerts"), 0, "temporary staging alerts remain");
  assert.equal(await defaults.count("alerts"), 0, "temporary alerts documents remain");
  await Promise.all([staging.cleanup(), defaults.cleanup()]);
});

/** The admin ingest context: staging `db`, production `alertsDb`. */
const contextFor = (db = staging.admin, alertsDb = defaults.admin) => ({
  context: { db, alertsDb, sdk: firestoreSdk },
});

/** The collector's allowlisted Admin SDK store, pointed at the emulator. */
function makeStore() {
  return createIngestStore({
    projectId: STAGING_PROJECT,
    emulator: true,
    allowedProjects: [STAGING_PROJECT],
    // Only the emulator host is supplied so the collector's own project check
    // cannot be tripped by an ambient GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT.
    env: { FIRESTORE_EMULATOR_HOST: EMULATOR_HOST },
    quiet: true,
  });
}

const SOURCE_ID = "notifications";
const CANONICAL_URL = "https://jntuh.ac.in/uploads/notifications/e2e-fee-notice.pdf";

const NOTICE = {
  sourceId: SOURCE_ID,
  sourceName: "JNTUH Notifications",
  title: "E2E synthetic fee notification",
  category: "general",
  canonicalUrl: CANONICAL_URL,
  documentUrl: CANONICAL_URL,
  sourceUrl: CANONICAL_URL,
  sourceUrlFallback: false,
  noticeDate: null,
  attachments: [],
  pane: null,
};

const SOURCE_RESULT = {
  id: SOURCE_ID,
  name: "JNTUH Notifications",
  status: "ok",
  notices: [NOTICE],
  duplicates: [],
  warnings: [],
  drafts: 1,
  draftProblems: 0,
};

const PROMOTION_INPUT = {
  title: "E2E synthetic fee notification",
  summary: "Synthetic notice staged by the end-to-end review test.",
  category: "general",
  sourceName: "JNTUH Notifications",
  sourceUrl: CANONICAL_URL,
  publishedAt: "",
  deadlineAt: "",
  audience: [],
  tags: [],
  pinned: false,
};

/**
 * Stage one synthetic notice through the collector's real write path, mirroring
 * how collector/index.mjs reads existing state before planning a run.
 */
async function stageNotice(store) {
  const runId = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { ids } = itemIdsForSources([SOURCE_RESULT]);
  const existingItems = await store.readItems(ids);
  const existingHealth = await store.readSourceHealth([SOURCE_ID]);
  const plan = planRun({
    sources: [SOURCE_RESULT],
    existingItems,
    existingHealth,
    runId,
    startedAt: new Date(),
    trigger: "manual",
    actor: "e2e-test",
    dryRun: false,
    projectId: STAGING_PROJECT,
    databaseId: store.databaseId,
    maxItems: 10,
  });
  assert.equal(plan.refused, false, "the staging plan must not be refused");
  assert.equal(plan.itemDocuments.length, 1, "exactly one notice is staged");
  await executeRun({ plan, store });
  return { runId, itemId: [...ids][0] };
}

/** The review state of a staged item, read from the STAGING project. */
async function reviewStateOf(itemId) {
  const data = await staging.get([INGEST_COLLECTIONS.ITEMS, itemId]);
  return data?.reviewState;
}

describe("collector staging -> admin review -> promotion (real rules, two projects, emulator only)", () => {
  it("stages a notice in staging, reviews it, and promotes exactly one private unverified draft into production", async () => {
    const store = makeStore();
    try {
      const { itemId, runId } = await stageNotice(store);

      // The collector wrote the item plus its run/health audit documents, all
      // in the staging project.
      const stagedItem = await staging.get([INGEST_COLLECTIONS.ITEMS, itemId]);
      assert.ok(stagedItem, "the synthetic notice was staged");
      assert.equal(stagedItem.reviewState, REVIEW_STATE.NEW);
      assert.equal(stagedItem.lastRunId, runId);
      assert.ok(await staging.get([INGEST_COLLECTIONS.RUNS, runId]), "the collector run document was written");
      assert.ok(await staging.get([INGEST_COLLECTIONS.HEALTH, SOURCE_ID]), "the source-health document was written");

      // Staging must never create an alert - in staging or in production.
      assert.equal(await staging.count("alerts"), 0, "staging never creates an alert in staging");
      assert.equal(await defaults.count("alerts"), 0, "staging never creates an alert in production");
      // ...and no staging collection may appear in the production project.
      assert.equal(await defaults.count(INGEST_COLLECTIONS.ITEMS), 0);
      assert.equal(await defaults.count(INGEST_COLLECTIONS.RUNS), 0);
      assert.equal(await defaults.count(INGEST_COLLECTIONS.HEALTH), 0);

      // Admin review can retrieve the staged notice from staging.
      const listing = await fetchIngestItems({ pageSize: 25 }, contextFor());
      assert.equal(listing.items.length, 1);
      assert.equal(listing.items[0].id, itemId);
      assert.equal(listing.items[0].reviewState, REVIEW_STATE.NEW);

      // Ignore it, then return it to the queue.
      await ignoreIngestItem({ itemId }, contextFor());
      assert.equal(await reviewStateOf(itemId), REVIEW_STATE.IGNORED);

      await returnIngestItemToReview({ itemId }, contextFor());
      assert.equal(await reviewStateOf(itemId), REVIEW_STATE.NEW);

      // Promote -> exactly one draft, in production, linked from the staging item.
      const first = await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor()
      );
      assert.equal(first.created, true);
      assert.ok(first.alertId, "an alert id is returned");

      // Promote again -> same alert, no duplicate.
      const second = await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor()
      );
      assert.equal(second.created, false);
      assert.equal(second.alertId, first.alertId);

      assert.equal(await defaults.count("alerts"), 1, "promotion created exactly one alert, in production");
      assert.equal(await staging.count("alerts"), 0, "the alert was not written to staging");

      const alertData = await defaults.get(["alerts", first.alertId]);
      assert.equal(alertData.status, "draft", "promotion creates a draft, never a published alert");
      assert.equal(alertData.verifiedAt, null);
      assert.equal(alertData.verifiedBy, "");

      // The item now carries the promotion metadata, in staging.
      const itemData = await staging.get([INGEST_COLLECTIONS.ITEMS, itemId]);
      assert.equal(itemData.reviewState, REVIEW_STATE.PROMOTED);
      assert.equal(itemData.promotedAlertId, first.alertId);

      // No automatic publication: anonymous visitors see nothing.
      await assert.rejects(
        firestoreSdk.getDoc(firestoreSdk.doc(defaults.anon, "alerts", first.alertId))
      );
      const published = await firestoreSdk.getDocs(
        firestoreSdk.query(
          firestoreSdk.collection(defaults.anon, "alerts"),
          firestoreSdk.where("status", "==", "published")
        )
      );
      assert.equal(published.size, 0, "no alert was automatically published");
    } finally {
      await store.close();
    }
  });

  it("keeps a promoted notice out of the review queue", async () => {
    const store = makeStore();
    try {
      const { itemId } = await stageNotice(store);

      await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor()
      );

      // The one-way state machine: a promoted notice can never be returned.
      await assert.rejects(returnIngestItemToReview({ itemId }, contextFor()));
    } finally {
      await store.close();
    }
  });
});
