// ---------------------------------------------------------------------------
// Option B: separate-database isolation for the collector's staging data.
//
// The collector, the admin review UI and the rules must all agree that the
// ingest collections live in the named `staging` Firestore database, and that
// the public `(default)` database is unreachable for them. These tests are
// static (no emulator, no network): they pin the configuration and the code so a
// future edit cannot quietly re-merge the two databases or introduce a fallback.
//
// The behavioural proof lives in collector/tests/rules/*.test.mjs (emulator).
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_DATABASE_ID,
  STAGING_COLLECTIONS,
  STAGING_DATABASE_ID,
  resolveDatabaseId,
} from "../lib/runReport.mjs";
import { STAGING_DATABASE_ID as FRONTEND_STAGING_DATABASE_ID } from "../../src/lib/ingest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

const INGEST_COLLECTION_NAMES = Object.values(STAGING_COLLECTIONS);
const INGEST_IDENTIFIERS = ["ingestItems", "ingestRuns", "ingestSourceHealth"];

test("the collector and the admin UI agree on the staging database id", () => {
  assert.equal(STAGING_DATABASE_ID, "staging");
  assert.equal(FRONTEND_STAGING_DATABASE_ID, STAGING_DATABASE_ID);
  assert.equal(DEFAULT_DATABASE_ID, "(default)");
  assert.notEqual(STAGING_DATABASE_ID, DEFAULT_DATABASE_ID);
});

test("resolveDatabaseId accepts only the staging database", () => {
  assert.equal(resolveDatabaseId(), STAGING_DATABASE_ID);
  assert.equal(resolveDatabaseId("staging"), STAGING_DATABASE_ID);
  // Surrounding whitespace from an environment variable is tolerated.
  assert.equal(resolveDatabaseId("  staging  "), STAGING_DATABASE_ID);
  for (const unsafe of [
    "(default)",
    "default",
    "",
    "   ",
    null,
    "prod",
    "Staging",
    "staging-2",
    "staging.x",
  ]) {
    assert.throws(
      () => resolveDatabaseId(unsafe),
      /database/i,
      `expected ${JSON.stringify(unsafe)} to be refused`,
    );
  }
});

test("firebase.json deploys the staging rules to the staging database only", () => {
  const config = readJson("firebase.json");
  assert.ok(Array.isArray(config.firestore), "the firestore config is a list of databases");
  assert.equal(config.firestore.length, 2);

  const byDatabase = new Map(config.firestore.map((entry) => [entry.database, entry]));
  assert.deepEqual([...byDatabase.keys()].sort(), ["(default)", "staging"]);

  assert.equal(byDatabase.get("(default)").rules, "firestore.rules");
  assert.equal(byDatabase.get("(default)").indexes, "firestore.indexes.json");
  assert.equal(byDatabase.get("staging").rules, "firestore.staging.rules");
  assert.equal(byDatabase.get("staging").indexes, "firestore.staging.indexes.json");

  for (const entry of config.firestore) {
    assert.ok(existsSync(path.join(ROOT, entry.rules)), `${entry.rules} exists`);
    assert.ok(existsSync(path.join(ROOT, entry.indexes)), `${entry.indexes} exists`);
  }
});

test("the emulator e2e config stays single-database (documented limitation)", () => {
  // firebase-tools' CLI warns that the Firestore emulator does not support
  // multiple databases and would load NO rules for a multi-entry list, so the
  // e2e config keeps one entry and the rules tests load each database's rules
  // explicitly (collector/tests/rules/emulatorDb.mjs).
  const config = readJson("firebase.e2e.json");
  assert.ok(!Array.isArray(config.firestore), "firebase.e2e.json keeps a single firestore entry");
  assert.equal(config.firestore.rules, "firestore.rules");
});

test("the staging rules own the ingest collections and deny alerts", () => {
  const stagingRules = read("firestore.staging.rules");

  // It defines the admin gate the ingest rules depend on.
  assert.match(stagingRules, /function isAdmin\(\)/);

  // It grants the ingest collections by name.
  for (const name of INGEST_IDENTIFIERS) {
    assert.match(stagingRules, new RegExp(`match\\s+/${name}/`), `${name} is matched`);
  }

  // The public alerts collection must NOT be reachable here.
  assert.ok(
    !/match\s+\/alerts\//.test(stagingRules),
    "firestore.staging.rules must not grant access to `alerts`",
  );
  // ...nor any other public collection.
  for (const name of ["analyticsEvents", "channels", "settings", "users"]) {
    assert.ok(
      !new RegExp(`match\\s+/${name}/`).test(stagingRules),
      `firestore.staging.rules must not grant access to ${name}`,
    );
  }
});

test("the public rules no longer mention the ingest collections", () => {
  const publicRules = read("firestore.rules");
  for (const name of INGEST_IDENTIFIERS) {
    assert.ok(
      !new RegExp(`match\\s+/${name}/`).test(publicRules),
      `firestore.rules must not grant access to ${name} (default-deny is the boundary)`,
    );
  }
  // The public rules must not import staging-only helper functions either.
  assert.ok(!/function validPromotion/.test(publicRules));
  assert.ok(!/function validReviewUpdate/.test(publicRules));
  // ...while the public safety net for alerts stays intact.
  assert.match(publicRules, /function validAlert\(/);
  assert.match(publicRules, /match \/alerts\//);
});

test("every staging collection name is a real ingest collection", () => {
  assert.deepEqual([...INGEST_COLLECTION_NAMES].sort(), [...INGEST_IDENTIFIERS].sort());
});

test("the collector's store always passes an explicit database id", () => {
  const source = read("collector/lib/firestoreAdmin.mjs");
  // It must resolve and validate the id...
  assert.match(source, /resolveDatabaseId\(databaseId\)/);
  // ...and hand it to getFirestore. A bare getFirestore(app) would target
  // `(default)` and is the exact mistake this design forbids.
  assert.match(source, /getFirestore\(firebaseApp,\s*resolvedDatabaseId\)/);
  assert.ok(
    !/getFirestore\(\s*firebaseApp\s*\)/.test(source),
    "firestoreAdmin.mjs must never call getFirestore(app) without a database id",
  );
  // The staging database id is imported from the shared vocabulary.
  assert.match(source, /STAGING_DATABASE_ID/);
});

test("the admin ingest client opens the staging database and the alerts database", () => {
  const source = read("src/lib/ingest.js");
  // Two handles from one app: staging for ingest, (default) for alerts.
  assert.match(source, /sdk\.getFirestore\(app,\s*STAGING_DATABASE_ID\)/);
  assert.match(source, /alertsDb:\s*sdk\.getFirestore\(app\)/);
  // Promotion must create the alert through the alerts database.
  assert.match(source, /resolveAlertsDb\(ctx\)/);
});

test("the staging-database decision is documented", () => {
  const security = read("collector/SECURITY.md");
  assert.match(security, /staging/i);
  assert.match(security, /(default)/);
  const scheduling = read("collector/SCHEDULING.md");
  assert.match(scheduling, /staging/i);
});
