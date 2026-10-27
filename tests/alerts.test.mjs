// ---------------------------------------------------------------------------
// Unit tests for the public alert reads (src/lib/alerts.js) and the shared
// alert formatters (src/lib/alertFormat.js).
//
// These run under the Node test runner with a MOCK Firestore context injected
// through the same `{ context: { db, sdk } }` seam lib/ingest.js uses, so they
// never touch a real database and never need credentials. The real,
// rules-enforced "published only" behaviour is proven separately against the
// Firestore Emulator in collector/tests/rules/firestore.rules.test.mjs.
//
// Run with: npm run test:unit
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ALERT_COLLECTION,
  HOME_ALERTS_LIMIT,
  fetchLatestPublishedAlerts,
  fetchPublishedAlerts,
  getPublishedAlertsViewState,
  readPublishedAlerts,
} from "../src/lib/alerts.js";
import {
  alertMetaLine,
  formatAlertDay,
  toAlertDate,
} from "../src/lib/alertFormat.js";

// --- a small mock Firestore -------------------------------------------------
//
// `getDocs` applies the query's `where` constraints itself, exactly like the
// server does. That is what makes these tests meaningful: a seeded draft is
// excluded because the PUBLIC QUERY filtered it out, not because a later
// client-side step dropped it.

function makeFake(docs = [], { failCode = null } = {}) {
  const log = { queries: [] };
  const sdk = {
    getFirestore: () => ({ kind: "db" }),
    collection: (_db, path) => ({ kind: "collection", path }),
    where: (field, op, value) => ({ kind: "where", field, op, value }),
    query: (base, ...constraints) => ({
      kind: "query",
      path: base.path,
      constraints,
    }),
    async getDocs(q) {
      log.queries.push(q);
      if (failCode) {
        const err = new Error("read failed");
        err.code = failCode;
        throw err;
      }
      const where = q.constraints.filter((c) => c.kind === "where");
      const rows = docs.filter((d) =>
        where.every((w) => d[w.field] === w.value)
      );
      return {
        docs: rows.map((d) => ({ id: d.id, data: () => d })),
        size: rows.length,
      };
    },
  };
  return { context: { db: sdk.getFirestore(), sdk }, log };
}

const alert = (id, over = {}) => ({
  id,
  title: `Notice ${id}`,
  summary: `Summary ${id}`,
  category: "exams",
  status: "published",
  pinned: false,
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  verifiedAt: new Date("2026-10-01T00:00:00Z"),
  verifiedBy: "admin@example.com",
  ...over,
});

// --- the public read --------------------------------------------------------

describe("public alert reads", () => {
  it("covers loading, empty, and failed-read feed view states", () => {
    assert.equal(getPublishedAlertsViewState({ loading: true }), "loading");
    assert.equal(getPublishedAlertsViewState({ alerts: [] }), "empty");
    assert.equal(getPublishedAlertsViewState({ error: true }), "error");
    assert.equal(
      getPublishedAlertsViewState({ alerts: [alert("a1")] }),
      "ready"
    );
  });

  it("queries only the alerts collection for status == published", async () => {
    const { context, log } = makeFake([alert("a1")]);
    await readPublishedAlerts({ context });

    assert.equal(log.queries.length, 1);
    const q = log.queries[0];
    assert.equal(q.path, ALERT_COLLECTION);
    assert.equal(q.path, "alerts");
    const wheres = q.constraints.filter((c) => c.kind === "where");
    assert.equal(wheres.length, 1);
    assert.deepEqual(wheres[0], {
      kind: "where",
      field: "status",
      op: "==",
      value: "published",
    });
  });

  it("never returns a draft even when one exists in the collection", async () => {
    const { context } = makeFake([
      alert("draft-1", { status: "draft", publishedAt: new Date("2026-11-01T00:00:00Z") }),
      alert("pub-1"),
    ]);
    const { alerts, error } = await readPublishedAlerts({ context });

    assert.equal(error, false);
    assert.deepEqual(alerts.map((a) => a.id), ["pub-1"]);
  });

  it("orders pinned notices first, then most recently published", async () => {
    const { context } = makeFake([
      alert("oct1", { publishedAt: new Date("2026-10-01T00:00:00Z") }),
      alert("oct3", { publishedAt: new Date("2026-10-03T00:00:00Z") }),
      alert("pinned", {
        pinned: true,
        publishedAt: new Date("2026-09-20T00:00:00Z"),
      }),
      alert("oct5", { publishedAt: new Date("2026-10-05T00:00:00Z") }),
      // No publishedAt: publication falls back to the document creation time.
      alert("created-later", {
        publishedAt: null,
        createdAt: new Date("2026-10-06T00:00:00Z"),
      }),
    ]);
    const { alerts } = await readPublishedAlerts({ context });

    assert.deepEqual(
      alerts.map((a) => a.id),
      ["pinned", "created-later", "oct5", "oct3", "oct1"]
    );
  });

  it("caps the homepage list at HOME_ALERTS_LIMIT and keeps the newest", async () => {
    const docs = [1, 2, 3, 4, 5].map((n) =>
      alert(`oct${n}`, { publishedAt: new Date(`2026-10-0${n}T00:00:00Z`) })
    );
    const { context } = makeFake(docs);
    const { alerts, error } = await fetchLatestPublishedAlerts({ context });

    assert.equal(error, false);
    assert.equal(alerts.length, HOME_ALERTS_LIMIT);
    // The newest N, oldest dropped.
    assert.deepEqual(
      alerts.map((a) => a.id),
      ["oct5", "oct4", "oct3", "oct2"]
    );
    // The homepage teaser stays a teaser (3-5 cards).
    assert.ok(HOME_ALERTS_LIMIT >= 3 && HOME_ALERTS_LIMIT <= 5);
  });

  it("treats an empty feed as a success, not an error", async () => {
    const { context } = makeFake([]);
    const result = await fetchLatestPublishedAlerts({ context });

    assert.deepEqual(result, { alerts: [], error: false });
  });

  it("reports a failed read as an error instead of a silent empty feed", async () => {
    const { context } = makeFake([alert("a1")], { failCode: "permission-denied" });
    const result = await fetchLatestPublishedAlerts({ context });

    assert.equal(result.error, true);
    assert.deepEqual(result.alerts, []);
  });

  it("exposes the failed-read outcome while the legacy list API stays an array", async () => {
    const { context } = makeFake([], { failCode: "unavailable" });

    assert.deepEqual(await readPublishedAlerts({ context }), {
      alerts: [],
      error: true,
    });
    assert.deepEqual(await fetchPublishedAlerts({ context }), []);
  });

  it("keeps fetchPublishedAlerts' always-an-array contract on failure", async () => {
    const { context } = makeFake([alert("a1")], { failCode: "unavailable" });
    assert.deepEqual(await fetchPublishedAlerts({ context }), []);
  });

  it("degrades to an empty feed when Firebase is not configured", async () => {
    // No injected context: Node has no VITE_FIREBASE_* values, so the real
    // bootstrap resolves to "unconfigured" and nothing is an error.
    const result = await fetchLatestPublishedAlerts();
    assert.deepEqual(result, { alerts: [], error: false });
    assert.deepEqual(await fetchPublishedAlerts(), []);
  });
});

// --- shared formatters ------------------------------------------------------

describe("alert formatters", () => {
  it("reads Firestore timestamps, Dates, ISO strings and epochs", () => {
    const stamp = { toDate: () => new Date("2026-10-01T00:00:00Z") };
    assert.equal(toAlertDate(stamp).toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(
      toAlertDate("2026-10-01T00:00:00Z").toISOString(),
      "2026-10-01T00:00:00.000Z"
    );
    assert.equal(
      toAlertDate(Date.UTC(2026, 9, 1)).toISOString(),
      "2026-10-01T00:00:00.000Z"
    );
    assert.equal(toAlertDate(null), null);
    assert.equal(toAlertDate(""), null);
    assert.equal(toAlertDate("not a date"), null);
    assert.equal(toAlertDate(undefined), null);
  });

  it("renders a calendar date in UTC so a notice never shifts by a day", () => {
    // 23:30 UTC is already the next day in +05:30, so a local-time format
    // would show "2 Oct 2026" for a visitor in India.
    assert.equal(
      formatAlertDay(new Date("2026-10-01T23:30:00Z")),
      "1 Oct 2026"
    );
    assert.equal(
      formatAlertDay(new Date("2026-10-01T00:30:00Z")),
      "1 Oct 2026"
    );
    assert.equal(formatAlertDay(null), "");
    assert.equal(formatAlertDay("nope"), "");
  });

  it("builds the meta line and omits parts the alert does not carry", () => {
    assert.equal(
      alertMetaLine({
        sourceName: "JNTUH Notifications",
        publishedAt: new Date("2026-10-01T00:00:00Z"),
        deadlineAt: new Date("2026-10-09T00:00:00Z"),
      }),
      "Source: JNTUH Notifications • Published 1 Oct 2026 • Deadline 9 Oct 2026"
    );
    assert.equal(
      alertMetaLine({
        publishedAt: new Date("2026-10-01T00:00:00Z"),
        deadlineAt: null,
      }),
      "Published 1 Oct 2026"
    );
    // Publication falls back to createdAt, like the rest of the Alert Radar.
    assert.equal(
      alertMetaLine({ createdAt: new Date("2026-10-02T00:00:00Z") }),
      "Published 2 Oct 2026"
    );
    assert.equal(alertMetaLine({}), "");
    assert.equal(alertMetaLine(), "");
  });
});
