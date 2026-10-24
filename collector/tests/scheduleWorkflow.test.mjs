// ---------------------------------------------------------------------------
// Tests for the scheduled-run workflow file (.github/workflows/collect-alerts.yml)
// and the scheduling documentation.
//
// "Scheduling is disabled until it is separately approved" is a promise that
// lives in a YAML file, so this suite reads that file and fails if the promise
// is ever broken by accident: an enabled timer, a committed credential, an
// over-broad permission, or a step that runs the CLI with its own flags instead
// of going through the policy.
//
// The parsing is deliberately line-based. The repository has no YAML dependency
// and this check only needs to spot a small set of things; comments are stripped
// first so the reviewed-but-disabled schedule block does not trip it.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "collect-alerts.yml");
const SCHEDULING_DOC = path.join(ROOT, "collector", "SCHEDULING.md");

const raw = readFileSync(WORKFLOW_PATH, "utf8");

/** The workflow without whole-line comments, so only live config is asserted. */
const live = raw
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

test("the workflow is triggered only by a manual dispatch, never by a timer", () => {
  assert.match(live, /^\s*workflow_dispatch:/m);
  assert.match(live, /^\s*on:/m);
  // Nothing may run on a push, a pull request or a timer.
  assert.ok(!/^\s{0,4}push:/m.test(live), "must not run on push");
  assert.ok(!/^\s{0,4}pull_request:/m.test(live), "must not run on pull_request");
  assert.ok(!/^\s{0,4}schedule:/m.test(live), "the timer must stay disabled until approved");
  assert.ok(!/^\s*-\s*cron:/m.test(live), "no live cron entry may remain");
  assert.ok(
    !/github\.event_name == 'schedule'/.test(live),
    "no live condition may treat a scheduled run as a staging run",
  );
  // The reviewed cron is kept as a record, but only as a comment.
  assert.match(raw, /^\s*#\s*schedule:/m, "the commented-out schedule block must be kept");
  assert.match(raw, /^\s*#\s*-\s*cron:/m, "the proposed cron expression must be kept");
  // A manual run defaults to the read-only mode, not to a write.
  assert.match(raw, /default:\s*dry-run/, "the default mode must be dry-run");
});

test("the workflow never carries credential material and uses OIDC, not a stored secret", () => {
  for (const forbidden of [
    /-----BEGIN/,
    /private_key/,
    /firebase-adminsdk/,
    /client_email/,
    /"type"\s*:\s*"service_account"/,
    /credentials_json/,
    /service-accounts\s+keys\s+create/,
  ]) {
    assert.ok(!forbidden.test(raw), `the workflow must not contain ${forbidden}`);
  }
  // No long-lived service-account JSON: the job exchanges a short-lived GitHub
  // OIDC token for impersonated staging credentials.
  assert.ok(
    !/secrets\./.test(live),
    "the workflow must not read repository secrets (WIF needs none)",
  );
  assert.ok(!/FIREBASE_SERVICE_ACCOUNT/.test(raw));
  assert.match(live, /google-github-actions\/auth@v2/);
  assert.match(live, /workload_identity_provider:\s*\$\{\{\s*vars\.GCP_WORKLOAD_IDENTITY_PROVIDER\s*\}\}/);
  assert.match(live, /service_account:\s*\$\{\{\s*vars\.GCP_COLLECTOR_SERVICE_ACCOUNT\s*\}\}/);
  assert.ok(
    !/(?:echo|printf|cat)[^\n]*(?:GOOGLE_APPLICATION_CREDENTIALS|ACCESS_TOKEN|ID_TOKEN|GITHUB_TOKEN)/i.test(live),
    "the workflow must not print credentials or tokens",
  );
});

test("the workflow names the exact staging service account and no other identity", () => {
  const expected = "jntuh-staging-collector@jntuh-notes-staging.iam.gserviceaccount.com";
  assert.ok(live.includes(expected), "the workflow must name the actual staging service account");
  for (const line of live.split("\n").filter((line) => line.includes("@jntuh-notes-staging.iam.gserviceaccount.com"))) {
    assert.ok(line.includes(expected), `unexpected staging service account: ${line.trim()}`);
  }
  const stagingAccounts = raw.match(/[A-Za-z0-9._-]+@jntuh-notes-staging\.iam\.gserviceaccount\.com/g) ?? [];
  assert.ok(stagingAccounts.length > 0, "the workflow must configure a staging service account");
  for (const account of stagingAccounts) {
    assert.equal(account, expected, `unexpected staging service account: ${account}`);
  }
  assert.ok(
    !/@jntuh-notes-6ef74\.iam\.gserviceaccount\.com/.test(raw),
    "production service accounts must never be configured",
  );
});

test("permissions are least privilege", () => {
  assert.match(live, /permissions:/);
  assert.match(live, /contents:\s*read/);
  assert.ok(!/contents:\s*write/.test(live), "the workflow must not be able to write to the repository");
  assert.ok(!/write-all/.test(live), "write-all is never acceptable");
  // id-token is the OIDC token used only if Workload Identity Federation is set up.
  assert.match(live, /id-token:\s*write/);
});

test("a staging write requires a manual stage dispatch and the owner-set variable", () => {
  assert.match(live, /vars\.COLLECTOR_STAGING_ENABLED/);
  assert.match(raw, /COLLECTOR_STAGING_ENABLED=true/, "the guard must explain how staging is enabled");

  const modeLine = live.split("\n").find((line) => line.includes("COLLECTOR_MODE:"));
  assert.ok(modeLine, "the collector mode must be set explicitly");
  assert.ok(modeLine.includes("github.event_name == 'workflow_dispatch'"), "staging must be manual only");
  assert.ok(modeLine.includes("inputs.mode == 'stage'"), "staging must select the stage input");
  assert.ok(
    modeLine.includes("vars.COLLECTOR_STAGING_ENABLED == 'true'"),
    "staging must also require the owner-set repository variable",
  );
  assert.ok(modeLine.includes("'dry-run'"), "every other case must fall back to dry-run");

  const stageConditions = live
    .split("\n")
    .filter((line) => /if:.*inputs\.mode == 'stage'/.test(line));
  assert.ok(stageConditions.length >= 3, "the write guards and WIF auth must be stage-only");
  for (const condition of stageConditions) {
    assert.ok(condition.includes("github.event_name == 'workflow_dispatch'"), condition.trim());
    assert.ok(!condition.includes("schedule"), condition.trim());
  }

  const guardIndex = live.indexOf("Guard - staging requires the owner-set repository variable");
  const authIndex = live.indexOf("uses: google-github-actions/auth@v2");
  const runIndex = live.indexOf("run: node collector/scheduledRun.mjs");
  assert.ok(guardIndex !== -1 && authIndex !== -1 && runIndex !== -1);
  assert.ok(guardIndex < authIndex, "the staging guard must run before authentication");
  assert.ok(authIndex < runIndex, "WIF authentication must run before the collector");
});

test("the runner is invoked through the policy entry point, never with inline flags", () => {
  assert.match(live, /run:\s*node collector\/scheduledRun\.mjs/);
  assert.ok(!/--allow-production/.test(live), "live-write flags belong in runPolicy.mjs, not the workflow");
  assert.ok(!/--emulator/.test(live), "the scheduled workflow never targets an emulator");
});

// Workflow-structure regression test (static/offline). Does NOT simulate a real
// GitHub Actions auth failure or runner semantics; it asserts the YAML structure
// would be fail-closed by default ordering/conditions.
test("WIF authentication failure stops execution before the collector runs (workflow structure)", () => {
  const lines = raw.split(/\r?\n/);
  const liveLines = lines.filter((line) => !/^\s*#/.test(line));

  // Auth must use google-github-actions/auth@v2 with OIDC (no fallback to secrets)
  assert.match(live, /google-github-actions\/auth@v2/);
  assert.ok(!/secrets\./.test(live), "no repository secrets used for auth");
  assert.ok(!/FIREBASE_SERVICE_ACCOUNT/.test(raw), "no service account JSON secret");
  assert.ok(
    !/(?:echo|printf|cat)[^\n]*(?:GOOGLE_APPLICATION_CREDENTIALS|ACCESS_TOKEN|ID_TOKEN)/i.test(live),
    "must not print credentials",
  );

  // Find job boundaries (best-effort indentation-based)
  const jobStartIndices = [];
  for (let i = 0; i < liveLines.length; i++) {
    if (/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(liveLines[i]) && /jobs:/.test(liveLines.slice(Math.max(0, i - 5), i).join("\n"))) {
      // rough; find jobs block start
    }
  }
  // Simpler: find collect job
  const collectJobIdx = liveLines.findIndex((l) => /^\s{2}collect\s*:/.test(l));
  assert.ok(collectJobIdx !== -1, "collect job must exist");
  // Find next job at same indent level
  let collectJobEnd = liveLines.length;
  for (let i = collectJobIdx + 1; i < liveLines.length; i++) {
    if (/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(liveLines[i]) && !liveLines[i].includes("steps")) {
      collectJobEnd = i;
      break;
    }
  }
  const collectJobLines = liveLines.slice(collectJobIdx, collectJobEnd);
  const collectJobText = collectJobLines.join("\n");

  // Identify specific steps
  const authStepNameIdx = collectJobLines.findIndex((l) => /Authenticate to the staging project \(Workload Identity Federation\)/.test(l));
  const authActionIdx = collectJobLines.findIndex((l) => /uses:\s*google-github-actions\/auth@v2/.test(l));
  const collectorRunIdx = collectJobLines.findIndex((l) => /run:\s*node collector\/scheduledRun\.mjs/.test(l));
  assert.ok(authStepNameIdx !== -1, "auth step name must exist in collect job");
  assert.ok(authActionIdx !== -1, "auth action must exist in collect job");
  assert.ok(collectorRunIdx !== -1, "collector run must exist in collect job");
  // Ensure auth action is associated with auth step (nearby)
  assert.ok(Math.abs(authActionIdx - authStepNameIdx) <= 10, "auth action must be in the same auth step");

  // Auth must be stage-only and cannot be skipped for valid staging path
  // Check auth step has if condition requiring stage+workflow_dispatch
  let authIfLine = -1;
  for (let i = Math.max(0, authStepNameIdx - 15); i <= authActionIdx; i++) {
    if (/^\s*-\s*name:.*Authenticate/i.test(collectJobLines[i]) || i === authStepNameIdx) {
      // scan forward from step start
      for (let j = i; j <= Math.min(collectJobLines.length - 1, i + 20); j++) {
        if (/^\s*if\s*:/.test(collectJobLines[j])) {
          authIfLine = j;
          break;
        }
      }
      break;
    }
  }
  assert.ok(authIfLine !== -1, "auth step must have an if condition");
  const authIfText = collectJobLines[authIfLine];
  assert.match(authIfText, /inputs\.mode\s*==\s*'stage'/, "auth if must require stage mode");
  assert.match(authIfText, /github\.event_name\s*==\s*'workflow_dispatch'/, "auth if must require workflow_dispatch");
  assert.ok(!/github\.event_name\s*==\s*'schedule'/.test(authIfText), "auth if must not allow schedule");

  // Auth step must not use continue-on-error with any truthy YAML value
  let authStepStart = authStepNameIdx;
  if (authStepStart === -1) {
    authStepStart = authActionIdx;
    // look backwards for step start
    for (let i = authStepStart; i >= Math.max(0, authStepStart - 20); i--) {
      if (/^\s*-\s*(name:|uses:|run:)/.test(collectJobLines[i])) {
        authStepStart = i;
        break;
      }
    }
  }
  // scan this step's block
  for (let i = authStepStart; i < Math.min(collectJobLines.length, authStepStart + 30); i++) {
    const line = collectJobLines[i];
    if (/^\s*-\s+(name:|uses:|run:|id:)/.test(line) && i !== authStepStart) break;
    if (/^\s*continue-on-error\s*:/.test(line)) {
      const val = line.split(':')[1] || '';
      assert.ok(!/\b(true|yes|on)\b/i.test(val), "auth step must not have continue-on-error truthy");
      assert.ok(!/^\s*true\s*$/i.test(val.trim()), "auth step must not have continue-on-error: true");
    }
  }

  // Collector run must be after auth in same job
  assert.ok(collectorRunIdx > authActionIdx, "collector must run after auth action in same job");
  assert.ok(collectorRunIdx > authStepNameIdx, "collector must run after auth step in same job");

  // Collector step must not bypass auth (no always/failure)
  let collectorStepStart = collectorRunIdx;
  for (let i = collectorRunIdx; i >= Math.max(0, collectorRunIdx - 15); i--) {
    if (/^\s*-\s*(name:|uses:|run:)/.test(collectJobLines[i])) {
      collectorStepStart = i;
      break;
    }
  }
  for (let i = collectorStepStart; i < Math.min(collectJobLines.length, collectorStepStart + 25); i++) {
    const line = collectJobLines[i];
    if (/^\s*-\s+(name:|uses:|run:|id:)/.test(line) && i !== collectorStepStart) break;
    if (/^\s*if\s*:/.test(line)) {
      assert.ok(!/always\(\)/.test(line), "collector step must not use if: always()");
      assert.ok(!/failure\(\)/.test(line), "collector step must not use if: failure()");
      // Must not be conditioned to run regardless of auth
    }
  }

  // No duplicate/alternate collector invocations
  const collectorRunMatches = collectJobText.match(/run:\s*node collector\/scheduledRun\.mjs/g) || [];
  assert.equal(collectorRunMatches.length, 1, "exactly one collector invocation in collect job");

  // Guards must precede auth and collector
  const guardIdx = collectJobLines.findIndex((l) => /Guard - staging requires the owner-set repository variable/.test(l));
  const saGuardIdx = collectJobLines.findIndex((l) => /Guard - Workload Identity Federation is configured/.test(l));
  assert.ok(guardIdx !== -1 && saGuardIdx !== -1, "both staging guards must exist");
  assert.ok(guardIdx < authStepNameIdx, "staging enabled guard must precede auth");
  assert.ok(saGuardIdx < authStepNameIdx, "WIF config guard must precede auth");
  assert.ok(guardIdx < collectorRunIdx, "staging enabled guard must precede collector");
  assert.ok(saGuardIdx < collectorRunIdx, "WIF config guard must precede collector");

  // Default dry-run and manual-only guarantees preserved
  assert.match(raw, /default:\s*dry-run/, "default mode must be dry-run");
  assert.match(live, /^\s*workflow_dispatch:/m);
  assert.ok(!/^\s{0,4}schedule:/m.test(live), "no live schedule");
  assert.ok(!/^\s*-\s*cron:/m.test(live), "no live cron");
});

test("two runs can never overlap", () => {
  assert.match(live, /concurrency:/);
  assert.match(live, /cancel-in-progress:\s*false/);
  assert.match(live, /group:\s*collector-staging/);
});

test("the run step passes the run metadata the run document records", () => {
  assert.match(live, /GITHUB_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(live, /GITHUB_ACTOR:\s*\$\{\{\s*github\.actor\s*\}\}/);
  // The staging project is hard-coded so the policy's allowlist check is
  // meaningful, and production is never a write target.
  assert.match(live, /COLLECTOR_PROJECT_ID:\s*jntuh-notes-staging/);
  assert.ok(
    !/COLLECTOR_PROJECT_ID:\s*jntuh-notes-6ef74/.test(live),
    "the workflow must never point the collector at production",
  );
  assert.ok(
    !/jntuh-notes-6ef74/.test(live),
    "no live workflow line may target or name the production project",
  );
  // The staging project's primary database is named explicitly. It is an
  // assertion, not a setting: runPolicy refuses any value but "(default)".
  assert.match(live, /COLLECTOR_DATABASE_ID:\s*"\(default\)"/);
  // The max-items input remains capped by the workflow input and the policy.
  assert.match(live, /max_items:/);
  assert.match(live, /COLLECTOR_MAX_ITEMS:\s*\$\{\{\s*inputs\.max_items\s*\}\}/);
  assert.match(raw, /default:\s*"100"/);
});

test("the scheduling documentation covers the required operational facts", () => {
  const doc = readFileSync(SCHEDULING_DOC, "utf8");
  for (const needle of [
    "DISABLED",              // status
    "GitHub Actions",        // chosen runner
    "Blaze",                 // why not Cloud Functions
    "cron",                  // the schedule
    "jntuhCollectorStaging", // the least-privilege custom role
    "SECURITY.md",           // the honest description of the IAM boundary
    "Workload Identity",     // the keyless option
    "GCP_WORKLOAD_IDENTITY_PROVIDER", // the GitHub repository variable
    "GCP_COLLECTOR_SERVICE_ACCOUNT",  // the staging service account
    "jntuh-notes-staging",   // the staging project
    "COLLECTOR_STAGING_ENABLED", // the second gate
    "consecutiveFailures",   // failure handling
    "Disabling it",          // how to turn it off
  ]) {
    assert.ok(doc.includes(needle), `SCHEDULING.md should mention ${needle}`);
  }
});
