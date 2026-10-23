// ---------------------------------------------------------------------------
// Two-PROJECT isolation for the collector's staging data.
//
// The collector, the admin review UI and the rules must all agree that the
// ingest collections live in the `jntuh-notes-staging` Firebase project's
// `(default)` database, and that the production project `jntuh-notes-6ef74` is
// unreachable for them. These tests are static (no emulator, no network): they
// pin the configuration and the code so a future edit cannot quietly re-merge
// the two projects or introduce a fallback.
//
// The behavioural proof lives in collector/tests/rules/*.test.mjs (emulator).
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  PRODUCTION_PROJECT_ID,
  STAGING_COLLECTIONS,
  STAGING_DATABASE_ID,
  STAGING_PROJECT_ID,
  resolveDatabaseId,
} from "../lib/runReport.mjs";
import { STAGING_PROJECT_ID as FRONTEND_STAGING_PROJECT_ID } from "../../src/lib/ingest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

const INGEST_COLLECTION_NAMES = Object.values(STAGING_COLLECTIONS);
const INGEST_IDENTIFIERS = ["ingestItems", "ingestRuns", "ingestSourceHealth"];

test("the collector and the admin UI agree on the staging project", () => {
  assert.equal(STAGING_PROJECT_ID, "jntuh-notes-staging");
  assert.equal(PRODUCTION_PROJECT_ID, "jntuh-notes-6ef74");
  assert.notEqual(STAGING_PROJECT_ID, PRODUCTION_PROJECT_ID);
  assert.equal(FRONTEND_STAGING_PROJECT_ID, STAGING_PROJECT_ID);
  assert.equal(STAGING_DATABASE_ID, "(default)");
});

test("resolveDatabaseId accepts only the staging project's primary database", () => {
  assert.equal(resolveDatabaseId(), STAGING_DATABASE_ID);
  assert.equal(resolveDatabaseId("(default)"), STAGING_DATABASE_ID);
  // Surrounding whitespace from an environment variable is tolerated.
  assert.equal(resolveDatabaseId("  (default)  "), STAGING_DATABASE_ID);
  for (const unsafe of [
    "staging",
    "prod",
    "default",
    "",
    "   ",
    null,
    "STAGING",
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

test("firebase.json deploys the production rules only", () => {
  const config = readJson("firebase.json");
  assert.ok(!Array.isArray(config.firestore), "production uses a single firestore entry");
  assert.equal(config.firestore.rules, "firestore.rules");
  assert.equal(config.firestore.indexes, "firestore.indexes.json");
  assert.ok(
    !/staging/i.test(config.firestore.rules),
    "the production config must not reference the staging ruleset",
  );
  assert.ok(existsSync(path.join(ROOT, config.firestore.rules)));
  assert.ok(existsSync(path.join(ROOT, config.firestore.indexes)));
});

test("firebase.staging.json deploys the staging rules to the staging project", () => {
  const config = readJson("firebase.staging.json");
  assert.ok(!Array.isArray(config.firestore), "staging uses a single firestore entry");
  assert.equal(config.firestore.rules, "firestore.staging.rules");
  assert.equal(config.firestore.indexes, "firestore.staging.indexes.json");
  assert.ok(existsSync(path.join(ROOT, config.firestore.rules)));
  assert.ok(existsSync(path.join(ROOT, config.firestore.indexes)));
});

test("the emulator config supports two projects", () => {
  // The rules tests load the staging ruleset into a second demo project, so the
  // emulator must not be locked to the `--project` argument.
  const config = readJson("firebase.e2e.json");
  assert.equal(config.emulators.singleProjectMode, false);
  assert.ok(!Array.isArray(config.firestore), "firebase.e2e.json keeps a single firestore entry");
  assert.equal(config.firestore.rules, "firestore.rules");
});

test("the workflow targets the staging project with WIF, never production", () => {
  const workflow = read(".github/workflows/collect-alerts.yml");

  assert.match(workflow, /COLLECTOR_PROJECT_ID:\s*jntuh-notes-staging/);
  assert.match(workflow, /COLLECTOR_DATABASE_ID:\s*"\(default\)"/);
  assert.match(workflow, /google-github-actions\/auth@v2/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(workflow, /GCP_COLLECTOR_SERVICE_ACCOUNT/);
  assert.match(workflow, /COLLECTOR_STAGING_ENABLED/);

  // No long-lived credential and no production project as a write target.
  assert.ok(!/FIREBASE_SERVICE_ACCOUNT/.test(workflow), "no service-account secret");
  assert.ok(!/secrets\./.test(workflow), "the workflow must not read repository secrets");
  assert.ok(
    !/COLLECTOR_PROJECT_ID:\s*jntuh-notes-6ef74/.test(workflow),
    "the collector must never be pointed at production",
  );
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

test("the production rules no longer mention the ingest collections", () => {
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

test("the collector's store refuses production and passes an explicit database id", () => {
  const source = read("collector/lib/firestoreAdmin.mjs");
  // The production project is refused explicitly...
  assert.match(source, /PRODUCTION_PROJECT_ID/);
  assert.match(source, /refusing the production project/);
  // ...the staging project is the default allowlist...
  assert.match(source, /allowedProjects = \[STAGING_PROJECT_ID\]/);
  // ...and the database id is resolved and passed explicitly.
  assert.match(source, /resolveDatabaseId\(databaseId\)/);
  assert.match(source, /getFirestore\(firebaseApp,\s*resolvedDatabaseId\)/);
  assert.ok(
    !/getFirestore\(\s*firebaseApp\s*\)/.test(source),
    "firestoreAdmin.mjs must never call getFirestore(app) without a database id",
  );
  assert.match(source, /STAGING_PROJECT_ID/);
});

test("the admin ingest client uses two Firebase APPS, not two databases of one app", () => {
  const source = read("src/lib/ingest.js");
  // Staging is a separate app/project; alerts stay on the production app.
  assert.match(source, /getStagingApp/);
  assert.match(source, /db:\s*sdk\.getFirestore\(stagingApp\)/);
  assert.match(source, /alertsDb:\s*sdk\.getFirestore\(app\)/);
  // Promotion must create the alert through the production alerts handle.
  assert.match(source, /resolveAlertsDb\(ctx\)/);
  // The old same-app/named-database design must be gone.
  assert.ok(
    !/getFirestore\(app,\s*STAGING_DATABASE_ID\)/.test(source),
    "ingest.js must not open staging as a named database of the production app",
  );
  assert.match(source, /STAGING_PROJECT_ID\s*=\s*"jntuh-notes-staging"/);
});

test("the two-project decision is documented", () => {
  const security = read("collector/SECURITY.md");
  assert.match(security, /jntuh-notes-staging/);
  assert.match(security, /jntuh-notes-6ef74/);
  assert.match(security, /Workload Identity|WIF/i);

  const scheduling = read("collector/SCHEDULING.md");
  assert.match(scheduling, /jntuh-notes-staging/);
  assert.match(scheduling, /Workload Identity|WIF/i);

  const env = read(".env.example");
  assert.match(env, /VITE_STAGING_FIREBASE_PROJECT_ID=jntuh-notes-staging/);
});
