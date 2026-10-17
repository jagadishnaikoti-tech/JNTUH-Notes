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
import { test } from "node:test";

const EMULATOR_HOST = "127.0.0.1:8080";
const DEMO_PROJECT = "demo-jntuh-notes";

test("the staging store's read helpers are bound and allowlist-only", async () => {
  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  const { createIngestStore } = await import("../lib/firestoreAdmin.mjs");

  const store = createIngestStore({
    projectId: DEMO_PROJECT,
    emulator: true,
    allowedProjects: [DEMO_PROJECT],
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: EMULATOR_HOST },
    quiet: true,
  });

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
