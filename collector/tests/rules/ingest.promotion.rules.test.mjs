// ---------------------------------------------------------------------------
// Integration tests for atomic promotion (src/lib/ingest.js) against the REAL
// Firestore emulator and the REAL firestore.rules.
//
// These prove what the mocked unit tests cannot: that the promotion transaction
// is accepted by the security rules (the alert draft passes `validAlert` and the
// staged-item update passes the review-field-only rule), that it is atomic and
// that it is idempotent even when two promotions race.
//
// The project id is a `demo-` id on purpose: firebase-tools refuses to talk to a
// real project for `demo-*` ids, so this suite can never touch live data.
//
// Run with `npm run test:rules` (wrapped in `firebase emulators:exec`).
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestoreSdk from "firebase/firestore";

import { promoteIngestItem } from "../../../src/lib/ingest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const PROJECT_ID = "demo-jntuh-notes";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [host, portRaw] = EMULATOR_HOST.split(":");
const port = Number(portRaw);

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host, port },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const ITEM_ID = "item-1";
const ITEM_DOC = {
  itemId: ITEM_ID,
  sourceId: "notifications",
  sourceName: "JNTUH Notifications",
  title: "Fee notification",
  category: "general",
  canonicalUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  documentUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  sourceUrl: null,
  sourceUrlFallback: false,
  attachments: [],
  pane: null,
  noticeDate: null,
  contentHash: "abc123",
  firstSeenAt: new Date("2026-10-17T00:00:00Z"),
  lastSeenAt: new Date("2026-10-17T00:00:00Z"),
  lastRunId: "run-1",
  seenCount: 1,
  reviewState: "new",
};

const VALID_INPUT = {
  title: "Fee notification for II semester",
  summary: "The university released a fee notification for II semester candidates.",
  category: "general",
  sourceName: "JNTUH Notifications",
  sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  publishedAt: "2026-10-01",
  deadlineAt: "",
  audience: [],
  tags: [],
  pinned: false,
};

/** Seed a document bypassing the rules (what the collector does via Admin SDK). */
async function seed(pathSegments, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await firestoreSdk.setDoc(firestoreSdk.doc(ctx.firestore(), ...pathSegments), data);
  });
}

/** An admin-authenticated Firestore instance wrapped as an ingest context. */
function adminContext() {
  return testEnv.authenticatedContext("admin-1", { admin: true }).firestore();
}
function nonAdminContext() {
  return testEnv.authenticatedContext("student-1", { admin: false }).firestore();
}
function anonContext() {
  return testEnv.unauthenticatedContext().firestore();
}
const contextFor = (db) => ({ context: { db, sdk: firestoreSdk } });

const ADMIN = { actor: "admin@jntuh.example" };

describe("promotion under the real rules is atomic and idempotent", () => {
  it("creates exactly one private draft and records the promotion on the item", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const db = adminContext();

    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      contextFor(db)
    );

    assert.equal(result.created, true);
    assert.ok(result.alertId, "an alert id is returned");

    // The alert draft exists and passes the rules' validAlert() gate.
    const alert = await firestoreSdk.getDoc(
      firestoreSdk.doc(db, "alerts", result.alertId)
    );
    assert.equal(alert.exists(), true);
    const alertData = alert.data();
    assert.equal(alertData.status, "draft");
    assert.equal(alertData.verifiedAt, null);
    assert.equal(alertData.verifiedBy, "");
    assert.equal(alertData.title, VALID_INPUT.title);
    assert.equal(alertData.summary, VALID_INPUT.summary);
    assert.equal(alertData.createdBy, ADMIN.actor);

    // The staged item is linked to the new draft.
    const item = await firestoreSdk.getDoc(
      firestoreSdk.doc(db, "ingestItems", ITEM_ID)
    );
    const itemData = item.data();
    assert.equal(itemData.reviewState, "promoted");
    assert.equal(itemData.promotedAlertId, result.alertId);
    assert.equal(itemData.promotedBy, ADMIN.actor);
    assert.ok(itemData.promotedAt, "promotedAt was written as a server timestamp");
  });

  it("does not expose the promoted draft to anonymous visitors", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      contextFor(adminContext())
    );

    // A draft must never be publicly readable - there is no auto-publish.
    await assert.rejects(
      firestoreSdk.getDoc(firestoreSdk.doc(anonContext(), "alerts", result.alertId))
    );
  });

  it("returns the same alert id on a repeated promotion and creates no second alert", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const db = adminContext();

    const first = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      contextFor(db)
    );
    const second = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      contextFor(db)
    );

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.alertId, first.alertId);

    const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
    assert.equal(alerts.size, 1, "no second alert was created");
  });

  it("creates exactly one alert when two promotions race", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const db = adminContext();

    const [a, b] = await Promise.all([
      promoteIngestItem({ itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN }, contextFor(db)),
      promoteIngestItem({ itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN }, contextFor(db)),
    ]);

    assert.equal(a.alertId, b.alertId, "both callers agree on the single alert");

    const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
    assert.equal(alerts.size, 1, "exactly one alert document exists");

    // Exactly one of the two calls did the creating.
    assert.equal([a.created, b.created].filter(Boolean).length, 1);
  });

  it("rejects a missing summary and leaves both documents untouched", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const db = adminContext();

    await assert.rejects(
      promoteIngestItem(
        { itemId: ITEM_ID, input: { ...VALID_INPUT, summary: "" }, ...ADMIN },
        contextFor(db)
      ),
      /summary/i
    );

    const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
    assert.equal(alerts.size, 0);

    const item = await firestoreSdk.getDoc(firestoreSdk.doc(db, "ingestItems", ITEM_ID));
    assert.equal(item.data().reviewState, "new");
  });

  it("cannot be performed by a non-admin (rules deny the transaction)", async () => {
    await seed(["ingestItems", ITEM_ID], ITEM_DOC);

    await assert.rejects(
      promoteIngestItem(
        { itemId: ITEM_ID, input: VALID_INPUT, actor: "student@jntuh.example" },
        contextFor(nonAdminContext())
      ),
      (err) => err.code === "permission-denied" || /permission/i.test(err.message)
    );

    const db = adminContext();
    const alerts = await firestoreSdk.getDocs(firestoreSdk.collection(db, "alerts"));
    assert.equal(alerts.size, 0);
    const item = await firestoreSdk.getDoc(firestoreSdk.doc(db, "ingestItems", ITEM_ID));
    assert.equal(item.data().reviewState, "new");
  });

  it("fails clearly when the staged notice does not exist", async () => {
    await assert.rejects(
      promoteIngestItem(
        { itemId: "missing", input: VALID_INPUT, ...ADMIN },
        contextFor(adminContext())
      ),
      (err) => err.code === "not-found" && /no longer exists/i.test(err.message)
    );
  });
});
