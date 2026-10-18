#!/usr/bin/env node
// ---------------------------------------------------------------------------
// JNTUH Alert Radar collector
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";

import notifications from "./sources/notifications.mjs";
import exams from "./sources/exams.mjs";
import { dedupeByCanonicalUrl } from "./lib/dedup.mjs";
import { formatDateUtc } from "./lib/date.mjs";
import {
  DEFAULT_GAP_MS,
  DEFAULT_TIMEOUT_MS,
  createRateLimiter,
} from "./lib/http.mjs";
import { SourceError, isSourceFailure } from "./lib/errors.mjs";
import { DraftError, toAlertDraft } from "./lib/alertDraft.mjs";
import { structureFingerprint } from "./lib/ingestIds.mjs";
import {
  INTENDED_PROJECT_ID,
  RUN_STATUS,
  SOURCE_OUTCOME,
  STAGING_DATABASE_ID,
} from "./lib/runReport.mjs";

/** Every adapter is registered here; adding a source is one import + one line. */
const REGISTRY = [notifications, exams];

const USAGE = `
JNTUH Alert Radar collector

  node collector/index.mjs [options]
  npm run collector

Options
  --source <id>          Only run one source (repeatable). Ids: ${REGISTRY.map((m) => m.SOURCE.id).join(", ")}
                          Default: all sources.
  --limit <n>            Print at most <n> notices per source (0 = all, default 0).
  --timeout <ms>         Per-request timeout (default ${DEFAULT_TIMEOUT_MS}).
  --gap <ms>             Minimum delay between HTTP requests (default ${DEFAULT_GAP_MS}).
  --panes <a,b>          Exam portal panes to collect (default notification).
                          Values: notification, timetable, others.
  --baseline <file>      Read previously seen keys from a JSON file for cross-run
                          duplicate detection (read-only).
  --offline <dir>        Read "<sourceId>.html" from <dir> instead of the network
                          (used by tests and CI smoke checks).
  --json                 Emit machine-readable JSON instead of the text report.
  -h, --help             Show this help.

Write-mode options (guarded)
  --write                Enable staging writes to Firestore.
  --project <project-id> Required when --write is set. Must equal ${INTENDED_PROJECT_ID}.
  --allow-production     Required for non-emulator writes.
  --emulator             Use Firestore emulator (requires FIRESTORE_EMULATOR_HOST).
  --max-items <number>   Cap newly created items per run (applied to write path).

Staging target
  Every write goes to the named Firestore database "${STAGING_DATABASE_ID}", never to
  "(default)". The public alert collection lives in "(default)" and is out of
  reach for this collector. The database id is not a flag: it is pinned, so a
  caller cannot redirect staging into the public database (fail closed).

Defaults
  Dry run (no writes) unless --write is given. Production writes require both
  --project and --allow-production and must not have FIRESTORE_EMULATOR_HOST set.
  Emulator writes require --emulator and FIRESTORE_EMULATOR_HOST.
`;

function fail(message, code = 2) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function parseCli() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        source: { type: "string", multiple: true },
        limit: { type: "string" },
        timeout: { type: "string" },
        gap: { type: "string" },
        panes: { type: "string" },
        baseline: { type: "string" },
        offline: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        write: { type: "boolean", default: false },
        project: { type: "string" },
        "allow-production": { type: "boolean", default: false },
        emulator: { type: "boolean", default: false },
        "max-items": { type: "string" },
      },
      allowPositionals: false,
    });
  } catch (error) {
    fail(error.message);
  }

  const { values } = parsed;
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const int = (raw, fallback, name) => {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) fail(`--${name} must be a non-negative integer`);
    return value;
  };

  const requested = values.source?.length ? values.source : REGISTRY.map((m) => m.SOURCE.id);
  const known = new Set(REGISTRY.map((m) => m.SOURCE.id));
  for (const id of requested) {
    if (!known.has(id)) fail(`unknown source "${id}" (known: ${[...known].join(", ")})`);
  }

  const allowProduction = values["allow-production"] ?? false;
  const emulator = values.emulator ?? false;
  const write = values.write ?? false;
  const project = values.project?.trim();

  if (allowProduction && !write) fail("--allow-production requires --write");
  if (emulator && !write) fail("--emulator requires --write");

  if (write) {
    if (!project) fail("--write requires --project <project-id>");
    if (project !== INTENDED_PROJECT_ID) fail(`refusing to write to unknown project "${project}" (expected ${INTENDED_PROJECT_ID})`);
    if (emulator) {
      if (allowProduction) fail("--emulator cannot be combined with --allow-production");
      const host = String(process.env.FIRESTORE_EMULATOR_HOST ?? "").trim();
      if (!host) fail("--emulator requires FIRESTORE_EMULATOR_HOST to be set");
    } else {
      if (!allowProduction) fail("production writes require --allow-production");
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        fail("refusing production write while FIRESTORE_EMULATOR_HOST is set");
      }
    }
  }

  return {
    sources: [...new Set(requested)],
    limit: int(values.limit, 0, "limit"),
    timeoutMs: int(values.timeout, DEFAULT_TIMEOUT_MS, "timeout"),
    gapMs: int(values.gap, DEFAULT_GAP_MS, "gap"),
    panes: values.panes ? values.panes.split(",").map((p) => p.trim()).filter(Boolean) : undefined,
    baselineFile: values.baseline,
    offlineDir: values.offline,
    json: values.json,
    write,
    project: project || undefined,
    allowProduction,
    emulator,
    maxItems: int(values["max-items"], 0, "max-items"),
  };
}

/**
 * Read previously seen item keys for cross-run duplicate detection.
 * Read-only: a missing baseline simply means "nothing seen before".
 */
async function loadBaselineKeys(file) {
  if (!file) return new Set();
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) {
    return new Set();
  }
  let raw;
  try {
    raw = JSON.parse(await readFile(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Could not read baseline file ${resolved}: ${error.message}`);
  }
  const keys = [];
  if (Array.isArray(raw)) keys.push(...raw);
  else if (Array.isArray(raw?.keys)) keys.push(...raw.keys);
  else if (raw && typeof raw === "object") {
    for (const value of Object.values(raw)) if (Array.isArray(value)) keys.push(...value);
  }
  return new Set(keys.filter((key) => typeof key === "string" && key.length));
}

/** Fetch one source's listing, from disk in --offline mode, otherwise live. */
async function readListing(mod, config, limiter) {
  if (config.offlineDir) {
    const file = path.resolve(config.offlineDir, `${mod.SOURCE.id}.html`);
    if (!existsSync(file)) {
      throw new SourceError(`Offline fixture not found: ${file}`, {
        sourceId: mod.SOURCE.id,
        phase: "fetch",
      });
    }
    return readFile(file, "utf8");
  }
  return mod.fetchListing({
    timeoutMs: config.timeoutMs,
    gap: limiter,
  });
}

/** Fetch + parse + dedupe one source. Never throws; failures are returned. */
async function runSource(mod, config, limiter, baselineKeys) {
  const { SOURCE } = mod;
  const result = {
    id: SOURCE.id,
    name: SOURCE.name,
    listingUrl: SOURCE.listingUrl,
    status: "ok",
    error: null,
    notices: [],
    warnings: [],
    duplicates: [],
    drafts: 0,
    draftProblems: 0,
    fingerprint: null,
  };

  let html;
  try {
    html = await readListing(mod, config, limiter);
  } catch (error) {
    result.status = "error";
    result.phase = "fetch";
    result.error = describeError(error);
    return result;
  }

  try {
    const parsed = mod.parse(html, config.panes ? { panes: config.panes } : {});
    result.notices = parsed.notices;
    result.warnings = parsed.warnings;
  } catch (error) {
    result.status = "error";
    result.phase = "parse";
    result.error = describeError(error);
    return result;
  }

  try {
    result.fingerprint = structureFingerprint(html);
  } catch {
    result.fingerprint = null;
  }

  const { unique, duplicates } = dedupeByCanonicalUrl(result.notices, { baselineKeys });
  result.notices = unique;
  result.duplicates = duplicates;

  // Build drafts purely in memory to prove the field conventions and the
  // draft-only invariant. Nothing is persisted.
  for (const notice of unique) {
    try {
      toAlertDraft(notice, { collectedAt: new Date() });
      result.drafts += 1;
    } catch (error) {
      if (error instanceof DraftError) {
        result.draftProblems += 1;
        result.warnings.push(`draft skipped: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  return result;
}

function describeError(error) {
  if (!error) return "unknown error";
  const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
  return `${name}${error.message}${isSourceFailure(error) ? "" : ` (${String(error)})`}`;
}

// --- reporting --------------------------------------------------------------

function printTextReport(results, config) {
  const out = [];
  out.push("");
  out.push("JNTUH Alert Radar collector - DRY RUN");
  out.push("mode        read-only (no Firestore Admin, no writes, nothing published)");
  out.push(`target      ${config.project ?? "(none)"}`);
  if (config.offlineDir) out.push(`source      offline fixtures from ${config.offlineDir}`);
  else out.push("source      live public HTTP GET");

  for (const r of results) {
    out.push("");
    out.push(`=== ${r.id}  (${r.name})`);
    out.push(`    listing   ${r.listingUrl}`);
    out.push(`    status    ${r.status === "ok" ? "ok" : `FAILED during ${r.phase}`}`);

    if (r.status !== "ok") {
      out.push(`    error     ${r.error}`);
      continue;
    }

    out.push(
      `    notices   ${r.notices.length} unique, ${r.duplicates.length} duplicate(s), ` +
        `${r.warnings.length} warning(s)`,
    );
    out.push(`    drafts    ${r.drafts} buildable, ${r.draftProblems} rejected`);

    const shown = config.limit > 0 ? r.notices.slice(0, config.limit) : r.notices;
    for (const [i, n] of shown.entries()) {
      const date = n.noticeDate ? formatDateUtc(n.noticeDate) : "date unavailable";
      out.push(`    ${String(i + 1).padStart(3)}. ${date}  ${n.title}`);
      out.push(`          source  ${n.sourceUrl}${n.sourceUrlFallback ? "  (fallback: listing page)" : ""}`);
      out.push(`          file    ${n.documentUrl ?? "—"}`);
      if (n.attachments?.length) {
        for (const a of n.attachments) out.push(`          attach  ${a}`);
      }
    }
    if (shown.length < r.notices.length) {
      out.push(`    ... ${r.notices.length - shown.length} more (use --limit 0 to print all)`);
    }

    if (r.duplicates.length) {
      out.push(`    duplicates (${r.duplicates.length}):`);
      for (const d of r.duplicates) {
        out.push(`      - [${d.reason}] ${d.notice.title}`);
        out.push(`        ${d.notice.sourceUrl}`);
      }
    }

    if (r.warnings.length) {
      out.push(`    warnings (${r.warnings.length}):`);
      for (const w of r.warnings.slice(0, 20)) out.push(`      ! ${w}`);
      if (r.warnings.length > 20) out.push(`      ... ${r.warnings.length - 20} more`);
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.length - ok;
  const total = results.reduce((n, r) => n + r.notices.length, 0);
  const dups = results.reduce((n, r) => n + r.duplicates.length, 0);
  const drafts = results.reduce((n, r) => n + r.drafts, 0);

  out.push("");
  out.push("summary");
  out.push(`    sources   ${ok} ok, ${failed} failed`);
  out.push(`    notices   ${total} unique, ${dups} duplicate(s) suppressed`);
  out.push(`    drafts    ${drafts} ready for (manual) admin review`);
  out.push("    writes    0 - dry run never touches a database");
  out.push("");

  process.stdout.write(`${out.join("\n")}\n`);
}

// --- main -------------------------------------------------------------------

async function main() {
  const config = parseCli();

  let baselineKeys = new Set();
  try {
    baselineKeys = await loadBaselineKeys(config.baselineFile);
  } catch (error) {
    fail(error.message, 2);
  }

  const limiter = createRateLimiter(config.gapMs);
  const results = [];
  for (const id of config.sources) {
    const mod = REGISTRY.find((m) => m.SOURCE.id === id);
    results.push(await runSource(mod, config, limiter, baselineKeys));
  }

  if (config.write) {
    const startedAt = new Date();
    const runId = `${startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
    const commitSha = process.env.GITHUB_SHA || process.env.GIT_COMMIT || "";
    const collectorVersion = process.env.COLLECTOR_VERSION || "unknown";
    const trigger = process.env.CI === "true" ? "schedule" : "manual";

    // Dynamic imports so that a dry run never loads the Admin SDK.
    const [{ createIngestStore }, { planRun, executeRun, itemIdsForSources }] = await Promise.all([
      import("./lib/firestoreAdmin.mjs"),
      import("./write.mjs"),
    ]);

    const store = createIngestStore({ projectId: config.project, emulator: config.emulator });
    try {
      const { ids } = itemIdsForSources(results);
      const [existingItems, existingHealth] = await Promise.all([
        store.readItems(ids),
        store.readSourceHealth(config.sources),
      ]);
      const plan = planRun({
        sources: results,
        existingItems,
        existingHealth,
        runId,
        startedAt,
        trigger,
        actor: process.env.GITHUB_ACTOR || "cli",
        commitSha,
        collectorVersion,
        dryRun: false,
        projectId: config.project,
        databaseId: store.databaseId,
        maxItems: config.maxItems,
      });

      if (plan.refused) {
        console.error(plan.refusalReason || "refused by safety guard");
        await store.close();
        process.exitCode = 3;
        return;
      }

      await executeRun({ plan, store, now: () => new Date() });
      await store.close();
      if (config.json) {
        process.stdout.write(`${JSON.stringify({ dryRun: false, mode: store.mode, projectId: store.projectId, databaseId: store.databaseId, runId, status: plan.status }, null, 2)}\n`);
      } else {
        console.log(`collector: wrote run ${runId} to ${store.projectId}/${store.databaseId} (status=${plan.status}, ops=${plan.counts.operations}, batches=${plan.counts.batches})`);
      }
      return;
    } catch (error) {
      try { await store.close(); } catch {}
      console.error(`collector write failed: ${error?.message || error}`);
      process.exitCode = 4;
      return;
    }
  }

  if (config.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          firestoreInitialised: false,
          targetProject: config.project ?? null,
          sources: results,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    printTextReport(results, config);
  }

  const failed = results.filter((r) => r.status !== "ok");
  if (failed.length) {
    process.stderr.write(
      `\n${failed.length} source(s) failed:\n` +
        failed.map((r) => `  - ${r.id}: ${r.error}`).join("\n") +
        "\n",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`collector failed: ${describeError(error)}\n`);
  process.exitCode = 1;
});
