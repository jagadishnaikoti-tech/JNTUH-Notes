// ---------------------------------------------------------------------------
// Firestore security-rules tests for the PRODUCTION project's `(default)`
// database (firestore.rules).
//
// `(default)` holds alerts, analyticsEvents, channels, settings and users. The
// collector's staging collections live in the separate `jntuh-notes-staging`
// project with their own ruleset, `firestore.staging.rules` - this file proves
// they are ABSENT here and therefore denied to every client, including an
// admin. The staging rules themselves are covered by ./staging.rules.test.mjs.
//
// These run against the Firebase Emulator Suite, never against production. The
// project id is a `demo-` id on purpose: firebase-tools refuses to talk to a
// real project for `demo-*` ids, so this suite can never touch live data.
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

// ---------------------------------------------------------------------------
// The staging collections must NOT work in the production project.
//
// They were removed from firestore.rules when staging moved to its own project.
// Because the ruleset no longer mentions them, Firestore's default-deny applies:
// an anonymous visitor, a signed-in non-admin AND an administrator are all
// refused. That is deliberate - a client that forgets the separate staging
// project fails loudly here instead of silently reading or writing staging data
// in production.
// ---------------------------------------------------------------------------

describe("staging collections are absent from the production project", () => {
  for (const [label, pathSegments, data] of [
    ["ingestItems", ITEM_PATH, ITEM_DOC],
    ["ingestRuns", RUN_PATH, RUN_DOC],
    ["ingestSourceHealth", HEALTH_PATH, HEALTH_DOC],
  ]) {
    it(`denies every client access to ${label} in production`, async () => {
      // Seed through the Admin SDK, exactly like the collector would if it
      // were (wrongly) pointed at the production project.
      await seed(pathSegments, data);

      // Nobody may read it here...
      await assertFails(getDoc(doc(anon(), ...pathSegments)));
      await assertFails(getDoc(doc(nonAdmin(), ...pathSegments)));
      await assertFails(getDoc(doc(admin(), ...pathSegments)));

      // ...and even an administrator may not write it here.
      await assertFails(setDoc(doc(admin(), label, "brand-new"), data));
      await assertFails(updateDoc(doc(admin(), ...pathSegments), { reviewState: "ignored" }));
      await assertFails(deleteDoc(doc(admin(), ...pathSegments)));
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
