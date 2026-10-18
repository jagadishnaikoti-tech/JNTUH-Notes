// ---------------------------------------------------------------------------
// The collector's IAM boundary (Option A of the security review).
//
// The collector writes Firestore through the Admin SDK, which bypasses
// `firestore.rules`; Google Cloud IAM is the only real boundary for the runner.
// Firestore IAM is database-granular, never collection-granular, so the least we
// can do is (a) grant a custom role that contains only the permissions the code
// actually uses, and (b) prove that surface here.
//
// These tests do three things:
//   1. pin the collector's database operation surface (id lookups + merge
//      writes, and a delete branch that no planner can reach);
//   2. pin the checked-in custom role to exactly the permissions those
//      operations need - and to none of the delete/database-administration
//      permissions that `roles/datastore.user` would have granted;
//   3. fail if the documentation drifts from the role, or if it starts claiming
//      that this role isolates individual collections.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLLECTOR = path.join(ROOT, "collector");

const STORE = path.join(COLLECTOR, "lib", "firestoreAdmin.mjs");
const WRITE = path.join(COLLECTOR, "write.mjs");
const CLI = path.join(COLLECTOR, "index.mjs");
const INGEST_PLAN = path.join(COLLECTOR, "lib", "ingestPlan.mjs");
const ROLE_FILE = path.join(COLLECTOR, "iam", "collector-staging-role.json");
const SECURITY = path.join(COLLECTOR, "SECURITY.md");
const SCHEDULING = path.join(COLLECTOR, "SCHEDULING.md");

const ROLE_ID = "jntuhCollectorStaging";
const PROJECT_ID = "jntuh-notes-6ef74";
const SERVICE_ACCOUNT = `collector-runner@${PROJECT_ID}.iam.gserviceaccount.com`;

const read = (file) => readFileSync(file, "utf8");
const withoutComments = (source) => source.replace(/^\s*\/\/.*$/gm, "");

/**
 * The permissions a *live collection run* needs, derived from the "Required
 * permissions for API methods" table in the Firestore "Security for server
 * client libraries" documentation:
 *
 *   batchGet                     -> datastore.entities.get
 *   batchWrite/commit (upsert)   -> datastore.entities.create + update
 *
 * `batch.delete` is deliberately absent: no planner emits a delete mutation, so
 * the permission is not needed and must not be granted.
 */
const OPERATION_PERMISSIONS = Object.freeze([
  {
    op: "db.getAll(...refs) - a batchGet of staging documents by id",
    permissions: ["datastore.entities.get"],
  },
  {
    op: "batch.set(ref, data, { merge: true }) - an upsert write",
    permissions: ["datastore.entities.create", "datastore.entities.update"],
  },
]);

const neededPermissions = [
  ...new Set(OPERATION_PERMISSIONS.flatMap((entry) => entry.permissions)),
].sort();

function callsOn(source, receiver) {
  const calls = new Set();
  for (const match of withoutComments(source).matchAll(new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, "g"))) {
    calls.add(match[1]);
  }
  return [...calls].sort();
}

const role = JSON.parse(read(ROLE_FILE));

test("the collector's database surface is id lookups plus merge writes, and nothing else", () => {
  const source = read(STORE);

  // The only calls made directly on the database handle.
  assert.deepEqual(
    callsOn(source, "db"),
    ["batch", "collection", "getAll", "settings"],
    "the store must use db.getAll for reads and db.batch for writes - no queries, no transactions",
  );

  // The only calls made on a write batch.
  assert.deepEqual(
    callsOn(source, "batch"),
    ["commit", "delete", "set"],
    "a batch may only set and commit (plus the defensive delete branch below)",
  );

  assert.match(source, /db\.getAll\(\.\.\.refs\)/, "reads go through db.getAll");
  assert.match(source, /batch\.set\(ref, [^)]*\{ merge: true \}\)/, "writes merge, so they are upserts");
  assert.match(source, /if \(mut\.delete\) \{\s*\n\s*batch\.delete\(ref\);\s*\n\s*\}/, "delete stays a guarded branch");
});

test("no collector planner ever emits a delete mutation, so datastore.entities.delete is not needed", () => {
  for (const file of [WRITE, CLI, INGEST_PLAN]) {
    assert.ok(
      !/delete\s*:\s*true/.test(withoutComments(read(file))),
      `${path.basename(file)} must never plan a delete mutation`,
    );
  }

  // Every mutation the collector plans is a merge (an upsert), never a
  // non-merging set that would drop fields or a delete that would destroy data.
  const write = read(WRITE);
  assert.ok((write.match(/merge:\s*true/g) ?? []).length >= 5, "staging writes merge into documents");
  assert.ok(!/merge:\s*false/.test(write), "the collector never replaces a document wholesale");

  // The store accepts a delete mutation for its own contract, but nothing in the
  // collector produces one: without datastore.entities.delete that branch fails
  // closed rather than destroying data.
  const storeDeleteCallers = [WRITE, CLI, INGEST_PLAN].filter((file) => /commitMutations\(\[[^\]]*delete:\s*true/.test(read(file)));
  assert.deepEqual(storeDeleteCallers, [], "no collector module requests a delete through the store");
});

test("the custom role grants exactly the permissions the collector's operations need", () => {
  assert.deepEqual(
    [...role.includedPermissions].sort(),
    neededPermissions,
    "the role must contain the operation permissions and nothing more",
  );

  // The operations the mapping is built from must actually exist, so this test
  // cannot pass vacuously.
  const source = read(STORE);
  assert.ok(callsOn(source, "db").includes("getAll"), "expected a db.getAll read");
  assert.ok(callsOn(source, "batch").includes("set"), "expected a batch.set write");
});

test("the role excludes delete, database administration and every broad role", () => {
  const granted = new Set(role.includedPermissions);

  // 1. No delete, ever.
  assert.ok(!granted.has("datastore.entities.delete"), "datastore.entities.delete must never be granted");

  // 2. Nothing wildcarded or outside the entity read/write surface.
  for (const permission of granted) {
    assert.ok(!permission.includes("*"), `wildcard permission "${permission}" is not least privilege`);
    assert.ok(
      /^datastore\.entities\.(get|create|update)$/.test(permission),
      `unexpected permission "${permission}" - add one only when a live run proves it is needed`,
    );
  }

  // 3. No database/schema/operation/import/export/backup administration.
  const forbiddenPrefixes = [
    "datastore.databases.",
    "datastore.schemas.",
    "datastore.operations.",
    "datastore.namespaces.",
    "datastore.statistics.",
    "datastore.insights.",
    "datastore.backups",
    "datastore.backupSchedules",
    "datastore.keyVisualizerScans.",
    "datastore.locations.",
    "resourcemanager.",
    "firebaserules.",
    "firebaseauth.",
  ];
  for (const prefix of forbiddenPrefixes) {
    assert.ok(
      ![...granted].some((permission) => permission.startsWith(prefix)),
      `the role must not grant any "${prefix}" permission`,
    );
  }

  // 4. It is a project-level custom role with a stage, not a predefined or
  //    primitive role.
  assert.equal(role.stage, "GA");
  assert.ok(role.title && role.description, "a custom role carries a title and description");
  assert.ok(!("role" in role), "this file describes a custom role, not a binding to a predefined one");
});

test("the role documented in SECURITY.md is the checked-in role", () => {
  const security = read(SECURITY);

  const fence = security.match(/```json\s*\n([\s\S]*?)```/);
  assert.ok(fence, "SECURITY.md must embed the role definition in a json block");
  assert.deepEqual(JSON.parse(fence[1]), role, "the documented role and the configured role must not drift");

  // The role is created from this file and bound by its full resource name.
  assert.match(security, new RegExp(`gcloud iam roles create ${ROLE_ID}`));
  assert.match(security, new RegExp(`--file=collector/iam/collector-staging-role\\.json`));
  assert.match(
    security,
    new RegExp(`--role='projects/${PROJECT_ID}/roles/${ROLE_ID}'`),
    "the binding must name the custom role",
  );
  assert.ok(security.includes(SERVICE_ACCOUNT), "the binding must name the dedicated service account");
});

test("the documentation never binds a predefined, primitive or admin role", () => {
  const docs = read(SECURITY) + read(SCHEDULING);
  const forbiddenRoles = [
    "roles/owner",
    "roles/editor",
    "roles/datastore.user",
    "roles/datastore.owner",
    "roles/datastore.bulkAdmin",
    "roles/datastore.importExportAdmin",
    "roles/datastore.backupsAdmin",
    "roles/firebase.admin",
    "firebase.admin",
  ];
  const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const forbidden of forbiddenRoles) {
    const binding = new RegExp(`--role[=\\s'"]+['"]?${escapeRe(forbidden)}`);
    assert.ok(!binding.test(docs), `no documented binding may grant ${forbidden}`);
  }

  // SCHEDULING.md points at the role and at the security document.
  const scheduling = read(SCHEDULING);
  assert.match(scheduling, new RegExp(ROLE_ID), "SCHEDULING.md must name the custom role");
  assert.match(scheduling, /SECURITY\.md/, "SCHEDULING.md must link to SECURITY.md");
});

test("the documentation states the boundary honestly: the role alone isolates no collections", () => {
  const security = read(SECURITY);
  // Markdown wraps prose, so compare on a whitespace-normalised copy.
  const prose = security.replace(/\s+/g, " ");

  // The role is database-wide: on its own it cannot single out collections.
  assert.ok(
    prose.includes("does not isolate individual collections"),
    "the docs must say the role alone does not isolate individual collections",
  );
  assert.match(prose, /collection-level/, "the docs must explain that Firestore IAM has no collection-level role");
  assert.match(prose, /alerts/, "the docs must say the alerts collection is reachable by the credential");
  assert.match(prose, /database/i, "the docs must state the granularity that IAM does offer");

  // Option B adds a real collection-isolation boundary, but it belongs to the
  // DATABASE split, never to the IAM role. No sentence may credit the role with
  // isolating collections, and the database claim must be stated.
  assert.match(
    prose,
    /separate database \*\*does\*\* isolate collections/,
    "the docs must attribute the collection isolation to the separate database",
  );
  assert.ok(
    !/\brole\b[^.]*isolate[sd]?\s+collections/i.test(prose),
    "the docs must not credit the IAM role with isolating collections",
  );
});
