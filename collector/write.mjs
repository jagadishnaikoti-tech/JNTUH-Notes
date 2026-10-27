// ---------------------------------------------------------------------------
// Collector - ingestion orchestration (plan + execute).
//
// `write.mjs` produces the concrete Firestore mutations (for ingestItems,
// ingestRuns and ingestSourceHealth) and executes them against an injected store.
// It imports only dependency-free modules: ingestPlan, ingestIds, runReport.
// The Admin SDK lives entirely in firestoreAdmin.mjs and is never imported here.
// ---------------------------------------------------------------------------

import { ingestItemId } from "./lib/ingestIds.mjs";
import { planIngest } from "./lib/ingestPlan.mjs";
import {
  BROKEN_AFTER_FAILURES,
  DEFAULT_LIMITS,
  MAX_BATCH_SIZE,
  RUN_STATUS,
  SOURCE_OUTCOME,
  SOURCE_STATUS,
  STAGING_COLLECTIONS,
  buildRunDocument,
  chunkOperations,
  computeRunStatus,
  emptyCounts,
  isSuspiciousSwing,
  nextSourceHealth,
} from "./lib/runReport.mjs";

export { STAGING_COLLECTIONS } from "./lib/runReport.mjs";

export const MAX_OPERATIONS_PER_RUN = 1000;

const DEFAULT_ITEM_MAX_NEW = 300;

/**
 * Error code stored on a run document when the run was recorded as `running`
 * but a later write (item/health mutations or the final status) failed.
 */
export const RUN_WRITE_FAILED = "RUN_WRITE_FAILED";

/**
 * Resolve a caller-injected clock to a single valid Date. `now` may be a Date or
 * a function returning one; it is evaluated exactly once. Anything that is not a
 * valid Date (an Invalid Date, a non-Date value) falls back to the current time,
 * so a run is never stamped with garbage.
 */
function resolveTimestamp(now) {
  const candidate = typeof now === "function" ? now() : now;
  return candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate : new Date();
}

/**
 * Derive the deterministic ingestion id for every notice in `sources`.
 * Returns the set (useful for reads) and the flat list of (sourceId, notice)
 * with their ids.
 */
export function itemIdsForSources(sources) {
  const pairs = [];
  const ids = new Set();
  const list = Array.isArray(sources) ? sources : [];
  for (const src of list) {
    const notices = Array.isArray(src.notices) ? src.notices : [];
    for (const notice of notices) {
      const id = ingestItemId(notice?.sourceId, notice?.canonicalUrl);
      if (id) {
        ids.add(id);
        pairs.push({ sourceId: src.id, notice, id });
      }
      // items without an id are unaddressable — planIngest will report them
    }
  }
  return { ids, pairs };
}

/**
 * Create a compact, human-sortable run id. For tests the caller may inject
 * `nonce`/`ts`; in production use `randomUUID`.
 */
export function createRunId({ at = new Date(), nonce } = {}) {
  const ts = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
  const timePart = ts
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z"); // YYYYMMDDTHHMMSSZ
  const suffix = typeof nonce === "string" && nonce
    ? nonce.replace(/[^a-z0-9_-]/gi, "").slice(0, 10)
    : "";
  return suffix ? `${timePart}-${suffix}` : timePart;
}

/** Sanitize a single-line reason string. */
function reasonString(text) {
  return String(text ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

/** Fold planIngest stats into counters. */
function addItemPlanCounts(target, stats) {
  target.itemsPlanned += Number(stats.planned) || 0;
  target.itemsCreated += Number(stats.created) || 0;
  target.itemsRefreshed += Number(stats.refreshed) || 0;
  target.itemsChanged += Number(stats.changed) || 0;
  target.itemsDeferred += Number(stats.deferred) || 0;
  target.itemsUnaddressable += Number(stats.unaddressable) || 0;
  return target;
}

/** Build the per-source run summary that is written into the run document. */
function sourceRunSummary(src, outcome, planStats, refused) {
  const result = src;
  return {
    sourceId: result.id,
    name: result.name,
    outcome,
    status: result.status,
    notices: Number(result.notices?.length) || 0,
    duplicates: Number(result.duplicates?.length) || 0,
    warnings: Number(result.warnings?.length) || 0,
    drafts: Number(result.drafts) || 0,
    draftProblems: Number(result.draftProblems) || 0,
    itemsCreated: Number(planStats.created) || 0,
    itemsRefreshed: Number(planStats.refreshed) || 0,
    itemsChanged: Number(planStats.changed) || 0,
    itemsDeferred: Number(planStats.deferred) || 0,
    error: result.error ?? null,
    ...(refused ? { refused: true, refusalReason: reasonString(refused.reason) } : {}),
  };
}

/**
 * Plan the entire run. This is PURE (no I/O): it reads from the provided maps
 * of existing docs, decides which sources to skip (suspicious swing), computes
 * item + health mutations and the final status.
 */
export function planRun({
  sources = [],
  existingItems = new Map(),
  existingHealth = new Map(),
  runId,
  startedAt,
  trigger = "manual",
  actor = "",
  commitSha = "",
  collectorVersion = "unknown",
  dryRun = true,
  projectId = "",
  databaseId = "",
  maxItems = 0,
  limits = DEFAULT_LIMITS,
  now = () => new Date(),
  itemMaxNew = DEFAULT_ITEM_MAX_NEW,
} = {}) {
  const at = startedAt instanceof Date ? startedAt : new Date();
  const tsNow = resolveTimestamp(now);
  const counts = emptyCounts();
  const mutations = [];
  const itemDocuments = [];
  const healthDocuments = [];
  const refusedSources = [];
  const warnings = [];
  const outcomes = [];
  const sourceSummaries = [];

  const idLookup = existingItems instanceof Map ? existingItems : new Map(Object.entries(existingItems || {}));
  const healthLookup = existingHealth instanceof Map ? existingHealth : new Map(Object.entries(existingHealth || {}));

  for (const src of sources) {
    const sourceId = src.id;
    const previousHealth = healthLookup.get(sourceId) || null;
    const previousNotices = Number(previousHealth?.lastNotices) || 0;
    const currentNotices = Number(src.notices?.length) || 0;

    // Suspicious swing guard (per-source, preserves isolation).
    if (isSuspiciousSwing(previousNotices, currentNotices, limits)) {
      const reason = `suspicious notice count swing: previous=${previousNotices}, current=${currentNotices} (skipping writes for ${sourceId})`;
      refusedSources.push({ sourceId, reason });
      warnings.push(reason);
      const outcome = SOURCE_OUTCOME.SKIPPED;
      const healthDoc = nextSourceHealth(previousHealth, {
        status: outcome,
        notices: currentNotices,
        warnings: Number(src.warnings?.length) || 0,
        fingerprint: src.fingerprint ?? null,
        error: src.error ?? null,
      }, { sourceId, runId, at: tsNow, projectId });
      healthDocuments.push({ id: sourceId, collection: STAGING_COLLECTIONS.HEALTH, data: healthDoc, merge: true });
      mutations.push({ collection: STAGING_COLLECTIONS.HEALTH, id: sourceId, data: healthDoc, merge: true });
      sourceSummaries.push(sourceRunSummary(src, outcome, { created: 0, refreshed: 0, changed: 0, deferred: 0 }, { reason }));
      outcomes.push(outcome);
      counts.sources += 1;
      counts.sourcesRefused += 1;
      continue;
    }

    // Plan this source's items.
    const itemMax = maxItems > 0 ? maxItems : itemMaxNew;
    const plan = planIngest(src.notices || [], {
      existing: idLookup,
      runId,
      now: tsNow,
      maxItems: itemMax,
      sourceId: src.id,
    });

    const outcome = src.status === "ok" ? SOURCE_OUTCOME.OK : (src.status === "error" ? SOURCE_OUTCOME.FAILED : SOURCE_OUTCOME.DEGRADED);

    // Apply idempotency guard: items that already have this runId are skipped.
    const skippedAlready = [];
    for (const doc of plan.documents) {
      const stored = idLookup.get(doc.itemId);
      if (stored && stored.lastRunId === runId) {
        skippedAlready.push(doc.itemId);
        continue;
      }
      itemDocuments.push(doc);
      mutations.push({ collection: STAGING_COLLECTIONS.ITEMS, id: doc.itemId, data: doc, merge: true });
    }
    counts.itemsSkipped += skippedAlready.length;

    // Health document
    const healthDoc = nextSourceHealth(previousHealth, {
      status: outcome,
      notices: currentNotices,
      warnings: Number(src.warnings?.length) || 0,
      fingerprint: src.fingerprint ?? null,
      error: src.error ?? null,
    }, { sourceId, runId, at: tsNow, projectId });
    healthDocuments.push({ id: sourceId, collection: STAGING_COLLECTIONS.HEALTH, data: healthDoc, merge: true });
    mutations.push({ collection: STAGING_COLLECTIONS.HEALTH, id: sourceId, data: healthDoc, merge: true });

    sourceSummaries.push(sourceRunSummary(src, outcome, plan.stats, null));
    outcomes.push(outcome);
    counts.sources += 1;
    if (outcome === SOURCE_OUTCOME.OK) counts.sourcesOk += 1;
    else if (outcome === SOURCE_OUTCOME.DEGRADED || outcome === SOURCE_OUTCOME.SKIPPED) counts.sourcesDegraded += 1;
    else counts.sourcesFailed += 1;
    addItemPlanCounts(counts, plan.stats);
    counts.notices += currentNotices;
    counts.duplicates += Number(src.duplicates?.length) || 0;
    counts.warnings += Number(src.warnings?.length) || 0;
  }

  const operations = mutations.length;
  const batches = chunkOperations(mutations, MAX_BATCH_SIZE).length;

  if (operations > (limits.maxOperations ?? MAX_OPERATIONS_PER_RUN)) {
    const reason = `operation cap exceeded: ${operations} > ${limits.maxOperations ?? MAX_OPERATIONS_PER_RUN}`;
    return {
      runId,
      status: RUN_STATUS.FAILED,
      refused: true,
      refusalReason: reason,
      dryRun: Boolean(dryRun),
      counts: { ...emptyCounts(), sources: counts.sources, operations, batches },
      runDocument: buildRunDocument({
        runId, status: RUN_STATUS.FAILED, startedAt: at, trigger, actor, commitSha, collectorVersion, dryRun, projectId, databaseId, mode: dryRun ? "dry-run" : "write", sources: sourceSummaries, counts: { ...counts, operations, batches }, warnings, error: { message: reason, code: "OPERATION_CAP_EXCEEDED" },
      }),
      healthDocuments, itemDocuments, mutations, refusedSources, warnings, outcomes, sourceSummaries,
      itemPlanStats: counts,
    };
  }

  const runStatus = computeRunStatus(outcomes);
  const runDocument = buildRunDocument({
    runId, status: runStatus, startedAt: at, trigger, actor, commitSha, collectorVersion, dryRun, projectId, databaseId, mode: dryRun ? "dry-run" : "write", sources: sourceSummaries, counts: { ...counts, operations, batches }, warnings, error: null,
  });

  return {
    runId,
    status: runStatus,
    refused: false,
    dryRun: Boolean(dryRun),
    counts: { ...counts, operations, batches },
    runDocument,
    healthDocuments,
    itemDocuments,
    mutations,
    refusedSources,
    warnings,
    outcomes,
    sourceSummaries,
    itemPlanStats: counts,
  };
}

/**
 * Execute the planned run against the injected store. Writes a `running` run
 * document first, then item + health mutations, then the final run document.
 *
 * A dry-run plan (`plan.dryRun === true`) is refused up front: the store is
 * never touched, so a read-only plan can never cause a write.
 *
 * Failure handling: if the `running` record itself cannot be written the run was
 * never recorded, so the error is propagated and nothing else is attempted. If a
 * later write fails, the run is marked `failed` (with a sanitised error) and the
 * original error is re-thrown. Batches are not transactional across the whole
 * run, so writes that already committed are deliberately left in place - there
 * is no unsafe rollback.
 */
export async function executeRun({
  plan,
  store,
  now = () => new Date(),
  writeRunning = true,
} = {}) {
  if (!store || typeof store.commitMutations !== "function" || typeof store.readItems !== "function") {
    throw new Error("executeRun requires a store with commitMutations and readItems");
  }
  const finishedAt = resolveTimestamp(now);
  const runId = plan?.runId;
  if (!runId) throw new Error("plan.runId is required");

  // A dry-run plan must never reach the store. Refuse before the initial
  // `running` record (or any other mutation) so a caller can never turn a
  // read-only plan into writes.
  if (plan.dryRun === true) {
    throw new Error(`refusing to execute a dry-run plan (runId ${runId}): no store writes are permitted`);
  }

  let runningRecorded = false;
  try {
    if (writeRunning) {
      const runningDoc = buildRunDocument({
        ...plan.runDocument,
        status: RUN_STATUS.RUNNING,
        finishedAt: null,
      });
      await store.commitMutations([{ collection: STAGING_COLLECTIONS.RUNS, id: runId, data: runningDoc, merge: true }]);
      runningRecorded = true;
    }

    if (Array.isArray(plan.mutations) && plan.mutations.length > 0) {
      await store.commitMutations(plan.mutations);
    }

    const finalDoc = buildRunDocument({
      ...plan.runDocument,
      status: plan.refused ? RUN_STATUS.FAILED : plan.status,
      finishedAt,
    });
    await store.commitMutations([{ collection: STAGING_COLLECTIONS.RUNS, id: runId, data: finalDoc, merge: true }]);

    return { finalDoc, runId, status: finalDoc.status };
  } catch (error) {
    // Only a run whose `running` record already landed can be marked failed. A
    // run that never started is reported by re-throwing alone - we must not
    // claim it was recorded when it was not.
    if (runningRecorded) {
      try {
        const failedDoc = buildRunDocument({
          ...plan.runDocument,
          status: RUN_STATUS.FAILED,
          finishedAt,
          error: { code: RUN_WRITE_FAILED, phase: "write", message: error?.message ?? String(error) },
        });
        await store.commitMutations([{ collection: STAGING_COLLECTIONS.RUNS, id: runId, data: failedDoc, merge: true }]);
      } catch {
        // Recording the failure failed too. Keep it simple and honest: surface
        // the original error to the caller rather than replacing or hiding it.
      }
    }
    throw error;
  }
}