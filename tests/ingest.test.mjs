// ---------------------------------------------------------------------------
// Unit tests for the admin ingestion client (src/lib/ingest.js).
//
// These run under the Node test runner with a MOCK Firestore context injected
// through the `deps.context` seam, so they never touch a real database and
// never need credentials. The real, rules-enforced atomic behaviour is proven
// separately against the Firestore Emulator in
// collector/tests/rules/ingest.promotion.rules.test.mjs.
//
// Run with: npm run test:unit
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ALERT_COLLECTION,
  ALERT_STATUS,
  buildAlertDocument,
  cleanAlert,
} from "../src/lib/alerts.js";
import {
  INGEST_COLLECTIONS,
  REVIEW_FILTER_ALL,
  countIngestStates,
  fetchIngestItems,
  fetchIngestRuns,
  fetchSourceHealth,
  filterIngestItems,
  hasContentChange,
  ignoreIngestItem,
  ingestSourceOptions,
  normaliseSourceHealth,
  promoteIngestItem,
  redactErrorText,
} from "../src/lib/ingest.js";

// --- a small mock Firestore -------------------------------------------------
//
// `runTransaction` only applies staged writes after the callback resolves, so a
// throwing callback (a rejected validation) leaves the store untouched - just
// like a real transaction. Every committed write is tagged `txn` so tests can
// assert promotion writes go through the transaction, not around it.

function makeFake(options = {}) {
  const stores = {
    ingestItems: { ...(options.items || {}) },
    alerts: { ...(options.alerts || {}) },
    ingestRuns: { ...(options.runs || {}) },
    ingestSourceHealth: { ...(options.health || {}) },
  };
  const log = { sets: [], updates: [], transactions: 0, queries: [] };
  const db = { permissionDenied: Boolean(options.permissionDenied) };
  let seq = 0;

  const split = (path) => {
    const [col, ...rest] = String(path).split("/");
    return [col, rest.join("/")];
  };
  const storeFor = (col) => stores[col] || (stores[col] = {});
  const denied = () => {
    const err = new Error("denied");
    err.code = "permission-denied";
    return err;
  };

  const sdk = {
    serverTimestamp: () => ({ __ts: true }),
    getFirestore: () => db,

    collection: (_db, path) => ({ kind: "collection", path }),
    doc: (a, b, c) => {
      if (a && a.kind === "collection") {
        const id = b ?? `gen-${++seq}`;
        return { kind: "doc", path: `${a.path}/${id}`, id };
      }
      return { kind: "doc", path: `${b}/${c}`, id: c };
    },
    query: (base, ...constraints) => ({
      kind: "query",
      path: base.path,
      constraints,
    }),
    orderBy: (field, dir) => ({ kind: "orderBy", field, dir }),
    limit: (n) => ({ kind: "limit", n }),
    startAfter: (cursor) => ({ kind: "startAfter", cursor }),

    async getDocs(q) {
      if (db.permissionDenied) throw denied();
      log.queries.push(q);
      const store = storeFor(q.path);
      const docs = Object.entries(store).map(([id, data]) => ({
        id,
        data: () => data,
        exists: () => true,
      }));
      return { docs, size: docs.length };
    },

    async updateDoc(ref, data) {
      if (db.permissionDenied) throw denied();
      const [col, id] = split(ref.path);
      const store = storeFor(col);
      if (!(id in store)) {
        const err = new Error("not found");
        err.code = "not-found";
        throw err;
      }
      log.updates.push({ path: ref.path, data, txn: false });
      store[id] = { ...store[id], ...data };
    },

    async runTransaction(_db, update) {
      if (db.permissionDenied) throw denied();
      log.transactions += 1;
      const staged = { sets: [], updates: [] };
      const tx = {
        async get(ref) {
          if (db.permissionDenied) throw denied();
          const [col, id] = split(ref.path);
          const store = storeFor(col);
          const data = id in store ? store[id] : undefined;
          return { exists: () => data !== undefined, data: () => data };
        },
        set: (ref, data) => staged.sets.push({ path: ref.path, data }),
        update: (ref, data) => staged.updates.push({ path: ref.path, data }),
      };
      const result = await update(tx);
      for (const w of staged.sets) {
        const [col, id] = split(w.path);
        storeFor(col)[id] = w.data;
        log.sets.push({ ...w, txn: true });
      }
      for (const w of staged.updates) {
        const [col, id] = split(w.path);
        storeFor(col)[id] = { ...storeFor(col)[id], ...w.data };
        log.updates.push({ ...w, txn: true });
      }
      return result;
    },
  };

  return { sdk, context: { db, sdk }, stores, log };
}

const ITEM_ID = "item-1";
const BASE_ITEM = {
  itemId: ITEM_ID,
  sourceId: "notifications",
  sourceName: "JNTUH Notifications",
  title: "Fee notification",
  category: "general",
  canonicalUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  documentUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  sourceUrl: null,
  attachments: [],
  noticeDate: new Date("2026-10-01T00:00:00Z"),
  contentHash: "abc",
  firstSeenAt: new Date("2026-10-17T00:00:00Z"),
  lastSeenAt: new Date("2026-10-17T00:00:00Z"),
  seenCount: 1,
  reviewState: "new",
};

const VALID_INPUT = {
  title: "Fee notification for II semester",
  summary: "The university released a fee notification for II semester.",
  category: "general",
  sourceName: "JNTUH Notifications",
  sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  publishedAt: "2026-10-01",
  deadlineAt: "",
  audience: [],
  tags: [],
  pinned: false,
};

const freshItem = () => ({ items: { [ITEM_ID]: { ...BASE_ITEM } } });

// --- listing and filtering --------------------------------------------------

describe("staged-notice listing and filtering", () => {
  it("lists staged notices ordered by firstSeenAt without a compound query", async () => {
    const { context, log } = makeFake(freshItem());
    const page = await fetchIngestItems({ pageSize: 25 }, { context });

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, ITEM_ID);
    assert.equal(page.items[0].reviewState, "new");

    const q = log.queries[0];
    assert.equal(q.path, INGEST_COLLECTIONS.ITEMS);
    assert.deepEqual(q.constraints[0], { kind: "orderBy", field: "firstSeenAt", dir: "desc" });
    assert.ok(q.constraints.some((c) => c.kind === "limit"));
    assert.ok(!q.constraints.some((c) => c.kind === "where"));
  });

  it("filters by search text, review state and source in memory", () => {
    const list = [
      { id: "1", title: "Exam timetable", sourceId: "exams", sourceName: "Exams", reviewState: "new" },
      { id: "2", title: "Fee notification", sourceId: "notifications", sourceName: "Notifications", reviewState: "promoted" },
    ];

    assert.equal(filterIngestItems(list, { query: "timetable" }).length, 1);
    assert.equal(filterIngestItems(list, { query: "exams" })[0].id, "1");
    assert.equal(filterIngestItems(list, { query: "zzz" }).length, 0);
    assert.equal(filterIngestItems(list, { reviewState: "promoted" })[0].id, "2");
    assert.equal(filterIngestItems(list, { sourceId: "notifications" })[0].id, "2");
    assert.equal(filterIngestItems(list, { reviewState: REVIEW_FILTER_ALL }).length, 2);
  });

  it("builds source options and review-state counts", () => {
    const list = [
      { sourceId: "notifications", sourceName: "JNTUH Notifications", reviewState: "new" },
      { sourceId: "exams", sourceName: "JNTUH Examinations Portal", reviewState: "new", changedAt: new Date() },
      { sourceId: "notifications", sourceName: "JNTUH Notifications", reviewState: "promoted" },
      { sourceId: "exams", sourceName: "JNTUH Examinations Portal", reviewState: "ignored" },
    ];
    const options = ingestSourceOptions(list);
    assert.equal(options.length, 2);
    assert.equal(options[0].id, "exams");
    assert.deepEqual(countIngestStates(list), {
      all: 4,
      new: 2,
      promoted: 1,
      ignored: 1,
      changed: 1,
    });
  });
});

// --- access and errors ------------------------------------------------------

describe("admin-only access and error handling", () => {
  it("surfaces permission-denied on listing clearly", async () => {
    const { context } = makeFake({ permissionDenied: true });
    await assert.rejects(
      () => fetchIngestItems({}, { context }),
      (err) => err.code === "permission-denied" && /permission denied/i.test(err.message)
    );
  });

  it("reports a clear error when Firebase is not configured", async () => {
    await assert.rejects(() => fetchIngestItems(), /not configured/i);
  });

  it("surfaces permission-denied on promotion as a clear message", async () => {
    const { context, stores } = makeFake({ ...freshItem(), permissionDenied: true });
    await assert.rejects(
      () => promoteIngestItem({ itemId: ITEM_ID, input: VALID_INPUT, actor: "admin@x" }, { context }),
      (err) => err.code === "permission-denied" && /permission denied/i.test(err.message)
    );
    // Nothing was created.
    assert.equal(Object.keys(stores.alerts).length, 0);
  });

  it("reads run reports and source health", async () => {
    const { context } = makeFake({
      runs: { "run-1": { runId: "run-1", status: "ok", counts: { notices: 4 } } },
      health: { notifications: { sourceId: "notifications", status: "ok" } },
    });
    const runs = await fetchIngestRuns({}, { context });
    assert.equal(runs.runs[0].status, "ok");
    assert.equal(runs.runs[0].counts.notices, 4);

    const health = await fetchSourceHealth({ context });
    assert.equal(health[0].sourceId, "notifications");
  });
});

// --- ignoring ---------------------------------------------------------------

describe("ignoring a staged notice", () => {
  it("writes only the reviewState field", async () => {
    const { context, stores, log } = makeFake(freshItem());
    const result = await ignoreIngestItem({ itemId: ITEM_ID, actor: "admin@x" }, { context });

    assert.equal(result.reviewState, "ignored");
    assert.equal(stores.ingestItems[ITEM_ID].reviewState, "ignored");
    assert.deepEqual(Object.keys(log.updates[0].data), ["reviewState"]);
    assert.equal(log.updates[0].txn, false);
  });

  it("reports a missing notice clearly", async () => {
    const { context } = makeFake(freshItem());
    await assert.rejects(
      () => ignoreIngestItem({ itemId: "missing" }, { context }),
      (err) => err.code === "not-found" && /no longer exists/i.test(err.message)
    );
  });
});

// --- promotion --------------------------------------------------------------

describe("promotion into an alert draft", () => {
  it("creates exactly one draft and updates the item inside one transaction", async () => {
    const { context, stores, log } = makeFake(freshItem());
    const result = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, actor: "admin@x" },
      { context }
    );

    assert.equal(result.created, true);
    assert.equal(log.transactions, 1);

    // Both writes happened inside the transaction.
    assert.equal(log.sets.length, 1);
    assert.equal(log.sets[0].txn, true);
    assert.equal(log.updates.length, 1);
    assert.equal(log.updates[0].txn, true);

    // The alert is a private draft - never verified, never published.
    const alert = stores.alerts[result.alertId];
    assert.ok(alert, "the alert draft exists");
    assert.equal(alert.status, ALERT_STATUS.DRAFT);
    assert.equal(alert.verifiedAt, null);
    assert.equal(alert.verifiedBy, "");
    assert.equal(alert.title, VALID_INPUT.title);
    assert.equal(alert.summary, VALID_INPUT.summary);
    assert.equal(alert.createdBy, "admin@x");

    // The staged item records exactly the permitted review fields.
    const item = stores.ingestItems[ITEM_ID];
    assert.equal(item.reviewState, "promoted");
    assert.equal(item.promotedAlertId, result.alertId);
    assert.equal(item.promotedBy, "admin@x");
    assert.deepEqual(Object.keys(log.updates[0].data).sort(), [
      "promotedAlertId",
      "promotedAt",
      "promotedBy",
      "reviewState",
    ]);
  });

  it("returns the same alert id on a repeated promotion and creates no duplicate", async () => {
    const { context, stores, log } = makeFake(freshItem());
    const first = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, actor: "admin@x" },
      { context }
    );
    const second = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, actor: "admin@x" },
      { context }
    );

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.alertId, first.alertId);
    assert.equal(second.alertId, log.sets[0].path.split("/")[1]);
    assert.equal(Object.keys(stores.alerts).length, 1);
    assert.equal(log.sets.length, 1); // no second alert write
  });

  it("still returns the existing alert id when the repeat form is invalid", async () => {
    const { context, stores } = makeFake(freshItem());
    const first = await promoteIngestItem(
      { itemId: ITEM_ID, input: VALID_INPUT, actor: "admin@x" },
      { context }
    );
    // The already-promoted check runs before validation, so this is a no-op.
    const second = await promoteIngestItem(
      { itemId: ITEM_ID, input: { ...VALID_INPUT, summary: "" }, actor: "admin@x" },
      { context }
    );
    assert.equal(second.created, false);
    assert.equal(second.alertId, first.alertId);
    assert.equal(Object.keys(stores.alerts).length, 1);
  });

  it("rejects a missing summary and writes nothing", async () => {
    const { context, stores, log } = makeFake(freshItem());
    await assert.rejects(
      () =>
        promoteIngestItem(
          { itemId: ITEM_ID, input: { ...VALID_INPUT, summary: "" }, actor: "admin@x" },
          { context }
        ),
      /summary/i
    );
    assert.equal(Object.keys(stores.alerts).length, 0);
    assert.equal(stores.ingestItems[ITEM_ID].reviewState, "new");
    assert.equal(log.sets.length, 0);
    assert.equal(log.updates.length, 0);
  });

  it("fails clearly when the staged notice no longer exists", async () => {
    const { context } = makeFake({});
    await assert.rejects(
      () => promoteIngestItem({ itemId: "missing", input: VALID_INPUT, actor: "admin@x" }, { context }),
      (err) => err.code === "not-found" && /no longer exists/i.test(err.message)
    );
  });
});

// --- normalisers and safety -------------------------------------------------

describe("normalisers, redaction and change detection", () => {
  it("redacts credential material from stored errors", () => {
    const health = normaliseSourceHealth("notifications", {
      sourceId: "notifications",
      status: "broken",
      consecutiveFailures: 3,
      lastError: {
        code: "auth/error",
        phase: "auth",
        message: '{"private_key": "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----"}',
      },
    });
    assert.equal(health.status, "broken");
    assert.ok(!/PRIVATE KEY/.test(health.lastError.message));
    assert.ok(!/ABC/.test(health.lastError.message));
    assert.ok(!/private_key/.test(health.lastError.message));
  });

  it("redacts credential-looking file names", () => {
    const out = redactErrorText("Failed to load /secrets/service-account-key.json");
    assert.ok(!/service-account-key/.test(out));
    assert.ok(/redacted/i.test(out));
  });

  it("detects content changes from the collector's metadata", () => {
    assert.equal(hasContentChange({ changedAt: new Date() }), true);
    assert.equal(hasContentChange({ contentHash: "a", previousHash: "b" }), true);
    assert.equal(hasContentChange({ contentHash: "a", previousHash: "a" }), false);
    assert.equal(hasContentChange({ contentHash: "a" }), false);
    assert.equal(hasContentChange({}), false);
  });
});

// --- existing alert safeguards must remain unchanged ------------------------

describe("existing alert safeguards are preserved", () => {
  it("builds new alerts as unverified drafts only", () => {
    const fields = cleanAlert(VALID_INPUT);
    const document = buildAlertDocument(fields, "admin@x", () => ({ __ts: true }));

    assert.equal(document.status, ALERT_STATUS.DRAFT);
    assert.equal(document.verifiedAt, null);
    assert.equal(document.verifiedBy, "");
    assert.equal(document.createdBy, "admin@x");
    assert.equal(document.updatedBy, "admin@x");
    assert.equal(document.schemaVersion, 1);
  });

  it("still requires a non-empty summary", () => {
    assert.throws(() => cleanAlert({ ...VALID_INPUT, summary: "" }), /summary/i);
  });

  it("exposes the alerts collection name used for promotion", () => {
    assert.equal(ALERT_COLLECTION, "alerts");
  });
});
