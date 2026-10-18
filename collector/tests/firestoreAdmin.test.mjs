import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  STAGING_COLLECTION_NAMES,
  STAGING_DATABASE_ID,
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

test("resolveDatabaseId pins staging and refuses (default) or malformed ids", () => {
  assert.equal(STAGING_DATABASE_ID, "staging");
  // The default when nothing is requested is the staging database itself.
  assert.equal(resolveDatabaseId(), "staging");
  assert.equal(resolveDatabaseId("staging"), "staging");

  for (const unsafe of ["(default)", "default", "", "   ", null, "Staging", "1staging", "stag ing", "a", "x".repeat(64), "prod"]) {
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

test("resolveProjectId validates allowed projects", () => {
  const ok = resolveProjectId({ requested: "jntuh-notes-6ef74", env: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.wanted, "jntuh-notes-6ef74");

  const bad = resolveProjectId({ requested: "wrong-project", env: {} });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unknown project/);
});

test("resolveProjectId detects environment mismatch", () => {
  const mismatch = resolveProjectId({ requested: "jntuh-notes-6ef74", env: { GCLOUD_PROJECT: "other" } });
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

test("createIngestStore throws without valid project/flags", () => {
  assert.throws(() => createIngestStore({ projectId: undefined }));
  assert.throws(() => createIngestStore({ projectId: "wrong" }));
  assert.throws(() => createIngestStore({ projectId: "jntuh-notes-6ef74", emulator: true, env: {} }));
  assert.throws(() => createIngestStore({ projectId: "jntuh-notes-6ef74", emulator: false, env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" } }));
});

test("createIngestStore refuses every database but staging", () => {
  const base = {
    projectId: "jntuh-notes-6ef74",
    emulator: true,
    env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
  };
  // The database is checked BEFORE any app or credential is created, so these
  // all throw a configuration error rather than connecting anywhere.
  for (const databaseId of ["(default)", "default", "prod", "alerts", "", "   ", null]) {
    assert.throws(
      () => createIngestStore({ ...base, databaseId }),
      /database/i,
      `expected database ${JSON.stringify(databaseId)} to be refused`,
    );
  }
});
