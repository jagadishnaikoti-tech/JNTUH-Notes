// ---------------------------------------------------------------------------
// Collector - Firestore store for staging (ONLY this module imports firebase-admin).
//
// Everything else in the collector that needs Firestore is dependency-injected.
// This file is responsible for:
//   - accepting only the three staging collection names;
//   - connecting ONLY to the `jntuh-notes-staging` project (never production);
//   - reading documents by id in chunks (<=300) with retry;
//   - writing at most 400 operations per batch, retrying only transient errors;
//   - respecting Application Default Credentials, emulator mode and project
//     verification (fail closed);
//   - never reading or writing the public alert collection.
//
// Isolation is by PROJECT: the collector credential is scoped by IAM to
// `jntuh-notes-staging`, and `createIngestStore` refuses the production project
// `jntuh-notes-6ef74` before it creates an app or reads a credential. The
// database is pinned to the staging project's `(default)` database so a typo
// cannot target a named database. There is NO fallback path.
// ---------------------------------------------------------------------------

import { applicationDefault, deleteApp, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  MAX_BATCH_SIZE,
  MAX_READ_SIZE,
  PRODUCTION_PROJECT_ID,
  STAGING_COLLECTIONS,
  STAGING_COLLECTION_NAMES,
  STAGING_DATABASE_ID,
  STAGING_PROJECT_ID,
  chunkOperations,
  isStagingCollection,
  resolveDatabaseId,
} from "./runReport.mjs";

export const APP_NAME = "jntuh-collector";
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_MS = 250;

/** gRPC codes that are typically transient. */
const TRANSIENT_GRPC_CODES = new Set([1, 4, 8, 10, 13, 14]);

/** FirestoreErrorCode (string) names that are typically transient. */
const TRANSIENT_NAMES = new Set([
  "cancelled",
  "deadline-exceeded",
  "resource-exhausted",
  "aborted",
  "internal",
  "unavailable",
]);

/** Node syscall errors that are often transient. */
const TRANSIENT_SYSCALL = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `isTransientFirestoreError` — judge whether it is worth retrying. Unknown
 * errors are NOT marked transient (fail closed).
 */
export function isTransientFirestoreError(error, depth = 0) {
  if (!error || depth > 4) return false;
  const code = error.code ?? error.status ?? error.errno;
  if (typeof code === "number") {
    if (TRANSIENT_GRPC_CODES.has(code)) return true;
  } else if (code !== undefined && code !== null) {
    const text = String(code).trim();
    if (!text) return false;
    const normalised = text.toLowerCase().replace(/[_\s]+/g, "-");
    if (TRANSIENT_NAMES.has(normalised)) return true;
    const upper = text.toUpperCase();
    if (TRANSIENT_SYSCALL.has(upper)) return true;
  }
  if (error.cause && error.cause !== error) {
    return isTransientFirestoreError(error.cause, depth + 1);
  }
  return false;
}

/**
 * Retry `fn` a bounded number of times, with exponential backoff + jitter, only
 * for errors `isRetryable` returns true for.
 */
export async function retryWithBackoff(fn, {
  attempts = RETRY_ATTEMPTS,
  baseMs = RETRY_BASE_MS,
  sleep = defaultSleep,
  rand = Math.random,
  isRetryable = isTransientFirestoreError,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const backoff = baseMs * 2 ** (attempt - 1);
      const jitter = Math.floor(rand() * baseMs);
      await sleep(backoff + jitter);
    }
  }
  throw lastError;
}

/**
 * Decide whether the requested project is acceptable. The collector only ever
 * writes to the staging project (fail closed). The production project is
 * refused unconditionally, even if a caller injects it into `allowed`; the
 * `allowed` set is parametrised only to keep the function testable.
 */
export function resolveProjectId({
  requested = "",
  env = {},
  allowed = [STAGING_PROJECT_ID],
} = {}) {
  const wanted = String(requested ?? "").trim();
  const allowedSet = (Array.isArray(allowed) ? allowed : [])
    .map(String)
    .filter((id) => id !== PRODUCTION_PROJECT_ID);

  if (!wanted) {
    return { ok: false, reason: "no project requested", allowed: allowedSet, wanted: "" };
  }

  // The production project is never a collector target. Refuse it before the
  // allowlist so a misconfigured/injected allowlist cannot widen the boundary.
  if (wanted === PRODUCTION_PROJECT_ID) {
    return {
      ok: false,
      reason: `refusing the production project "${PRODUCTION_PROJECT_ID}": the collector writes only to the staging project "${STAGING_PROJECT_ID}"`,
      allowed: allowedSet,
      wanted,
    };
  }

  if (!allowedSet.includes(wanted)) {
    return {
      ok: false,
      reason: `unknown project "${wanted}" (expected ${allowedSet.join(" or ") || STAGING_PROJECT_ID})`,
      allowed: allowedSet,
      wanted,
    };
  }

  const environment = String(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || "").trim();
  if (environment === PRODUCTION_PROJECT_ID) {
    return {
      ok: false,
      reason: `refusing the production environment "${environment}": the collector writes only to the staging project "${STAGING_PROJECT_ID}"`,
      allowed: allowedSet,
      wanted,
      environment,
    };
  }
  if (environment && environment !== wanted) {
    return {
      ok: false,
      reason: `project mismatch: --project is "${wanted}" but the environment targets "${environment}"`,
      allowed: allowedSet,
      wanted,
      environment,
    };
  }
  return { ok: true, allowed: allowedSet, wanted, environment: environment || null };
}

/** Parse and validate `FIRESTORE_EMULATOR_HOST`. */
export function parseEmulatorHost(env = {}) {
  const raw = String(env.FIRESTORE_EMULATOR_HOST ?? "").trim();
  if (!raw) return { ok: false, reason: "--emulator requires FIRESTORE_EMULATOR_HOST to be set" };
  // Accept "host:port" (port numeric)
  if (!/^[^\s:]+:\d{1,5}$/.test(raw)) return { ok: false, reason: `FIRESTORE_EMULATOR_HOST looks invalid ("${raw}"); expected host:port` };
  return { ok: true, host: raw };
}

function assertCollection(collection) {
  if (!isStagingCollection(collection)) {
    throw new Error(`refusing to touch disallowed collection "${collection}"; allowed: ${STAGING_COLLECTION_NAMES.join(", ")}`);
  }
}

/** Create the narrow-store used by the collector. This is the only place that touches firebase-admin. */
export function createIngestStore({
  projectId,
  databaseId = STAGING_DATABASE_ID,
  emulator = false,
  app = null,
  quiet = false,
  env = process.env,
  allowedProjects = [STAGING_PROJECT_ID],
} = {}) {
  const resolved = resolveProjectId({ requested: projectId, env, allowed: allowedProjects });
  if (!resolved.ok) throw new Error(resolved.reason);

  // Fail closed on the database too: only the staging project's primary
  // database is acceptable. Named databases are refused rather than silently
  // targeted by a typo.
  const resolvedDatabaseId = resolveDatabaseId(databaseId);

  if (emulator) {
    const parsed = parseEmulatorHost(env);
    if (!parsed.ok) throw new Error(parsed.reason);
  } else {
    if (String(env.FIRESTORE_EMULATOR_HOST ?? "").trim()) {
      throw new Error("refusing a live store while FIRESTORE_EMULATOR_HOST is set");
    }
  }

  const requestedProject = resolved.wanted;
  const hasExistingApp = getApps().some((candidate) => candidate.name === APP_NAME);
  let firebaseApp = app;
  if (!firebaseApp) {
    firebaseApp = hasExistingApp ? getApp(APP_NAME) : initializeApp(
      emulator
        ? { projectId: requestedProject }
        : { credential: applicationDefault(), projectId: requestedProject },
      APP_NAME,
    );
  }

  // The database id is passed explicitly. It is the staging project's
  // `(default)` database; the project, not the database name, is the boundary.
  const db = getFirestore(firebaseApp, resolvedDatabaseId);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    if (!quiet) {
      // Ignore re-initialisation of settings; other errors bubble up.
      const message = String(error?.message ?? error ?? "");
      if (!/already been initialized/i.test(message)) throw error;
    }
  }

  if (firebaseApp.options.projectId !== requestedProject) {
    throw new Error(`project id mismatch after initialisation (requested "${requestedProject}", got "${firebaseApp.options.projectId}")`);
  }

  if (db.databaseId && db.databaseId !== resolvedDatabaseId) {
    throw new Error(`database id mismatch after initialisation (requested "${resolvedDatabaseId}", got "${db.databaseId}")`);
  }

  async function readStaging(collection, ids) {
    assertCollection(collection);
    // `ids` may be an array or a Set: itemIdsForSources() returns a Set and
    // index.mjs hands that straight to readItems.
    const unique = [...new Set(Array.from(ids ?? []).filter(Boolean).map(String))];
    const found = new Map();
    if (unique.length === 0) return found;
    const chunks = chunkOperations(unique, MAX_READ_SIZE);
    for (const chunk of chunks) {
      const refs = chunk.map((id) => db.collection(collection).doc(id));
      const snaps = await retryWithBackoff(() => db.getAll(...refs));
      for (const snap of snaps) {
        if (snap.exists) found.set(snap.id, snap.data());
      }
    }
    return found;
  }

  function readItems(ids) {
    return readStaging(STAGING_COLLECTIONS.ITEMS, ids);
  }

  function readSourceHealth(ids) {
    return readStaging(STAGING_COLLECTIONS.HEALTH, ids);
  }

  function readRuns(ids) {
    return readStaging(STAGING_COLLECTIONS.RUNS, ids);
  }

  async function commitMutations(mutations) {
    const list = Array.isArray(mutations) ? mutations : [];
    for (const mut of list) {
      assertCollection(mut?.collection);
      if (!mut || typeof mut.id !== "string" || !mut.id) {
        throw new Error("mutations must each carry a non-empty string id");
      }
    }
    const batches = chunkOperations(list, MAX_BATCH_SIZE);
    let operations = 0;
    for (const chunk of batches) {
      await retryWithBackoff(() => {
        const batch = db.batch();
        for (const mut of chunk) {
          const ref = db.collection(mut.collection).doc(mut.id);
          if (mut.delete) {
            batch.delete(ref);
          } else if (mut.merge === false) {
            batch.set(ref, mut.data ?? {});
          } else {
            batch.set(ref, mut.data ?? {}, { merge: true });
          }
        }
        return batch.commit();
      });
      operations += chunk.length;
    }
    return { operations, batches: batches.length };
  }

  async function close() {
    try {
      await deleteApp(firebaseApp);
    } catch (error) {
      if (!quiet) {
        const message = String(error?.message ?? error ?? "");
        if (!/no firebase app/i.test(message)) throw error;
      }
    }
  }

  return {
    projectId: requestedProject,
    databaseId: resolvedDatabaseId,
    mode: emulator ? "emulator" : "live",
    isEmulator: emulator,
    db,
    firebaseApp,
    readStaging,
    readItems,
    readSourceHealth,
    readRuns,
    commitMutations,
    close,
  };
}
