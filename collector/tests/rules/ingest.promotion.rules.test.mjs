// ---------------------------------------------------------------------------
// Integration tests for promotion (src/lib/ingest.js) against the REAL Firestore
// emulator, the REAL two-database layout and BOTH real rulesets.
//
// Promotion crosses databases: the staged notice lives in the `staging`
// database (firestore.staging.rules) and the draft alert it creates lives in
// `(default)` (firestore.rules). These tests prove what the mocked unit tests
// cannot:
//   * the alert draft is accepted by `validAlert` in (default);
//   * the staged-item claim is accepted by the review-field-only rule in staging;
//   * the two steps are idempotent: a repeat, and a race, still produce exactly
//     one alert;
//   * nothing is ever published and the public cannot read the draft;
//   * upstream failures leave both documents as they were.
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

import * as firestoreSdk from "firebase/firestore";

import { promoteIngestItem, promotionAlertId } from "../../../src/lib/ingest.js";
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

const STAGING = { projectId: PROJECT_ID, databaseId: STAGING_DATABASE, host, port };
const DEFAULTS = { projectId: PROJECT_ID, databaseId: DEFAULT_DATABASE, host, port };

let staging;
let defaults;

before(async () => {
  await loadRules({ ...STAGING, rules: STAGING_RULES });
  await loadRules({ ...DEFAULTS, rules: PUBLIC_RULES });
  staging = makeDbEnv(STAGING);
  defaults = makeDbEnv(DEFAULTS);
});

after(async () => {
  await Promise.all([staging.cleanup(), defaults.cleanup()]);
});

beforeEach(async () => {
  await clearDatabase(STAGING);
  await clearDatabase(DEFAULTS);
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

/**
 * An injected context that mirrors production: the ingest client reads/writes
 * `db` (staging) and the promotion creates the alert through `alertsDb`
 * ((default)). Both are rules-enforced clients.
 */
const contextFor = (db, alertsDb) => ({ context: { db, alertsDb, sdk: firestoreSdk } });
const adminContext = () => contextFor(staging.admin, defaults.admin);
const nonAdminContext = () => contextFor(staging.nonAdmin, defaults.nonAdmin);

/** Read the alert from the PUBLIC database, as an admin. */
const readAlert = (id) => defaults.get(["alerts", id]);
/** Read a staged item from the STAGING database, as an admin. */
const readItem = (id) => staging.get(["ingestItems", id]);

const ADMIN = { actor: "admin@jntuh.example" };

describe("promotion under the real rules is atomic and idempotent across databases", () => {
  it("creates exactly one private draft in (default) and records the promotion on the staging item", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      adminContext()
    );

    assert.equal(result.created, true);
    assert.equal(result.alertId, promotionAlertId(ITEM_ID), "the id is derived from the notice");

    // The alert draft exists in the PUBLIC database and passes validAlert().
    const alertData = await readAlert(result.alertId);
    assert.ok(alertData, "the draft was written to (default)");
    assert.equal(alertData.status, "draft");
    assert.equal(alertData.verifiedAt, null);
    assert.equal(alertData.verifiedBy, "");
    assert.equal(alertData.title, VALID_INPUT.title);
    assert.equal(alertData.summary, VALID_INPUT.summary);
    assert.equal(alertData.createdBy, ADMIN.actor);

    // The staged item is linked to the new draft, in the STAGING database.
    const itemData = await readItem(ITEM_ID);
    assert.equal(itemData.reviewState, "promoted");
    assert.equal(itemData.promotedAlertId, result.alertId);
    assert.equal(itemData.promotedBy, ADMIN.actor);
    assert.ok(itemData.promotedAt, "promotedAt was written as a server timestamp");

    // The alert never landed in staging, and no staging collection leaked into
    // the public database.
    assert.equal(await staging.count("alerts"), 0);
    assert.equal(await defaults.count("ingestItems"), 0);
  });

  it("does not expose the promoted draft to anonymous visitors", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);
    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      adminContext()
    );

    // A draft must never be publicly readable - there is no auto-publish.
    await assert.rejects(
      firestoreSdk.getDoc(firestoreSdk.doc(defaults.anon, "alerts", result.alertId))
    );
  });

  it("returns the same alert id on a repeated promotion and creates no second alert", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    const first = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      adminContext()
    );
    const second = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      adminContext()
    );

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.alertId, first.alertId);

    assert.equal(await defaults.count("alerts"), 1, "no second alert was created");
  });

  it("creates exactly one alert when two promotions race", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    const [a, b] = await Promise.all([
      promoteIngestItem({ itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN }, adminContext()),
      promoteIngestItem({ itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN }, adminContext()),
    ]);

    assert.equal(a.alertId, b.alertId, "both callers agree on the single alert");
    assert.equal(await defaults.count("alerts"), 1, "exactly one alert document exists");
    assert.equal([a.created, b.created].filter(Boolean).length, 1);

    const itemData = await readItem(ITEM_ID);
    assert.equal(itemData.reviewState, "promoted");
    assert.equal(itemData.promotedAlertId, a.alertId);
  });

  it("heals a half-finished promotion: the draft exists but the item was never claimed", async () => {
    // Simulate a failure between step 4 (create draft) and step 5 (claim item):
    // the alert exists with the deterministic id, the item is untouched.
    const alertId = promotionAlertId(ITEM_ID);
    await defaults.seed(["alerts", alertId], {
      title: "Fee notification for II semester",
      summary: "Already created by the interrupted attempt.",
      category: "general",
      sourceName: "JNTUH Notifications",
      sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
      status: "draft",
      pinned: false,
      verifiedAt: null,
      verifiedBy: "",
      createdBy: "admin@jntuh.example",
      updatedBy: "admin@jntuh.example",
      createdAt: new Date("2026-10-17T00:00:00Z"),
      updatedAt: new Date("2026-10-17T00:00:00Z"),
      schemaVersion: 1,
    });
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, ...ADMIN },
      adminContext()
    );

    assert.equal(result.alertId, alertId);
    assert.equal(result.created, false, "the existing draft is never overwritten");
    assert.equal(await defaults.count("alerts"), 1, "the retry did not fork a second draft");
    // ...and the retry still finishes the job by claiming the item.
    const itemData = await readItem(ITEM_ID);
    assert.equal(itemData.reviewState, "promoted");
    assert.equal(itemData.promotedAlertId, alertId);
  });

  it("rejects a missing summary and leaves both documents untouched", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    await assert.rejects(
      promoteIngestItem(
        { itemId: ITEM_ID, input: { ...VALID_INPUT, summary: "" }, ...ADMIN },
        adminContext()
      ),
      /summary/i
    );

    assert.equal(await defaults.count("alerts"), 0);
    assert.equal((await readItem(ITEM_ID)).reviewState, "new");
  });

  it("cannot be performed by a non-admin (rules deny the staging read)", async () => {
    await staging.seed(["ingestItems", ITEM_ID], ITEM_DOC);

    await assert.rejects(
      promoteIngestItem(
        { itemId: ITEM_ID, input: VALID_INPUT, actor: "student@jntuh.example" },
        nonAdminContext()
      ),
      (err) => err.code === "permission-denied" || /permission/i.test(err.message)
    );

    assert.equal(await defaults.count("alerts"), 0);
    assert.equal((await readItem(ITEM_ID)).reviewState, "new");
  });

  it("fails clearly when the staged notice does not exist", async () => {
    await assert.rejects(
      promoteIngestItem(
        { itemId: "missing", input: VALID_INPUT, ...ADMIN },
        adminContext()
      ),
      (err) => err.code === "not-found" && /no longer exists/i.test(err.message)
    );
  });
});
