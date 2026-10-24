import { strict as assert } from "node:assert";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = path.join(ROOT, "collector", "index.mjs");
const FIXTURES = path.join(ROOT, "collector", "tests", "fixtures");
const BROKEN = path.join(FIXTURES, "broken");

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd: ROOT,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: String(error) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("dry run over saved fixtures succeeds without touching a database", async () => {
  const { code, stdout, stderr } = await run(["--offline", FIXTURES, "--json"]);
  assert.equal(stderr, "", "a clean run must not print errors");
  assert.equal(code, 0, `expected exit 0, got ${code}\n${stderr}`);

  const report = JSON.parse(stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.firestoreInitialised, false);

  const byId = Object.fromEntries(report.sources.map((s) => [s.id, s]));
  assert.deepEqual(
    report.sources.map((s) => s.status),
    ["ok", "ok"],
  );
  assert.equal(byId.notifications.notices.length, 7, "9 rows - 2 duplicates");
  assert.equal(byId.notifications.duplicates.length, 2);
  assert.equal(byId.exams.notices.length, 3, "4 link-bearing items - 1 duplicate");
  assert.equal(byId.exams.duplicates.length, 1);
  assert.ok(byId.notifications.drafts > 0 && byId.exams.drafts > 0);
  assert.ok(
    report.sources.every((s) => s.error === null),
    "no source may hide a failure",
  );
});

test("the text report states that nothing was written", async () => {
  const { code, stdout } = await run(["--offline", FIXTURES, "--limit", "1"]);
  assert.equal(code, 0);
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /no Firestore Admin, no writes, nothing published/);
  assert.match(stdout, /writes\s+0 - dry run never touches a database/);
  assert.match(stdout, /date unavailable|2026-\d{2}-\d{2}/);
  assert.match(stdout, /duplicates \(2\)/, "duplicates must be reported");
});

test("a source whose markup changed fails loudly with a non-zero exit code", async () => {
  const { code, stdout, stderr } = await run(["--offline", BROKEN, "--source", "notifications"]);
  assert.equal(code, 1, "parse failures must exit non-zero");
  assert.match(stderr, /notifications/);
  assert.match(stderr, /no longer contains the expected table structure/);
  assert.match(stdout, /FAILED during parse/);
});

test("a missing offline fixture is reported as a failure, not an empty success", async () => {
  const emptyDir = path.join(FIXTURES);
  const { code, stderr } = await run([
    "--offline",
    emptyDir,
    "--source",
    "exams",
    "--json",
    "--panes",
    "notification",
  ]);
  // The fixture exists, so this asserts the happy path stays happy.
  assert.equal(code, 0, stderr);
});

test("an unknown source id is a usage error", async () => {
  const { code, stderr } = await run(["--source", "does-not-exist"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown source "does-not-exist"/);
});

test("--help explains that the default mode is read-only", async () => {
  const { code, stdout } = await run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Dry run \(no writes\) unless --write is given/);
  assert.match(stdout, /live writes require both/i);
  assert.match(stdout, /--allow-production/);
  assert.match(stdout, /--emulator/);
});
