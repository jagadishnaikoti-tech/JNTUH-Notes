// ---------------------------------------------------------------------------
// End-to-end ingestion -> admin review -> promotion, against the REAL Firestore
// emulator and the REAL firestore.rules.
//
// It drives the whole local workflow with synthetic data only:
//
//   1. stage  : the collector's real write path (planRun + executeRun through the
//               allowlisted Admin SDK store) writes one `ingestItems` document;
//   2. review : the admin client (src/lib/ingest.js) retrieves it, ignores it and
//               returns it to the queue;
//   3. promote: promotion creates exactly one unverified DRAFT alert, and a
//               repeat promotion adds no second alert;
//   4. safety : staging never touches `alerts`, nothing is published and no draft
//               is publicly readable.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const PROJECT_ID = "demo-jntuh-notes";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [host, portRaw] = EMULATOR_HOST.split(":");
const port = Number(portRaw);

const ADMIN_ACTOR = "admin@jntuh.example";

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
  // Remove every synthetic document this suite may have created.
  await testEnv.clearFirestore();
});

after(async () => {
  // Prove the emulator holds no temporary test documents before shutdown.
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
    projectId: PROJECT_ID,
    maxItems: 10,
  });
  assert.equal(plan.refused, false, "the staging plan must not be refused");
  assert.equal(plan.itemDocuments.length, 1, "exactly one notice is staged");
  await executeRun({ plan, store });
  return { runId, itemId: [...ids][0] };
}

async function reviewStateOf(db, itemId) {
  const snap = await firestoreSdk.getDoc(
    firestoreSdk.doc(db, INGEST_COLLECTIONS.ITEMS, itemId)
  );
  return snap.data().reviewState;
}

describe("collector staging -> admin review -> promotion (real rules, emulator only)", () => {
  it("stages a notice, reviews it, and promotes exactly one private unverified draft", async () => {
    const store = makeStore();
    try {
      const { itemId, runId } = await stageNotice(store);
      const db = adminContext();

      // The collector wrote the item plus its run/health audit documents.
      const stagedItem = await firestoreSdk.getDoc(
        firestoreSdk.doc(db, INGEST_COLLECTIONS.ITEMS, itemId)
      );
      assert.equal(stagedItem.exists(), true, "the synthetic notice was staged");
      assert.equal(stagedItem.data().reviewState, REVIEW_STATE.NEW);
      assert.equal(stagedItem.data().lastRunId, runId);
      assert.equal(
        (await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.RUNS, runId))).exists(),
        true,
        "the collector run document was written"
      );
      assert.equal(
        (await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.HEALTH, SOURCE_ID))).exists(),
        true,
        "the source-health document was written"
      );

      // Staging must never create an alert.
      const alertsAfterStaging = await firestoreSdk.getDocs(
        firestoreSdk.collection(db, "alerts")
      );
      assert.equal(alertsAfterStaging.size, 0, "staging never creates an alert");

      // Admin review can retrieve the staged notice.
      const listing = await fetchIngestItems({ pageSize: 25 }, contextFor(db));
      assert.equal(listing.items.length, 1);
      assert.equal(listing.items[0].id, itemId);
      assert.equal(listing.items[0].reviewState, REVIEW_STATE.NEW);

      // Ignore it, then return it to the queue.
      await ignoreIngestItem({ itemId }, contextFor(db));
      assert.equal(await reviewStateOf(db, itemId), REVIEW_STATE.IGNORED);

      await returnIngestItemToReview({ itemId }, contextFor(db));
      assert.equal(await reviewStateOf(db, itemId), REVIEW_STATE.NEW);

      // Promote -> exactly one draft, linked to the item.
      const first = await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor(db)
      );
      assert.equal(first.created, true);
      assert.ok(first.alertId, "an alert id is returned");

      // Promote again -> same alert, no duplicate.
      const second = await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor(db)
      );
      assert.equal(second.created, false);
      assert.equal(second.alertId, first.alertId);

      const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
      assert.equal(alerts.size, 1, "promotion created exactly one alert");

      const alertData = (
        await firestoreSdk.getDoc(firestoreSdk.doc(db, "alerts", first.alertId))
      ).data();
      assert.equal(alertData.status, "draft", "promotion creates a draft, never a published alert");
      assert.equal(alertData.verifiedAt, null);
      assert.equal(alertData.verifiedBy, "");

      // The item now carries the promotion metadata.
      const itemData = (
        await firestoreSdk.getDoc(firestoreSdk.doc(db, INGEST_COLLECTIONS.ITEMS, itemId))
      ).data();
      assert.equal(itemData.reviewState, REVIEW_STATE.PROMOTED);
      assert.equal(itemData.promotedAlertId, first.alertId);

      // No automatic publication: anonymous visitors see nothing.
      const anonDb = testEnv.unauthenticatedContext().firestore();
      await assert.rejects(
        firestoreSdk.getDoc(firestoreSdk.doc(anonDb, "alerts", first.alertId))
      );
      const published = await firestoreSdk.getDocs(
        firestoreSdk.query(
          firestoreSdk.collection(anonDb, "alerts"),
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
      const db = adminContext();

      await promoteIngestItem(
        { itemId, input: PROMOTION_INPUT, actor: ADMIN_ACTOR },
        contextFor(db)
      );

      // The one-way state machine: a promoted notice can never be returned.
      await assert.rejects(returnIngestItemToReview({ itemId }, contextFor(db)));
    } finally {
      await store.close();
    }
  });
});
