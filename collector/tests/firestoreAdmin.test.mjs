import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  PRODUCTION_PROJECT_ID,
  STAGING_COLLECTION_NAMES,
  STAGING_DATABASE_ID,
  STAGING_PROJECT_ID,
  isStagingCollection,
  resolveDatabaseId,
} from "../lib/runReport.mjs";
import {
  createIngestStore,
  isTransientFirestoreError,
  parseEmulatorHost,
  resolveProjectId,
  retryWithBackoff,
} from "../lib/firestoreAdmin.mjs";

test("isStagingCollection accepts only staging collections", () => {
  for (const name of STAGING_COLLECTION_NAMES) assert.ok(isStagingCollection(name));
  assert.ok(!isStagingCollection("alerts"));
  assert.ok(!isStagingCollection("analyticsEvents"));
});

test("resolveDatabaseId pins the staging project's (default) database", () => {
  assert.equal(STAGING_DATABASE_ID, "(default)");
  // The default when nothing is requested is the only acceptable database.
  assert.equal(resolveDatabaseId(), "(default)");
  assert.equal(resolveDatabaseId("(default)"), "(default)");
  assert.equal(resolveDatabaseId("  (default)  "), "(default)");

  // Named databases are refused: the project, not a database name, is the
  // isolation boundary.
  for (const unsafe of [
    "staging",
    "default",
    "",
    "   ",
    null,
    "STAGING",
    "staging-2",
    "staging.x",
    "a",
    "x".repeat(64),
    "prod",
  ]) {
    assert.throws(
      () => resolveDatabaseId(unsafe),
      /database/i,
      `expected ${JSON.stringify(unsafe)} to be refused`,
    );
  }
});

test("isTransientFirestoreError handles numbers, strings, syscalls and cause", () => {
  assert.ok(isTransientFirestoreError({ code: 14 })); // UNAVAILABLE
  assert.ok(isTransientFirestoreError({ code: "unavailable" }));
  assert.ok(isTransientFirestoreError({ code: "UNAVAILABLE" }));
  assert.ok(isTransientFirestoreError({ code: "deadline-exceeded" }));
  assert.ok(isTransientFirestoreError({ code: "ECONNRESET" }));
  assert.ok(isTransientFirestoreError({ code: "ETIMEDOUT" }));
  assert.ok(isTransientFirestoreError({ cause: { code: 10 } }));
  assert.equal(isTransientFirestoreError({ code: 7 }), false); // PERMISSION_DENIED
  assert.equal(isTransientFirestoreError({ code: 5 }), false); // NOT_FOUND
  assert.equal(isTransientFirestoreError({}), false);
  assert.equal(isTransientFirestoreError(null), false);
});

test("retryWithBackoff retries only transient errors", async () => {
  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts += 1;
    if (attempts < 2) throw { code: 14 }; // transient
    return "ok";
  }, { sleep: async () => {} });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("retryWithBackoff stops after attempts and rethrows", async () => {
  let attempts = 0;
  try {
    await retryWithBackoff(async () => {
      attempts += 1;
      throw { code: 14 };
    }, { attempts: 2, sleep: async () => {} });
    assert.fail("expected to throw");
  } catch (error) {
    assert.equal(error.code, 14);
    assert.equal(attempts, 2);
  }
});

test("retryWithBackoff does not retry non-transient errors", async () => {
  let attempts = 0;
  try {
    await retryWithBackoff(async () => {
      attempts += 1;
      throw { code: 7 };
    }, { attempts: 5, sleep: async () => {} });
    assert.fail("expected to throw");
  } catch (error) {
    assert.equal(error.code, 7);
    assert.equal(attempts, 1);
  }
});

test("resolveProjectId accepts only the staging project", () => {
  const ok = resolveProjectId({ requested: STAGING_PROJECT_ID, env: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.wanted, STAGING_PROJECT_ID);

  const bad = resolveProjectId({ requested: "wrong-project", env: {} });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unknown project/);
});

test("resolveProjectId refuses the production project unconditionally", () => {
  // Even an injected allowlist that contains production cannot widen the
  // boundary. This is the code-level half of the IAM separation.
  const injected = resolveProjectId({
    requested: PRODUCTION_PROJECT_ID,
    env: {},
    allowed: [STAGING_PROJECT_ID, PRODUCTION_PROJECT_ID],
  });
  assert.equal(injected.ok, false);
  assert.match(injected.reason, /production/);

  const plain = resolveProjectId({ requested: PRODUCTION_PROJECT_ID, env: {} });
  assert.equal(plain.ok, false);
  assert.match(plain.reason, /production/);
});

test("resolveProjectId refuses an environment pointed at production", () => {
  for (const name of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
    const refused = resolveProjectId({
      requested: STAGING_PROJECT_ID,
      env: { [name]: PRODUCTION_PROJECT_ID },
    });
    assert.equal(refused.ok, false, `${name} pointing at production must be refused`);
    assert.match(refused.reason, /production/);
  }
});

test("resolveProjectId detects environment mismatch", () => {
  const mismatch = resolveProjectId({
    requested: STAGING_PROJECT_ID,
    env: { GCLOUD_PROJECT: "other" },
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /mismatch/);
});

test("parseEmulatorHost validates format", () => {
  const ok = parseEmulatorHost({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.equal(ok.ok, true);
  assert.equal(ok.host, "127.0.0.1:8080");

  const bad = parseEmulatorHost({});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /requires FIRESTORE_EMULATOR_HOST/);

  const weird = parseEmulatorHost({ FIRESTORE_EMULATOR_HOST: "bad" });
  assert.equal(weird.ok, false);
});

test("createIngestStore throws without a valid staging project/flags", () => {
  assert.throws(() => createIngestStore({ projectId: undefined }));
  assert.throws(() => createIngestStore({ projectId: "wrong" }));
  // Production is refused before an app or credential is created...
  assert.throws(() =>
    createIngestStore({ projectId: PRODUCTION_PROJECT_ID, emulator: true, env: {} })
  );
  assert.throws(() =>
    createIngestStore({
      projectId: PRODUCTION_PROJECT_ID,
      emulator: false,
      env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    })
  );
  // ...and the emulator/live modes are mutually exclusive.
  assert.throws(() =>
    createIngestStore({ projectId: STAGING_PROJECT_ID, emulator: true, env: {} })
  );
  assert.throws(() =>
    createIngestStore({
      projectId: STAGING_PROJECT_ID,
      emulator: false,
      env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    })
  );
});

test("createIngestStore accepts the staging project's primary database", async () => {
  const store = createIngestStore({
    projectId: STAGING_PROJECT_ID,
    databaseId: "(default)",
    emulator: true,
    env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    allowedProjects: [STAGING_PROJECT_ID],
    quiet: true,
  });
  try {
    assert.equal(store.projectId, STAGING_PROJECT_ID);
    assert.equal(store.databaseId, "(default)");
    assert.equal(store.mode, "emulator");
  } finally {
    await store.close();
  }
});

test("createIngestStore refuses every database but the staging (default)", () => {
  const base = {
    projectId: STAGING_PROJECT_ID,
    emulator: true,
    env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
  };
  // The database is checked BEFORE any app or credential is created, so these
  // all throw a configuration error rather than connecting anywhere.
  for (const databaseId of ["staging", "default", "prod", "alerts", "", "   ", null]) {
    assert.throws(
      () => createIngestStore({ ...base, databaseId }),
      /database/i,
      `expected database ${JSON.stringify(databaseId)} to be refused`,
    );
  }
});

test("createIngestStore refuses production even if the allowlist is tampered with", () => {
  assert.throws(
    () =>
      createIngestStore({
        projectId: PRODUCTION_PROJECT_ID,
        emulator: true,
        env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
        allowedProjects: [PRODUCTION_PROJECT_ID],
      }),
    /production/i,
  );
});
