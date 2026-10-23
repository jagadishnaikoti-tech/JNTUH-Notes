// ---------------------------------------------------------------------------
// Collector - ingestion run reports, source health and shared vocabulary.
//
// Everything in this module is PURE: no clock reads (timestamps are passed in),
// no network, no filesystem, no Firebase. That is deliberate - both the CLI
// (which must never load the Admin SDK on a dry run) and the Firestore store
// import this module, so it has to stay dependency-free.
//
// It owns three things:
//   1. the shared vocabulary the collector agrees on (collection names, run and
//      source statuses, the Firestore batch limit, the intended project id);
//   2. the "what happened?" builders - run documents and per-source health
//      documents, including the consecutive-failure rule;
//   3. small safety helpers - batch chunking, error sanitisation and the
//      idempotency predicate.
// ---------------------------------------------------------------------------

/** Firestore allows 500 writes per batch; we stay at 400 for headroom. */
export const MAX_BATCH_SIZE = 400;

/** Reads are fetched in chunks too, to keep a single request modest. */
export const MAX_READ_SIZE = 300;

/**
 * The one Firebase project this collector is allowed to write to. A write run
 * refuses to start if `--project` names anything else (fail closed).
 */
export const STAGING_PROJECT_ID = "jntuh-notes-staging";

/**
 * The production Firebase project. The collector must never receive credentials
 * for it, and every collector path refuses it explicitly even if a caller asks.
 */
export const PRODUCTION_PROJECT_ID = "jntuh-notes-6ef74";

/**
 * Alias kept for call sites that mean "the project this collector is intended
 * for". It is the STAGING project, never production.
 */
export const INTENDED_PROJECT_ID = STAGING_PROJECT_ID;

/**
 * The staging project's primary Firestore database. Staging is isolated by
 * PROJECT, not by a named database: the collector credential has IAM only on
 * `jntuh-notes-staging`, so it cannot reach the public `alerts` collection in
 * `jntuh-notes-6ef74` even though both projects use `(default)`.
 *
 * The id is still pinned in code: `resolveDatabaseId()` accepts only
 * `(default)`, so a typo cannot silently target a named database in the staging
 * project.
 */
export const STAGING_DATABASE_ID = "(default)";

/**
 * Validate a Firestore database id for the collector. The collector is pinned to
 * the staging project's primary database, so this returns
 * `STAGING_DATABASE_ID` or throws. Named databases are refused; the project
 * boundary (not the database name) is what keeps production unreachable.
 */
export function resolveDatabaseId(requested = STAGING_DATABASE_ID) {
  const id = String(requested ?? "").trim();
  if (!id) {
    throw new Error(
      `A database id is required: the collector writes only to "${STAGING_DATABASE_ID}" in the staging project "${STAGING_PROJECT_ID}".`
    );
  }
  if (id !== STAGING_DATABASE_ID) {
    throw new Error(
      `Refusing Firestore database "${id}": the collector is pinned to "${STAGING_DATABASE_ID}" in the staging project "${STAGING_PROJECT_ID}" (staging is isolated by project, not by database name).`
    );
  }
  return id;
}

/**
 * The ONLY collections the collector may touch. The public alert collection is
 * deliberately absent and must never appear here: the collector stages notices
 * for a human to promote; it never creates, verifies or publishes an alert.
 */
export const STAGING_COLLECTIONS = Object.freeze({
  ITEMS: "ingestItems",
  RUNS: "ingestRuns",
  HEALTH: "ingestSourceHealth",
});

export const STAGING_COLLECTION_NAMES = Object.freeze(Object.values(STAGING_COLLECTIONS));

/** True when `name` is one of the three permitted staging collections. */
export function isStagingCollection(name) {
  return STAGING_COLLECTION_NAMES.includes(name);
}

/** Lifecycle of one ingestion run. */
export const RUN_STATUS = Object.freeze({
  RUNNING: "running",
  OK: "ok",
  PARTIAL: "partial",
  FAILED: "failed",
});

/** Rolling health of one source. */
export const SOURCE_STATUS = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
  BROKEN: "broken",
  UNKNOWN: "unknown",
});

/** What one source did during one run. */
export const SOURCE_OUTCOME = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
  FAILED: "failed",
  SKIPPED: "skipped",
});

/** Consecutive failures before a source is reported as broken. */
export const BROKEN_AFTER_FAILURES = 3;

/**
 * Ceilings the writer refuses to cross. `maxOperations` is a whole-run stop:
 * if a run wants more writes than this, something is wrong and nothing is
 * written. The swing limits are per-source (see `isSuspiciousSwing`).
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxOperations: 1000,
  swingFactor: 5,
  swingFloor: 50,
  swingMinHistory: 10,
});

export const SCHEMA_VERSION = 1;

/**
 * Split `operations` into batches of at most `size` (default, and maximum, 400).
 * A size above `MAX_BATCH_SIZE` is a programming error, not a silent clamp.
 *
 * @param {Array} operations
 * @param {number} [size]
 * @returns {Array<Array>}
 */
export function chunkOperations(operations, size = MAX_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`batch size must be a positive integer (got ${size})`);
  }
  if (size > MAX_BATCH_SIZE) {
    throw new RangeError(`batch size must not exceed ${MAX_BATCH_SIZE} (got ${size})`);
  }
  const list = Array.isArray(operations) ? operations : [];
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

/**
 * True when `stored` already records this run - the guard that makes a retry or
 * a re-run of the same run id a no-op instead of a double count.
 */
export function alreadyApplied(stored, runId) {
  if (!stored || !runId) return false;
  return stored.lastRunId === runId;
}

/**
 * Strip anything that could carry a secret out of an error before it is stored
 * or printed: private keys, bearer tokens, service-account JSON members, key
 * file paths and long base64 blobs. The result is always short and boring.
 *
 * @param {unknown} error
 * @returns {{code: string, message: string, phase: string}|null}
 */
export function sanitiseError(error) {
  if (!error) return null;
  const raw = typeof error === "string" ? error : error?.message ?? String(error);
  const code = String(error?.code ?? "").trim().slice(0, 60);
  const phase = String(error?.phase ?? "").trim().slice(0, 40);

  let text = String(raw ?? "");
  text = text.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-pem]"); // PEM blocks
  text = text.replace(/[\w./\\-]*firebase-adminsdk[\w./\\-]*\.json/gi, "[redacted-keyfile]");
  text = text.replace(
    /"?(?:private_key|private_key_id|client_email|client_id|refresh_token|access_token|id_token)"?\s*[:=]\s*"?[^",\s}]*/gi,
    "[redacted-field]",
  );
  text = text.replace(
    /\b(?:bearer|basic|apikey|api[_-]?key)\b\s*[:=]?\s*[A-Za-z0-9\-._~+/=]{8,}/gi,
    "[redacted-token]",
  );
  text = text.replace(/\b[A-Za-z0-9+/]{64,}={0,2}\b/g, "[redacted-blob]"); // long base64

  text = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) text = "unknown error";

  return { code, message: text, phase };
}

/** Keep a stored actor identifier short and single-line. */
export function sanitiseActor(value) {
  return String(value ?? "").replace(/[\s]+/g, " ").trim().slice(0, 200);
}

/**
 * Run status from the per-source outcomes.
 * Every source failing is `failed`; anything less than "all clean" is `partial`.
 */
export function computeRunStatus(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  if (list.length === 0) return RUN_STATUS.FAILED;

  const failed = list.filter((outcome) => outcome === SOURCE_OUTCOME.FAILED).length;
  if (failed === list.length) return RUN_STATUS.FAILED;
  if (failed > 0 || list.some((o) => o === SOURCE_OUTCOME.DEGRADED || o === SOURCE_OUTCOME.SKIPPED)) {
    return RUN_STATUS.PARTIAL;
  }
  return RUN_STATUS.OK;
}

/**
 * A source is "suspicious" when it suddenly reports far more notices than the
 * previous run. `previous` needs real history first (>= swingMinHistory) and the
 * new total has to clear an absolute floor (swingFloor), so a source going from
 * 1 to 9 notices is never flagged.
 */
export function isSuspiciousSwing(previous, current, limits = DEFAULT_LIMITS) {
  const { swingFactor, swingFloor, swingMinHistory } = { ...DEFAULT_LIMITS, ...limits };
  const before = Number(previous);
  const now = Number(current);
  if (!Number.isFinite(before) || !Number.isFinite(now)) return false;
  if (before < swingMinHistory) return false;
  if (now <= swingFloor) return false;
  return now > before * swingFactor;
}

/**
 * Fold one source outcome into its rolling health document.
 *
 * A failure increments `consecutiveFailures`; three in a row reports `broken`.
 * A success clears the counter. A `skipped` source (write refused by the swing
 * guard) is reported `degraded` but does not count as a scrape failure.
 *
 * @param {object|undefined} previous stored health document, if any
 * @param {{status: string, error?: unknown, notices?: number, warnings?: number,
 *          fingerprint?: string|null}} outcome
 * @param {{sourceId: string, runId: string, at: Date, projectId?: string}} context
 * @returns {object} the health document to merge
 */
export function nextSourceHealth(previous, outcome, context) {
  const { sourceId, runId, at } = context;
  const status = outcome?.status ?? SOURCE_OUTCOME.FAILED;

  const priorFailures = Number(previous?.consecutiveFailures) || 0;
  const priorRuns = Number(previous?.totalRuns) || 0;
  const priorFailuresTotal = Number(previous?.totalFailures) || 0;

  let consecutiveFailures;
  let health;
  let lastSuccessAt = previous?.lastSuccessAt ?? null;

  if (status === SOURCE_OUTCOME.FAILED) {
    consecutiveFailures = priorFailures + 1;
    health = consecutiveFailures >= BROKEN_AFTER_FAILURES ? SOURCE_STATUS.BROKEN : SOURCE_STATUS.DEGRADED;
  } else if (status === SOURCE_OUTCOME.SKIPPED) {
    // The page was read fine; we chose not to write it. Not a scrape failure.
    consecutiveFailures = priorFailures;
    health = SOURCE_STATUS.DEGRADED;
    lastSuccessAt = at;
  } else {
    consecutiveFailures = 0;
    health = status === SOURCE_OUTCOME.DEGRADED ? SOURCE_STATUS.DEGRADED : SOURCE_STATUS.OK;
    lastSuccessAt = at;
  }

  return {
    sourceId,
    schemaVersion: SCHEMA_VERSION,
    status: health,
    lastOutcome: status,
    lastRunId: runId,
    lastRunAt: at,
    lastSuccessAt,
    consecutiveFailures,
    totalRuns: priorRuns + 1,
    totalFailures: priorFailuresTotal + (status === SOURCE_OUTCOME.FAILED ? 1 : 0),
    lastNotices: Number(outcome?.notices) || 0,
    lastWarnings: Number(outcome?.warnings) || 0,
    lastFingerprint: outcome?.fingerprint ?? previous?.lastFingerprint ?? null,
    lastError: sanitiseError(outcome?.error),
    updatedAt: at,
  };
}

/** A zeroed counter block, so a run document always has the same shape. */
export function emptyCounts() {
  return {
    sources: 0,
    sourcesOk: 0,
    sourcesDegraded: 0,
    sourcesFailed: 0,
    sourcesRefused: 0,
    notices: 0,
    duplicates: 0,
    warnings: 0,
    itemsCreated: 0,
    itemsRefreshed: 0,
    itemsChanged: 0,
    itemsDeferred: 0,
    itemsUnaddressable: 0,
    itemsSkipped: 0,
    healthDocuments: 0,
    mutations: 0,
    operations: 0,
    batches: 0,
  };
}

/**
 * Build the run document for either phase. `status` is `running` while the run
 * is in flight and is rewritten once the outcome is known.
 *
 * @param {object} input
 * @returns {object}
 */
export function buildRunDocument({
  runId,
  status,
  startedAt,
  finishedAt = null,
  trigger = "manual",
  actor = "",
  commitSha = "",
  collectorVersion = "unknown",
  dryRun = true,
  projectId = "",
  databaseId = "",
  mode = "dry-run",
  error = null,
  sources = [],
  counts = emptyCounts(),
  warnings = [],
}) {
  const finished = finishedAt instanceof Date ? finishedAt : null;
  const started = startedAt instanceof Date ? startedAt : null;
  const durationMs = finished && started ? Math.max(0, finished.getTime() - started.getTime()) : null;

  return {
    runId,
    schemaVersion: SCHEMA_VERSION,
    status,
    trigger: String(trigger ?? "manual").slice(0, 40),
    actor: sanitiseActor(actor),
    commitSha: /^[0-9a-f]{7,40}$/i.test(String(commitSha ?? "")) ? String(commitSha) : "",
    collectorVersion: String(collectorVersion ?? "unknown").slice(0, 40),
    dryRun: Boolean(dryRun),
    projectId: String(projectId ?? "").slice(0, 80),
    databaseId: String(databaseId ?? "").slice(0, 80),
    mode: String(mode ?? "").slice(0, 20),
    startedAt: started,
    finishedAt: finished,
    durationMs,
    sources: Array.isArray(sources) ? sources : [],
    counts: { ...emptyCounts(), ...(counts ?? {}) },
    warnings: (Array.isArray(warnings) ? warnings : []).slice(0, 50).map((w) => String(w).slice(0, 300)),
    error: sanitiseError(error),
  };
}
