// ---------------------------------------------------------------------------
// Regression: the real staging store is fully wired for write-mode reads.
//
// `createIngestStore` binds readItems / readSourceHealth / readRuns to the
// STAGING_COLLECTIONS allowlist. When that import was missing, a `--write` run
// failed at the first read with `STAGING_COLLECTIONS is not defined`. This
// builds the real store in emulator mode - no credentials, and an empty read
// returns before any Firestore round-trip - and calls each helper, so an unbound
// identifier fails here instead of mid-write.
//
// Run with: npm run test:collector
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { test } from "node:test";

const EMULATOR_HOST = "127.0.0.1:8080";
const EMULATOR_HOSTNAME = "127.0.0.1";
const EMULATOR_PORT = 8080;
const DEMO_PROJECT = "demo-jntuh-notes-staging";

/** True when a TCP listener answers on the emulator port. */
function emulatorReachable({ host = EMULATOR_HOSTNAME, port = EMULATOR_PORT, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * Build the real staging store against the local emulator and the demo
 * staging project. Never production: emulator mode only accepts a
 * FIRESTORE_EMULATOR_HOST and the demo project id is the sole allowed project.
 */
function makeEmulatorStore(createIngestStore) {
  return createIngestStore({
    projectId: DEMO_PROJECT,
    emulator: true,
    allowedProjects: [DEMO_PROJECT],
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: EMULATOR_HOST },
    quiet: true,
  });
}

test("the staging store's read helpers are bound and allowlist-only", async () => {
  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  const { createIngestStore } = await import("../lib/firestoreAdmin.mjs");
  const store = makeEmulatorStore(createIngestStore);

  try {
    // Evaluating each helper dereferences STAGING_COLLECTIONS.*; an unbound
    // import throws ReferenceError here. An empty id list returns before any
    // Firestore round-trip, so the emulator need not be running. `readItems`
    // receives a Set from itemIdsForSources (exactly as index.mjs does).
    const { itemIdsForSources } = await import("../write.mjs");
    const { ids } = itemIdsForSources([]);
    assert.equal((await store.readItems(ids)).size, 0);
    assert.equal((await store.readItems([])).size, 0);
    assert.equal((await store.readSourceHealth([])).size, 0);
    assert.equal((await store.readRuns([])).size, 0);

    // The store still refuses every collection outside the allowlist.
    await assert.rejects(() => store.readStaging("alerts", []), /disallowed collection/);
    await assert.rejects(
      () => store.commitMutations([{ collection: "alerts", id: "a", data: {} }]),
      /disallowed collection/,
    );
    await assert.rejects(
      () => store.commitMutations([{ collection: "ingestItems-guess", id: "a" }]),
      /disallowed collection/,
    );
  } finally {
    await store.close();
    if (previous === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous;
  }
});

test("commitMutations persists an ingestRuns document in the emulator", async (t) => {
  // Skip (loudly) when no emulator is listening; never silently pass a write.
  if (!(await emulatorReachable())) {
    t.skip(`Firestore emulator not reachable at ${EMULATOR_HOST}`);
    return;
  }

  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  const { createIngestStore } = await import("../lib/firestoreAdmin.mjs");
  const store = makeEmulatorStore(createIngestStore);

  // A fresh id per run so repeated runs never collide or read a stale doc.
  const runId = `persistence-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const payload = {
    runId,
    status: "ok",
    trigger: "test",
    projectId: DEMO_PROJECT,
    marker: "collector-persistence-regression",
    counts: { sourcesOk: 1, sourcesFailed: 0, operations: 1 },
    tags: ["emulator", "persistence"],
    nested: { a: 1, b: "two", c: true },
  };

  try {
    // Real write through the staging store into ingestRuns (allowlisted).
    await store.commitMutations([{ collection: "ingestRuns", id: runId, data: payload, merge: true }]);

    // Read it back through the Admin SDK via the store's own read helper.
    const found = await store.readRuns([runId]);
    assert.ok(found.has(runId), `expected ingestRuns/${runId} to be readable after the write`);
    assert.deepStrictEqual(found.get(runId), payload, "persisted document must match what was written");
  } finally {
    // Cleanup runs even if the write/read assertions above threw. Best-effort so
    // a cleanup problem never masks the real failure.
    try {
      await store.commitMutations([{ collection: "ingestRuns", id: runId, delete: true }]);
    } catch (error) {
      console.warn(`persistence test cleanup failed for ingestRuns/${runId}: ${error?.message ?? error}`);
    }
    await store.close();
    if (previous === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous;
  }
});
