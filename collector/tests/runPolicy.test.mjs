// ---------------------------------------------------------------------------
// Tests for the scheduled-run policy (collector/lib/runPolicy.mjs) and the
// scheduled runner entry point (collector/scheduledRun.mjs).
//
// These are the tests that make "production scheduling stays disabled" a
// property of the code rather than a promise: a staging run must be refused
// unless the out-of-band switch is on, and no argv the policy can build may
// publish, verify or delete anything.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  ALLOWED_FLAGS,
  DEFAULT_MAX_ITEMS,
  MAX_ITEMS_CAP,
  RUN_MODE,
  isEnabled,
  resolveRunPlan,
  resolveRunPlanFromEnv,
} from "../lib/runPolicy.mjs";
import { explainUnexpectedArguments, runScheduled } from "../scheduledRun.mjs";
import { STAGING_DATABASE_ID } from "../lib/runReport.mjs";

const PROJECT = "jntuh-notes-6ef74";

/** A fully-approved staging input, so each test only varies one thing. */
const approvedStage = {
  mode: RUN_MODE.STAGE,
  stagingEnabled: "true",
  projectId: PROJECT,
  credentialPath: "C:\\tmp\\collector-sa.json",
  maxItems: 50,
};

/** Every `--flag` present in argv, in order. */
const flagsOf = (argv) => argv.filter((token) => String(token).startsWith("--"));

test("a bare run is a dry run and emits no write or production flag", () => {
  for (const input of [{}, { mode: undefined }, { mode: "" }, { mode: "dry-run" }, { mode: "DRY-RUN" }]) {
    const plan = resolveRunPlan(input);
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, RUN_MODE.DRY_RUN);
    assert.equal(plan.writes, false);
    assert.deepEqual(plan.argv, []);
    assert.ok(!plan.argv.includes("--write"));
    assert.ok(!plan.argv.includes("--allow-production"));
  }
});

test("an unknown mode is refused (fail closed)", () => {
  const plan = resolveRunPlan({ mode: "production" });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /unknown run mode/);
  assert.deepEqual(plan.argv, []);
});

test("a dry run may restrict sources, replay fixtures and tune politeness", () => {
  const plan = resolveRunPlan({
    mode: "dry-run",
    offlineDir: "collector/tests/fixtures",
    sources: ["notifications", "exams"],
    panes: "notification,timetable",
    timeoutMs: 20000,
    gapMs: 2000,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.argv, [
    "--offline", "collector/tests/fixtures",
    "--source", "notifications",
    "--source", "exams",
    "--panes", "notification,timetable",
    "--timeout", "20000",
    "--gap", "2000",
  ]);
  assert.ok(!plan.argv.includes("--write"));
});

test("staging is refused unless the switch is exactly the string \"true\"", () => {
  for (const stagingEnabled of [
    undefined,
    null,
    "",
    "false",
    "0",
    "no",
    "off",
    false,
    // Near-misses: a production write path must fail closed on all of these.
    true,
    "TRUE",
    "True",
    " true ",
    "true\n",
    "1",
    "yes",
    "on",
    "y",
    "t",
  ]) {
    const plan = resolveRunPlan({ ...approvedStage, stagingEnabled });
    assert.equal(plan.ok, false, `stagingEnabled=${JSON.stringify(stagingEnabled)} must be refused`);
    assert.match(plan.reason, /COLLECTOR_STAGING_ENABLED/);
    assert.deepEqual(plan.argv, [], "a refusal never leaks a partial argv");
  }
});

test("only the exact string \"true\" enables staging", () => {
  assert.equal(isEnabled("true"), true);

  const plan = resolveRunPlan({ ...approvedStage, stagingEnabled: "true" });
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, RUN_MODE.STAGE);
  assert.equal(plan.writes, true);

  // The spellings documented away in SCHEDULING.md and rejected by the workflow
  // guard must not enable staging here either.
  for (const value of [true, "TRUE", "True", " true ", "1", "yes", "on"]) {
    assert.equal(isEnabled(value), false, `${JSON.stringify(value)} must not enable staging`);
  }
});

test("an approved staging run emits exactly the staging argv", () => {
  const plan = resolveRunPlan(approvedStage);
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, RUN_MODE.STAGE);
  assert.equal(plan.writes, true);
  assert.deepEqual(plan.argv, [
    "--write",
    "--allow-production",
    "--project", PROJECT,
    "--max-items", "50",
  ]);
  assert.equal(plan.projectId, PROJECT);
  assert.equal(plan.maxItems, 50);
  assert.match(plan.summary, /never publishes/);
});

test("staging refused for a foreign or unknown project", () => {
  for (const projectId of ["demo-jntuh-notes", "some-other-project", "", undefined]) {
    const plan = resolveRunPlan({ ...approvedStage, projectId });
    assert.equal(plan.ok, false, `project ${JSON.stringify(projectId)} must be refused`);
  }
  assert.match(resolveRunPlan({ ...approvedStage, projectId: "evil" }).reason, /expected jntuh-notes-6ef74/);
});

test("staging is refused while a Firestore emulator host is set", () => {
  const plan = resolveRunPlan({ ...approvedStage, emulatorHost: "127.0.0.1:8080" });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /FIRESTORE_EMULATOR_HOST/);
});

test("staging is refused without Application Default Credentials", () => {
  const plan = resolveRunPlan({ ...approvedStage, credentialPath: "" });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /Application Default Credentials/);
});

test("staging may not replay offline fixtures instead of the live sources", () => {
  const plan = resolveRunPlan({ ...approvedStage, offlineDir: "collector/tests/fixtures" });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /dry-run-only/);
});

test("max items defaults, is capped, and can never be unlimited", () => {
  const fallback = resolveRunPlan({ ...approvedStage, maxItems: undefined });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.maxItems, DEFAULT_MAX_ITEMS);
  assert.equal(fallback.argv[fallback.argv.indexOf("--max-items") + 1], String(DEFAULT_MAX_ITEMS));

  // 0 means "unlimited" to the CLI, so it must be refused here.
  for (const maxItems of ["0", 0]) {
    const plan = resolveRunPlan({ ...approvedStage, maxItems });
    assert.equal(plan.ok, false, "0 must be refused");
    assert.match(plan.reason, /at least 1/);
  }

  for (const maxItems of [MAX_ITEMS_CAP + 1, "1000"]) {
    assert.equal(resolveRunPlan({ ...approvedStage, maxItems }).ok, false, "over the cap is refused");
  }

  for (const maxItems of ["abc", "-5", 1.5, "1e9"]) {
    assert.equal(resolveRunPlan({ ...approvedStage, maxItems }).ok, false, `${maxItems} is not a cap`);
  }

  const atCap = resolveRunPlan({ ...approvedStage, maxItems: MAX_ITEMS_CAP });
  assert.equal(atCap.ok, true);
  assert.equal(atCap.maxItems, MAX_ITEMS_CAP);
});

test("flag-like values are rejected instead of being passed through", () => {
  assert.equal(resolveRunPlan({ mode: "dry-run", sources: ["--write"] }).ok, false);
  assert.equal(resolveRunPlan({ mode: "dry-run", panes: ["--allow-production"] }).ok, false);
  assert.equal(resolveRunPlan({ mode: "dry-run", offlineDir: "--write" }).ok, false);
  assert.equal(
    resolveRunPlan({ ...approvedStage, projectId: "--allow-production" }).ok,
    false,
    "a flag-like project id can never satisfy the allowlist",
  );

  const injected = resolveRunPlan({ mode: "dry-run", sources: ["notifications,--write"] });
  assert.equal(injected.ok, false);
});

test("malformed numeric inputs are refused", () => {
  assert.equal(resolveRunPlan({ mode: "dry-run", timeoutMs: "soon" }).ok, false);
  assert.equal(resolveRunPlan({ mode: "dry-run", gapMs: "-1" }).ok, false);
});

test("no plan can ever contain a flag outside the allowlist", () => {
  const plans = [
    resolveRunPlan({}),
    resolveRunPlan({ mode: "dry-run", offlineDir: "fixtures", sources: ["notifications"], panes: "notification", timeoutMs: 1, gapMs: 1 }),
    resolveRunPlan(approvedStage),
  ];
  for (const plan of plans) {
    assert.equal(plan.ok, true);
    for (const flag of flagsOf(plan.argv)) {
      assert.ok(ALLOWED_FLAGS.includes(flag), `unexpected flag in argv: ${flag}`);
    }
    // Belt and braces: nothing that could publish, verify or delete.
    for (const forbidden of ["--publish", "--verify", "--delete", "--force", "--pin", "--yes"]) {
      assert.ok(!plan.argv.includes(forbidden), `${forbidden} must never be emitted`);
    }
  }
});

test("sources and panes are de-duplicated, comma lists included", () => {
  const plan = resolveRunPlan({
    mode: "dry-run",
    sources: ["notifications,exams", "notifications"],
    panes: ["notification", "notification"],
  });
  assert.deepEqual(plan.argv, ["--source", "notifications", "--source", "exams", "--panes", "notification"]);
});

test("resolveRunPlanFromEnv maps the documented environment keys", () => {
  const input = resolveRunPlanFromEnv({
    COLLECTOR_MODE: "stage",
    COLLECTOR_STAGING_ENABLED: "true",
    COLLECTOR_PROJECT_ID: PROJECT,
    COLLECTOR_DATABASE_ID: "staging",
    COLLECTOR_MAX_ITEMS: "7",
    COLLECTOR_OFFLINE_DIR: "fixtures",
    COLLECTOR_SOURCES: "notifications,exams",
    COLLECTOR_PANES: "notification",
    COLLECTOR_TIMEOUT_MS: "1000",
    COLLECTOR_GAP_MS: "500",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/sa.json",
    FIRESTORE_EMULATOR_HOST: "",
  });
  assert.deepEqual(input, {
    mode: "stage",
    stagingEnabled: "true",
    projectId: PROJECT,
    databaseId: "staging",
    credentialPath: "/tmp/sa.json",
    emulatorHost: "",
    maxItems: "7",
    offlineDir: "fixtures",
    sources: "notifications,exams",
    panes: "notification",
    timeoutMs: "1000",
    gapMs: "500",
  });
  assert.equal(
    resolveRunPlan({ ...input, offlineDir: undefined }).ok,
    true,
    "the mapped environment is a valid staging run once the dry-run-only input is dropped",
  );
  assert.equal(
    resolveRunPlan(input).ok,
    false,
    "the same environment is refused while --offline is set: staging must read the live sources",
  );
});

test("an empty environment schedules a dry run, not a write", () => {
  const plan = resolveRunPlan(resolveRunPlanFromEnv({}));
  assert.equal(plan.ok, true);
  assert.equal(plan.writes, false);
  assert.deepEqual(plan.argv, []);
});

test("a staging run is pinned to the staging database, never (default)", () => {
  const plan = resolveRunPlan(approvedStage);
  assert.equal(plan.ok, true);
  assert.equal(plan.databaseId, STAGING_DATABASE_ID);
  assert.equal(STAGING_DATABASE_ID, "staging");
  assert.match(plan.summary, /jntuh-notes-6ef74\/staging/);
  // The pinned database is not a flag, so a caller can never redirect it.
  assert.ok(!plan.argv.some((token) => String(token).includes("(default)")));
  assert.ok(!plan.argv.includes("--database"));
  assert.equal(ALLOWED_FLAGS.includes("--database"), false);
});

test("a runner that names any other database is refused (fail closed)", () => {
  for (const databaseId of ["(default)", "default", "prod", "alerts"]) {
    const plan = resolveRunPlan({ ...approvedStage, databaseId });
    assert.equal(plan.ok, false, `expected database "${databaseId}" to be refused`);
    assert.match(plan.reason, /database/);
    assert.deepEqual(plan.argv, []);
  }
});

test("an unset COLLECTOR_DATABASE_ID keeps the pinned staging database", () => {
  for (const databaseId of [undefined, null, "", "  ", "staging"]) {
    const plan = resolveRunPlan({ ...approvedStage, databaseId });
    assert.equal(plan.ok, true);
    assert.equal(plan.databaseId, STAGING_DATABASE_ID);
  }
});

// --- the runner entry point -------------------------------------------------

function fakeSpawn(record) {
  return (command, args, options) => {
    record.push({ command, args, options });
    const child = new EventEmitter();
    child.on("exit", () => {});
    setImmediate(() => child.emit("exit", 0, null));
    return child;
  };
}

/** Let the fake child's `exit` event (scheduled with setImmediate) run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the entry point refuses arguments instead of silently ignoring them", () => {
  assert.equal(explainUnexpectedArguments([]), null);
  assert.match(explainUnexpectedArguments(["--help"]), /no arguments/);
  assert.match(explainUnexpectedArguments(["--project", "other"]), /unexpected arguments/);
  assert.match(explainUnexpectedArguments(["--allow-production"]), /COLLECTOR_/);
});

test("runScheduled refuses before spawning when the policy says no", () => {
  const spawned = [];
  const exits = [];
  const errors = [];
  const result = runScheduled(
    { COLLECTOR_MODE: "stage", COLLECTOR_PROJECT_ID: PROJECT },
    { spawnFn: fakeSpawn(spawned), writeErr: (t) => errors.push(t), onExit: (code) => exits.push(code) },
  );
  assert.equal(result.ok, false);
  assert.equal(spawned.length, 0, "no process is started when the run is refused");
  assert.deepEqual(exits, [2]);
  assert.match(errors.join(""), /refused/);
});

test("runScheduled spawns the CLI with the policy argv only", async () => {
  const spawned = [];
  const exits = [];
  const out = [];
  const result = runScheduled(
    { COLLECTOR_MODE: "dry-run", COLLECTOR_SOURCES: "notifications" },
    { spawnFn: fakeSpawn(spawned), writeOut: (t) => out.push(t), onExit: (code) => exits.push(code) },
  );
  await tick();
  assert.equal(result.ok, true);
  assert.equal(result.mode, RUN_MODE.DRY_RUN);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].args[0].endsWith("index.mjs"), true, "it delegates to the ordinary CLI");
  assert.deepEqual(spawned[0].args.slice(1), ["--source", "notifications"]);
  assert.match(out.join(""), /dry run/);
  assert.deepEqual(exits, [0]);
});

test("runScheduled propagates a non-zero CLI exit code", async () => {
  const exits = [];
  const failing = (command, args, options) => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", 4, null));
    return child;
  };
  const result = runScheduled({ COLLECTOR_MODE: "dry-run" }, { spawnFn: failing, onExit: (code) => exits.push(code) });
  await tick();
  assert.equal(result.ok, true);
  assert.deepEqual(exits, [4], "a write failure must fail the scheduled run");
});
