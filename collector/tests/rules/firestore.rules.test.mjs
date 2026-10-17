// ---------------------------------------------------------------------------
// Firestore security-rules tests for the Phase 2 staging collections.
//
// These run against the Firebase Emulator Suite, never against production. The
// project id is a `demo-` id on purpose: firebase-tools refuses to talk to a
// real project for `demo-*` ids, so this suite can never touch the live
// database even by accident.
//
// Run with:
//   npm run test:rules
// which wraps this file in `firebase emulators:exec --only firestore`.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const PROJECT_ID = "demo-jntuh-notes";

/** Firestore emulator host/port, taken from the environment firebase-tools sets. */
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

/** An anonymous visitor. */
function anon() {
  return testEnv.unauthenticatedContext().firestore();
}

/** A signed-in user WITHOUT the admin claim. */
function nonAdmin() {
  return testEnv.authenticatedContext("student-1", { admin: false }).firestore();
}

/** A signed-in administrator (custom claim `admin == true`). */
function admin() {
  return testEnv.authenticatedContext("admin-1", { admin: true }).firestore();
}

/** Seed a document bypassing the rules (this is what the collector does). */
async function seed(pathSegments, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...pathSegments), data);
  });
}

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
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(getDoc(doc(anon(), ...ITEM_PATH)));
  });

  it("authenticated non-admins cannot read ingestItems", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(getDoc(doc(nonAdmin(), ...ITEM_PATH)));
  });

  it("admins can read ingestItems", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(getDoc(doc(admin(), ...ITEM_PATH)));
  });

  it("anonymous and non-admin users cannot read ingestRuns", async () => {
    await seed(RUN_PATH, RUN_DOC);
    await assertFails(getDoc(doc(anon(), ...RUN_PATH)));
    await assertFails(getDoc(doc(nonAdmin(), ...RUN_PATH)));
  });

  it("admins can read ingestRuns", async () => {
    await seed(RUN_PATH, RUN_DOC);
    await assertSucceeds(getDoc(doc(admin(), ...RUN_PATH)));
  });

  it("anonymous and non-admin users cannot read ingestSourceHealth", async () => {
    await seed(HEALTH_PATH, HEALTH_DOC);
    await assertFails(getDoc(doc(anon(), ...HEALTH_PATH)));
    await assertFails(getDoc(doc(nonAdmin(), ...HEALTH_PATH)));
  });

  it("admins can read ingestSourceHealth", async () => {
    await seed(HEALTH_PATH, HEALTH_DOC);
    await assertSucceeds(getDoc(doc(admin(), ...HEALTH_PATH)));
  });
});

describe("ingestItems: creation is collector-only", () => {
  it("admins cannot create an ingestion item from client code", async () => {
    await assertFails(setDoc(doc(admin(), "ingestItems", "new-item"), ITEM_DOC));
  });

  it("anonymous users cannot create an ingestion item", async () => {
    await assertFails(setDoc(doc(anon(), "ingestItems", "new-item"), ITEM_DOC));
  });
});

describe("ingestItems: review-state updates", () => {
  it("admins can move an item to ignored", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(updateDoc(doc(admin(), ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("admins can promote an item with complete metadata", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertSucceeds(
      updateDoc(doc(admin(), ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "alert-9",
        promotedAt: new Date(),
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("promoting without metadata is rejected", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { reviewState: "promoted" }));
  });

  it("promoting with a malformed alert id is rejected", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(admin(), ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "",
        promotedAt: new Date(),
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("promoting with a non-timestamp promotedAt is rejected", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(admin(), ...ITEM_PATH), {
        reviewState: "promoted",
        promotedAlertId: "alert-9",
        promotedAt: "2026-10-17",
        promotedBy: "admin@jntuh.example",
      }),
    );
  });

  it("an unknown review state is rejected", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { reviewState: "archived" }));
  });

  it("admins cannot change protected notice fields", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { title: "Rewritten" }));
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { canonicalUrl: "https://evil.example/x" }));
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { contentHash: "deadbeef" }));
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { sourceId: "exams" }));
    await assertFails(updateDoc(doc(admin(), ...ITEM_PATH), { firstSeenAt: new Date() }));
  });

  it("a review update that also smuggles a protected field is rejected", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(
      updateDoc(doc(admin(), ...ITEM_PATH), { reviewState: "ignored", title: "Rewritten" }),
    );
  });

  it("non-admins cannot update an item", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(nonAdmin(), ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("anonymous users cannot update an item", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(updateDoc(doc(anon(), ...ITEM_PATH), { reviewState: "ignored" }));
  });

  it("admins cannot delete an item", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(deleteDoc(doc(admin(), ...ITEM_PATH)));
  });

  it("non-admins cannot delete an item", async () => {
    await seed(ITEM_PATH, ITEM_DOC);
    await assertFails(deleteDoc(doc(nonAdmin(), ...ITEM_PATH)));
  });
});

describe("ingestRuns and ingestSourceHealth are read-only to clients", () => {
  for (const [label, pathSegments, data] of [
    ["ingestRuns", RUN_PATH, RUN_DOC],
    ["ingestSourceHealth", HEALTH_PATH, HEALTH_DOC],
  ]) {
    it(`admins cannot create/update/delete ${label}`, async () => {
      await seed(pathSegments, data);
      await assertFails(setDoc(doc(admin(), label, "brand-new"), data));
      await assertFails(updateDoc(doc(admin(), ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(admin(), ...pathSegments)));
    });

    it(`non-admins cannot write ${label}`, async () => {
      await seed(pathSegments, data);
      await assertFails(setDoc(doc(nonAdmin(), label, "brand-new"), data));
      await assertFails(updateDoc(doc(nonAdmin(), ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(nonAdmin(), ...pathSegments)));
    });

    it(`anonymous users cannot write ${label}`, async () => {
      await seed(pathSegments, data);
      await assertFails(setDoc(doc(anon(), label, "brand-new"), data));
      await assertFails(updateDoc(doc(anon(), ...pathSegments), { status: "failed" }));
      await assertFails(deleteDoc(doc(anon(), ...pathSegments)));
    });
  }
});

// ---------------------------------------------------------------------------
// Existing alert behaviour must be untouched by the staging rules.
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

const DRAFT_ALERT = { ...PUBLISHED_ALERT, status: "draft", verifiedAt: null, verifiedBy: "" };

describe("existing alert rules are preserved", () => {
  it("published alerts remain publicly readable", async () => {
    await seed(["alerts", "pub-1"], PUBLISHED_ALERT);
    await assertSucceeds(getDoc(doc(anon(), "alerts", "pub-1")));
  });

  it("draft alerts remain restricted", async () => {
    await seed(["alerts", "draft-1"], DRAFT_ALERT);
    await assertFails(getDoc(doc(anon(), "alerts", "draft-1")));
    await assertFails(getDoc(doc(nonAdmin(), "alerts", "draft-1")));
  });

  it("publishing without verification metadata is denied", async () => {
    // Drop the verification fields entirely; a published alert must carry them.
    const { verifiedAt, verifiedBy, ...unverified } = PUBLISHED_ALERT;
    await assertFails(setDoc(doc(admin(), "alerts", "u-1"), unverified));
  });

  it("a verified publish by an admin still succeeds", async () => {
    await assertSucceeds(setDoc(doc(admin(), "alerts", "ok-1"), PUBLISHED_ALERT));
  });
});

describe("unrelated collections stay closed", () => {
  it("anonymous users cannot write an unrelated collection", async () => {
    await assertFails(setDoc(doc(anon(), "someoneElsesData", "x"), { hello: "world" }));
  });

  it("admins cannot write an unrelated, unruled collection", async () => {
    await assertFails(setDoc(doc(admin(), "someoneElsesData", "x"), { hello: "world" }));
  });
});
