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
// first so the documented "uncomment this to enable" instructions do not trip it.
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

test("the workflow exists and is triggered only by a manual dispatch", () => {
  assert.match(live, /^\s*workflow_dispatch:/m);
  assert.match(live, /^\s*on:/m);
  // Nothing may run on a push, a pull request or a timer.
  assert.ok(!/^\s{0,4}push:/m.test(live), "must not run on push");
  assert.ok(!/^\s{0,4}pull_request:/m.test(live), "must not run on pull_request");
  assert.ok(!/^\s{0,4}schedule:/m.test(live), "the timer must stay disabled until approved");
  // The documented enable path must still be present, commented out.
  assert.match(raw, /^\s*#\s*schedule:/m, "the commented-out schedule block must be kept");
  assert.match(raw, /^\s*#\s*-\s*cron:/m, "the proposed cron expression must be kept");
});

test("the workflow never carries credential material and uses OIDC, not a stored secret", () => {
  for (const forbidden of [/-----BEGIN/, /private_key/, /firebase-adminsdk/, /client_email/, /"type"\s*:\s*"service_account"/]) {
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
  assert.match(live, /vars\.GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(live, /vars\.GCP_COLLECTOR_SERVICE_ACCOUNT/);
});

test("permissions are least privilege", () => {
  assert.match(live, /permissions:/);
  assert.match(live, /contents:\s*read/);
  assert.ok(!/contents:\s*write/.test(live), "the workflow must not be able to write to the repository");
  assert.ok(!/write-all/.test(live), "write-all is never acceptable");
  // id-token is the OIDC token used only if Workload Identity Federation is set up.
  assert.match(live, /id-token:\s*write/);
});

test("staging is double-gated: repository variable, then the policy", () => {
  assert.match(live, /vars\.COLLECTOR_STAGING_ENABLED/);
  assert.match(raw, /COLLECTOR_STAGING_ENABLED=true/, "the guard must explain how staging is enabled");
  assert.match(live, /if:\s*\$\{\{[^}]*inputs\.mode == 'stage'[^}]*\}\}/);
});

test("the runner is invoked through the policy entry point, never with inline flags", () => {
  assert.match(live, /run:\s*node collector\/scheduledRun\.mjs/);
  assert.ok(!/--allow-production/.test(live), "live-write flags belong in runPolicy.mjs, not the workflow");
  assert.ok(!/--emulator/.test(live), "the scheduled workflow never targets an emulator");
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
  // The staging project's primary database is named explicitly. It is an
  // assertion, not a setting: runPolicy refuses any value but "(default)".
  assert.match(live, /COLLECTOR_DATABASE_ID:\s*"\(default\)"/);
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
