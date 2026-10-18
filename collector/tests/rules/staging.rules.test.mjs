// ---------------------------------------------------------------------------
// Security-rules tests for the STAGING database (firestore.staging.rules).
//
// The collector stages notices into the named `staging` database, and an
// administrator reviews them at /admin/ingest. This suite proves:
//   * the staging collections are invisible to everyone but an admin;
//   * the collector (Admin SDK) is the only creator of an item;
//   * an admin may only move an item through the review state machine and can
//     never change a notice-derived field;
//   * runs and source-health are read-only to every client;
//   * the public `alerts` collection does not exist in this database and is not
//     reachable through this ruleset, even by an admin.
//
// The rules are loaded into the emulator's `staging` database (see
// ./emulatorDb.mjs for the named-database caveat). The project id is a `demo-`
// id, so firebase-tools can never touch a real project.
//
// Run with:  npm run test:rules
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import {
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
const BASE = { projectId: PROJECT_ID, databaseId: STAGING_DATABASE, host, port };

let env;

before(async () => {
  // Staging rules where staging data lives; the public rules where the public
  // data lives, so a stray write to the wrong database is denied as well.
  await loadRules({ ...BASE, rules: STAGING_RULES });
  await loadRules({ projectId: PROJECT_ID, databaseId: "(default)", host, port, rules: PUBLIC_RULES });
  env = makeDbEnv(BASE);
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await clearDatabase(BASE);
});

const ITEM_PATH = ["ingestItems", "item-1"];
const ITEM_DOC = {
  itemId: "item-1",
  sourceId: "notifications",
  sourceName: "JNTUH Notifications",
  title: "Fee notification",
  category: "general",
  canonicalUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  documentUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  sourceUrlFallback: false,
  noticeDate: null,
  attachments: [],
  pane: null,
  contentHash: "abc123",
  firstSeenAt: new Date("2026-10-17T00:00:00Z"),
  lastSeenAt: new Date("2026-10-17T00:00:00Z"),
  lastRunId: "run-1",
  seenCount: 1,
  reviewState: "new",
};

const RUN_PATH = ["ingestRuns", "run-1"];
const RUN_DOC = { runId: "run-1", status: "ok", dryRun: false, startedAt: new Date() };

const HEALTH_PATH = ["ingestSourceHealth", "notifications"];
const HEALTH_DOC = { sourceId: "notifications", status: "ok", consecutiveFailures: 0 };

describe("staging collections are invisible to everyone but admins", () => {
  it("anonymous users cannot read ingestItems", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(getDoc(doc(env.anon, ...ITEM_PATH)));
  });

  it("authenticated non-admins cannot read ingestItems", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(getDoc(doc(env.nonAdmin, ...ITEM_PATH)));
  });

  it("admins can read ingestItems", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(getDoc(doc(env.admin, ...ITEM_PATH)));
  });

  it("anonymous and non-admin users cannot read ingestRuns", async () => {
    await env.seed(RUN_PATH, RUN_DOC);
    await assertFails(getDoc(doc(env.anon, ...RUN_PATH)));
    await assertFails(getDoc(doc(env.nonAdmin, ...RUN_PATH)));
  });

  it("admins can read ingestRuns", async () => {
    await env.seed(RUN_PATH, RUN_DOC);
    await assertSucceeds(getDoc(doc(env.admin, ...RUN_PATH)));
  });

  it("anonymous and non-admin users cannot read ingestSourceHealth", async () => {
    await env.seed(HEALTH_PATH, HEALTH_DOC);
    await assertFails(getDoc(doc(env.anon, ...HEALTH_PATH)));
    await assertFails(getDoc(doc(env.nonAdmin, ...HEALTH_PATH)));
  });

  it("admins can read ingestSourceHealth", async () => {
    await env.seed(HEALTH_PATH, HEALTH_DOC);
    await assertSucceeds(getDoc(doc(env.admin, ...HEALTH_PATH)));
  });
});

describe("ingestItems: creation is collector-only", () => {
  it("admins cannot create an ingestion item from client code", async () => {
    await assertFails(setDoc(doc(env.admin, "ingestItems", "new-item"), ITEM_DOC));
  });

  it("anonymous users cannot create an ingestion item", async () => {
    await assertFails(setDoc(doc(env.anon, "ingestItems", "new-item"), ITEM_DOC));
  });
});

describe("ingestItems: review-state updates", () => {
  it("admins can move an item to ignored", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(updateDoc(doc(env.admin, ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("admins can promote an item with complete metadata", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(
      updateDoc(doc(env.admin, ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "alert-9",
        promotedAt: new Date(),
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("promoting without metadata is rejected", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { reviewState: "promoted" }));
  });

  it("promoting with a malformed alert id is rejected", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(env.admin, ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "",
        promotedAt: new Date(),
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("promoting with a non-timestamp promotedAt is rejected", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(env.admin, ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "alert-9",
        promotedAt: "2026-10-17",
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("an unknown review state is rejected", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { reviewState: "archived" }));
  });

  it("admins cannot change protected notice fields", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { title: "Rewritten" }));
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { canonicalUrl: "https://evil.example/x" }));
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { contentHash: "deadbeef" }));
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { sourceId: "exams" }));
    await assertFails(updateDoc(doc(env.admin, ...ITEM_PATH), { firstSeenAt: new Date() }));
  });

  it("a review update that also smuggles a protected field is rejected", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(env.admin, ...ITEM_PATH), { reviewState: "ignored", title: "Rewritten" }),
    );
  });

  it("non-admins cannot update an item", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(env.nonAdmin, ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("anonymous users cannot update an item", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(env.anon, ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("admins cannot delete an item", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(deleteDoc(doc(env.admin, ...ITEM_PATH)));
  });

  it("non-admins cannot delete an item", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    await assertFails(deleteDoc(doc(env.nonAdmin, ...ITEM_PATH)));
  });
});

describe("ingestRuns and ingestSourceHealth are read-only to clients", () => {
  for (const [label, pathSegments, data] of [
    ["ingestRuns", RUN_PATH, RUN_DOC],
    ["ingestSourceHealth", HEALTH_PATH, HEALTH_DOC],
  ]) {
    it(`admins cannot create/update/delete ${label}`, async () => {
      await env.seed(pathSegments, data);
      await assertFails(setDoc(doc(env.admin, label, "brand-new"), data));
      await assertFails(updateDoc(doc(env.admin, ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(env.admin, ...pathSegments)));
    });

    it(`non-admins cannot write ${label}`, async () => {
      await env.seed(pathSegments, data);
      await assertFails(setDoc(doc(env.nonAdmin, label, "brand-new"), data));
      await assertFails(updateDoc(doc(env.nonAdmin, ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(env.nonAdmin, ...pathSegments)));
    });

    it(`anonymous users cannot write ${label}`, async () => {
      await env.seed(pathSegments, data);
      await assertFails(setDoc(doc(env.anon, label, "brand-new"), data));
      await assertFails(updateDoc(doc(env.anon, ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(env.anon, ...pathSegments)));
    });
  }
});

// ---------------------------------------------------------------------------
// The public alert collection must NOT exist in the staging database. The rules
// there say nothing about `alerts`, so it is denied by default - even to an
// admin. This is the rules-layer half of "the collector cannot reach alerts".
// ---------------------------------------------------------------------------

const PUBLISHED_ALERT = {
  title: "B.Tech II-I Regular Examinations",
  summary: "Timetable released.",
  category: "exams",
  sourceName: "JNTUH",
  sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  status: "published",
  pinned: false,
  verifiedAt: new Date("2026-10-01T00:00:00Z"),
  verifiedBy: "admin@jntuh.example",
  createdBy: "admin@jntuh.example",
  updatedBy: "admin@jntuh.example",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  schemaVersion: 1,
};

describe("the staging database cannot reach the public alerts collection", () => {
  it("an admin cannot read or write alerts in the staging database", async () => {
    // Seed through the Admin SDK in staging (what an attacker with the
    // collector credential could do), then show no client can read it.
    await env.seed(["alerts", "leaked-1"], PUBLISHED_ALERT);
    await assertFails(getDoc(doc(env.admin, "alerts", "leaked-1")));
    await assertFails(getDoc(doc(env.anon, "alerts", "leaked-1")));
    await assertFails(setDoc(doc(env.admin, "alerts", "new-1"), PUBLISHED_ALERT));
  });

  it("unrelated collections stay closed in the staging database", async () => {
    await assertFails(setDoc(doc(env.admin, "someoneElsesData", "x"), { hello: "world" }));
    await assertFails(setDoc(doc(env.anon, "someoneElsesData", "x"), { hello: "world" }));
  });
});

// ---------------------------------------------------------------------------
// A guard against the most likely mistake: querying staging through the wrong
// database. The staging collections must resolve here, and the (default)
// database must deny them (proven in firestore.rules.test.mjs).
// ---------------------------------------------------------------------------

describe("the staging collections resolve in the staging database", () => {
  it("an admin can read and list ingestItems", async () => {
    await env.seed(ITEM_PATH, ITEM_DOC);
    const snap = await getDoc(doc(env.admin, ...ITEM_PATH));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().reviewState, "new");
  });
});
