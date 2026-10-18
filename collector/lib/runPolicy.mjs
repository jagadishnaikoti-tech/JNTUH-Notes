// ---------------------------------------------------------------------------
// Collector - scheduled-run policy (pure, dependency-free, no I/O).
//
// The collector is meant to be driven by an external runner (GitHub Actions -
// see ../SCHEDULING.md). That runner must never be able to widen its own
// authority, so this module turns a small, explicit set of inputs into the
// exact argv the CLI is allowed to receive, and refuses everything it does not
// recognise. `scheduledRun.mjs` is the only caller.
//
// Invariants enforced here (each one is covered by runPolicy.test.mjs):
//   * a bare or unrecognised run is a DRY RUN - `--write` is never emitted;
//   * `--allow-production` is emitted ONLY for mode "stage", and only when the
//     out-of-band switch COLLECTOR_STAGING_ENABLED is exactly the string "true"
//     (the same comparison the workflow guard makes);
//   * staging refuses any project id but INTENDED_PROJECT_ID, refuses to run
//     while a Firestore emulator host is set, and refuses without Application
//     Default Credentials;
//   * `--offline` (replay saved HTML) is dry-run only: a staging run must read
//     the live official pages, never a stale fixture;
//   * `--max-items` is always a positive, capped integer, so a scheduled run can
//     never be unbounded (`--max-items 0` means "no limit" to the CLI);
//   * no emitted token can publish, verify or delete anything. There is no such
//     flag in the CLI, and a caller-supplied value that looks like a flag is
//     rejected rather than passed through.
// ---------------------------------------------------------------------------

import { INTENDED_PROJECT_ID } from "./runReport.mjs";

/** The only two modes a scheduled run may use. */
export const RUN_MODE = Object.freeze({
  DRY_RUN: "dry-run",
  STAGE: "stage",
});

/** New staged notices a run may create when it is not told otherwise. */
export const DEFAULT_MAX_ITEMS = 100;

/** Hard ceiling for `--max-items`: a scheduled run is never unbounded. */
export const MAX_ITEMS_CAP = 300;

/**
 * Every flag this policy is able to emit. Exported so a test can assert that
 * the produced argv never contains anything else - in particular nothing that
 * could publish, verify or delete an alert.
 */
export const ALLOWED_FLAGS = Object.freeze([
  "--source",
  "--timeout",
  "--gap",
  "--panes",
  "--offline",
  "--write",
  "--allow-production",
  "--project",
  "--max-items",
]);

const MAX_VALUE_LENGTH = 200;

function refuse(reason) {
  return { ok: false, mode: null, argv: [], reason: String(reason) };
}

/**
 * The staging switch is ON only for the exact string "true" - byte-for-byte the
 * value the workflow guard compares against (`[ "$STAGING_ENABLED" != "true" ]`).
 *
 * Everything else fails closed: the boolean `true`, "TRUE", " true ", "1",
 * "yes" and "on" are all OFF. A production write path must not be armable by an
 * ambiguous value, and `process.env` values are always strings anyway.
 */
export function isEnabled(value) {
  return value === "true";
}

/** A passthrough value: never empty, never flag-like, never multi-line. */
function cleanValue(value, name) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, reason: `${name} must not be empty` };
  if (text.startsWith("-")) {
    return { ok: false, reason: `${name} must not start with "-" (got "${text}")` };
  }
  if (text.length > MAX_VALUE_LENGTH) return { ok: false, reason: `${name} is too long` };
  if (/[\r\n]/.test(text)) return { ok: false, reason: `${name} must be a single line` };
  return { ok: true, value: text };
}

/** Split a comma/array input into deduplicated, validated tokens. */
function cleanList(values, name) {
  const input = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  const out = [];
  for (const raw of input) {
    const parts = String(raw ?? "").split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const cleaned = cleanValue(trimmed, name);
      if (!cleaned.ok) return cleaned;
      if (!out.includes(cleaned.value)) out.push(cleaned.value);
    }
  }
  return { ok: true, value: out };
}

/** Parse an optional non-negative integer, optionally with a default and a cap. */
function nonNegativeInt(value, name, { fallback, cap } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback === undefined ? { ok: true, value: undefined } : { ok: true, value: fallback };
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: `${name} must be a non-negative integer (got "${value}")` };
  }
  if (cap !== undefined && n > cap) {
    return { ok: false, reason: `${name} ${n} exceeds the cap of ${cap}` };
  }
  return { ok: true, value: n };
}

/**
 * Resolve the exact collector invocation for one scheduled run.
 *
 * @param {object} input
 * @param {string}  [input.mode]            "dry-run" (default) or "stage".
 * @param {boolean|string} [input.stagingEnabled] the out-of-band opt-in.
 * @param {string}  [input.projectId]       must equal INTENDED_PROJECT_ID to stage.
 * @param {string}  [input.credentialPath]  GOOGLE_APPLICATION_CREDENTIALS.
 * @param {string}  [input.emulatorHost]    FIRESTORE_EMULATOR_HOST, if any.
 * @param {number|string} [input.maxItems]  cap on NEW staged notices.
 * @param {string}  [input.offlineDir]      dry-run only: replay saved HTML.
 * @param {string|string[]} [input.sources] restrict to these source ids.
 * @param {string|string[]} [input.panes]   exam portal panes.
 * @param {number|string} [input.timeoutMs] per-request timeout.
 * @param {number|string} [input.gapMs]     minimum delay between requests.
 * @returns {{ok: true, mode: string, writes: boolean, argv: string[], summary: string}
 *          | {ok: false, mode: null, argv: [], reason: string}}
 */
export function resolveRunPlan(input = {}) {
  const {
    mode,
    stagingEnabled,
    projectId,
    credentialPath,
    emulatorHost,
    maxItems,
    offlineDir,
    sources,
    panes,
    timeoutMs,
    gapMs,
  } = input;

  const rawMode = String(mode ?? "").trim().toLowerCase() || RUN_MODE.DRY_RUN;
  if (rawMode !== RUN_MODE.DRY_RUN && rawMode !== RUN_MODE.STAGE) {
    return refuse(
      `unknown run mode "${mode}" (expected "${RUN_MODE.DRY_RUN}" or "${RUN_MODE.STAGE}")`,
    );
  }

  const timeout = nonNegativeInt(timeoutMs, "timeout");
  if (!timeout.ok) return refuse(timeout.reason);
  const gap = nonNegativeInt(gapMs, "gap");
  if (!gap.ok) return refuse(gap.reason);
  const sourceList = cleanList(sources, "source id");
  if (!sourceList.ok) return refuse(sourceList.reason);
  const paneList = cleanList(panes, "pane");
  if (!paneList.ok) return refuse(paneList.reason);

  let offline = null;
  if (offlineDir !== undefined && offlineDir !== null && String(offlineDir).trim() !== "") {
    if (rawMode === RUN_MODE.STAGE) {
      return refuse(
        "--offline is a dry-run-only input: a staging run must read the live official sources",
      );
    }
    const cleaned = cleanValue(offlineDir, "offline directory");
    if (!cleaned.ok) return refuse(cleaned.reason);
    offline = cleaned.value;
  }

  // Inputs shared by both modes.
  const argv = [];
  if (offline) argv.push("--offline", offline);
  for (const source of sourceList.value) argv.push("--source", source);
  if (paneList.value.length) argv.push("--panes", paneList.value.join(","));
  if (timeout.value !== undefined && timeout.value > 0) argv.push("--timeout", String(timeout.value));
  if (gap.value !== undefined && gap.value > 0) argv.push("--gap", String(gap.value));

  if (rawMode === RUN_MODE.DRY_RUN) {
    return {
      ok: true,
      mode: RUN_MODE.DRY_RUN,
      writes: false,
      argv,
      summary: "dry run - read-only, no Firestore writes, nothing published",
    };
  }

  // ---- staging: the deliberate, double-gated write path -------------------
  if (!isEnabled(stagingEnabled)) {
    return refuse(
      "staging is disabled: set COLLECTOR_STAGING_ENABLED=true only after the rollout is approved (see collector/SCHEDULING.md)",
    );
  }

  const wanted = cleanValue(projectId, "project id");
  if (!wanted.ok) return refuse(wanted.reason);
  if (wanted.value !== INTENDED_PROJECT_ID) {
    return refuse(`refusing to stage into "${wanted.value}" (expected ${INTENDED_PROJECT_ID})`);
  }

  if (String(emulatorHost ?? "").trim()) {
    return refuse("refusing a staging run while FIRESTORE_EMULATOR_HOST is set");
  }

  const credentials = cleanValue(credentialPath, "GOOGLE_APPLICATION_CREDENTIALS");
  if (!credentials.ok) {
    return refuse(`${credentials.reason} - a staging run needs Application Default Credentials`);
  }

  const budget = nonNegativeInt(maxItems, "max items", {
    fallback: DEFAULT_MAX_ITEMS,
    cap: MAX_ITEMS_CAP,
  });
  if (!budget.ok) return refuse(budget.reason);
  if (budget.value < 1) {
    return refuse("max items must be at least 1 (the CLI treats 0 as 'unlimited')");
  }

  argv.push(
    "--write",
    "--allow-production",
    "--project",
    INTENDED_PROJECT_ID,
    "--max-items",
    String(budget.value),
  );

  return {
    ok: true,
    mode: RUN_MODE.STAGE,
    writes: true,
    argv,
    projectId: INTENDED_PROJECT_ID,
    maxItems: budget.value,
    summary: `staging to ${INTENDED_PROJECT_ID} (at most ${budget.value} new notices) - staging never publishes`,
  };
}

/**
 * Build the `resolveRunPlan` input from the scheduled runner's environment.
 * Kept separate (and pure) so the exact mapping is unit-testable.
 */
export function resolveRunPlanFromEnv(env = {}) {
  return {
    mode: env.COLLECTOR_MODE,
    stagingEnabled: env.COLLECTOR_STAGING_ENABLED,
    projectId: env.COLLECTOR_PROJECT_ID,
    credentialPath: env.GOOGLE_APPLICATION_CREDENTIALS,
    emulatorHost: env.FIRESTORE_EMULATOR_HOST,
    maxItems: env.COLLECTOR_MAX_ITEMS,
    offlineDir: env.COLLECTOR_OFFLINE_DIR,
    sources: env.COLLECTOR_SOURCES,
    panes: env.COLLECTOR_PANES,
    timeoutMs: env.COLLECTOR_TIMEOUT_MS,
    gapMs: env.COLLECTOR_GAP_MS,
  };
}
