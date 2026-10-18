// ---------------------------------------------------------------------------
// Emulator helper for the two-database rules tests.
//
// The app now uses two Cloud Firestore databases:
//   (default)  public: alerts, analyticsEvents, channels, settings, users
//   staging    collector staging: ingestItems, ingestRuns, ingestSourceHealth
//
// `@firebase/rules-unit-testing` can only load rules into, and clear,
// `(default)` (`initializeTestEnvironment`, `clearFirestore`), and
// firebase-tools logs "Cloud Firestore Emulator does not support multiple
// databases yet". The emulator *binary* shipped with firebase-tools 15.34.0 does
// nonetheless keep named databases separate and honour per-database rules via
// the REST endpoints used below. This module wires that up so the rules tests
// exercise the real two-database layout instead of pretending the emulator has
// only one database.
//
// If a future emulator stops honouring named-database rules or isolation, these
// tests fail loudly (an assertion that expected "allow" sees permission-denied,
// or seeded documents are missing) - they never pass silently.
// ---------------------------------------------------------------------------

import { initializeApp, deleteApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

/** The named staging database. Kept in sync with the app/rules by the tests. */
export const STAGING_DATABASE = "staging";
export const DEFAULT_DATABASE = "(default)";

let seq = 0;
const nextName = (prefix) => `${prefix}-${++seq}`;

/** Parse `FIRESTORE_EMULATOR_HOST` (or a fallback) into `{ host, port }`. */
export function emulatorEndpoint(fallback = "127.0.0.1:8080") {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? fallback;
  const [host, portRaw] = raw.split(":");
  return { host, port: Number(portRaw) };
}

/** The rules REST path. `(default)` has no `/databases/...` segment. */
function rulesPath(projectId, databaseId) {
  return databaseId && databaseId !== DEFAULT_DATABASE
    ? `/emulator/v1/projects/${projectId}/databases/${databaseId}:securityRules`
    : `/emulator/v1/projects/${projectId}:securityRules`;
}

function documentsPath(projectId, databaseId) {
  return `/emulator/v1/projects/${projectId}/databases/${
    databaseId && databaseId !== DEFAULT_DATABASE ? databaseId : DEFAULT_DATABASE
  }/documents`;
}

/**
 * Load a ruleset into one database. `databaseId` may be `(default)` or a named
 * database such as `staging`.
 */
export async function loadRules({ projectId, databaseId, rules, host, port }) {
  const url = `http://${host}:${port}${rulesPath(projectId, databaseId)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: { files: [{ name: "firestore.rules", content: rules }] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `failed to load rules into "${databaseId}": HTTP ${res.status} ${body}`,
    );
  }
}

/** Remove every document from one database (like `clearFirestore`). */
export async function clearDatabase({ projectId, databaseId, host, port }) {
  const url = `http://${host}:${port}${documentsPath(projectId, databaseId)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `failed to clear database "${databaseId}": HTTP ${res.status} ${body}`,
    );
  }
}

/**
 * A rules-enforced client for one database. `uid`/`claims` build the emulator
 * mock token, so `request.auth.token.<claim>` behaves exactly as in production.
 * Omit `uid` for an anonymous client.
 */
export function clientDb({
  projectId,
  databaseId,
  host,
  port,
  uid = null,
  claims = {},
}) {
  const app = initializeApp({ apiKey: "fake-api-key", projectId }, nextName("rules-client"));
  const db =
    databaseId && databaseId !== DEFAULT_DATABASE
      ? getFirestore(app, databaseId)
      : getFirestore(app);
  const mockUserToken = uid ? { sub: uid, user_id: uid, ...claims } : undefined;
  connectFirestoreEmulator(
    db,
    host,
    port,
    mockUserToken ? { mockUserToken } : undefined,
  );
  return {
    app,
    db,
    async cleanup() {
      await deleteApp(app).catch(() => {});
    },
  };
}

/**
 * An Admin-SDK handle for one database. It BYPASSES the rules, exactly like the
 * collector does, so it is only used to seed fixtures and to read back what a
 * client wrote.
 */
export function adminDb({ projectId, databaseId }) {
  const app = initializeAdminApp({ projectId }, nextName("rules-admin"));
  const db =
    databaseId && databaseId !== DEFAULT_DATABASE
      ? getAdminFirestore(app, databaseId)
      : getAdminFirestore(app);
  return {
    app,
    db,
    async cleanup() {
      await deleteAdminApp(app).catch(() => {});
    },
  };
}

/**
 * One database with everything a rules test needs: a rules-enforced client per
 * role (anonymous / non-admin / admin), a rules-bypassing Admin-SDK handle for
 * seeding and reading back, and helpers to seed, read and count. Mirrors the
 * parts of `initializeTestEnvironment` the tests use, for ANY database.
 */
export function makeDbEnv({ projectId, databaseId, host, port }) {
  const admin = adminDb({ projectId, databaseId });
  const clients = {
    anon: clientDb({ projectId, databaseId, host, port }),
    nonAdmin: clientDb({ projectId, databaseId, host, port, uid: "student-1", claims: { admin: false } }),
    admin: clientDb({ projectId, databaseId, host, port, uid: "admin-1", claims: { admin: true } }),
  };
  return {
    databaseId,
    adminDb: admin.db,
    anon: clients.anon.db,
    nonAdmin: clients.nonAdmin.db,
    admin: clients.admin.db,
    /** Seed a two-segment path, bypassing the rules (what the collector does). */
    async seed([collectionName, id], data) {
      await admin.db.collection(collectionName).doc(id).set(data);
    },
    /** Read a two-segment path with the Admin SDK; returns data or null. */
    async get([collectionName, id]) {
      const snap = await admin.db.collection(collectionName).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    /** Every document in a collection, as `{ id, data }`, via the Admin SDK. */
    async docs(collectionName) {
      const snap = await admin.db.collection(collectionName).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    /** The number of documents in a collection, via the Admin SDK. */
    async count(collectionName) {
      const snap = await admin.db.collection(collectionName).get();
      return snap.size;
    },
    async cleanup() {
      await Promise.all([
        ...Object.values(clients).map((c) => c.cleanup()),
        admin.cleanup(),
      ]);
    },
  };
}
