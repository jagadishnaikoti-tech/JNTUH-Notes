// ---------------------------------------------------------------------------
// CLI argument guards for the collector write path.
//
// The failure cases here must all be rejected *before* a Firestore client is
// created, so the suite never needs credentials, an emulator or a network. If
// one of these ever regresses to "exit 4", the guard has moved too late. The
// final case is the positive control: a dry run succeeds without initialising
// the Admin SDK.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = path.join(ROOT, "collector", "index.mjs");

/** Run the CLI with FIRESTORE_EMULATOR_HOST explicitly removed from the env. */
function run(args) {
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  return spawnSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, env, encoding: "utf8" });
}

test("--write without --project fails as a usage error", () => {
  const { status, stderr } = run(["--write"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--write requires --project/);
});

test("--write with an unknown project fails closed", () => {
  const { status, stderr } = run(["--write", "--project", "someone-elses-project"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /unknown project/);
});

test("production write is refused before the --allow-production gate", () => {
  const { status, stderr } = run(["--write", "--project", "jntuh-notes-6ef74"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /refusing the production project/i);
  // Even with the live-write flag, production is never a target.
  const allowed = run([
    "--write",
    "--allow-production",
    "--project",
    "jntuh-notes-6ef74",
  ]);
  assert.equal(allowed.status, 2, allowed.stderr);
  assert.match(allowed.stderr, /refusing the production project/i);
});

test("a live staging write still requires --allow-production", () => {
  const { status, stderr } = run(["--write", "--project", "jntuh-notes-staging"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /live writes require --allow-production/i);
});

test("--emulator without --write is a usage error", () => {
  const { status, stderr } = run(["--emulator"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--emulator requires --write/);
});

test("--allow-production without --write is a usage error", () => {
  const { status, stderr } = run(["--allow-production"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--allow-production requires --write/);
});

test("--emulator without FIRESTORE_EMULATOR_HOST is refused", () => {
  const { status, stderr } = run(["--write", "--emulator", "--project", "jntuh-notes-staging"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--emulator requires FIRESTORE_EMULATOR_HOST/);
});

test("--emulator cannot be combined with --allow-production", () => {
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
  const { status, stderr } = spawnSync(
    process.execPath,
    [ENTRY, "--write", "--emulator", "--allow-production", "--project", "jntuh-notes-staging"],
    { cwd: ROOT, env, encoding: "utf8" },
  );
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--emulator cannot be combined with --allow-production/);
});

test("--max-items must be a non-negative integer", () => {
  const { status, stderr } = run(["--max-items", "lots"]);
  assert.equal(status, 2, stderr);
  assert.match(stderr, /--max-items must be a non-negative integer/);
});

test("a dry run with --project still succeeds and reports no Firestore init", () => {
  const { status, stdout, stderr } = run([
    "--offline",
    "collector/tests/fixtures",
    "--json",
    "--project",
    "jntuh-notes-staging",
  ]);
  assert.equal(status, 0, stderr);
  const report = JSON.parse(stdout);
  // The dry-run report explicitly declares that the Admin SDK was never
  // initialised, and records the requested (staging) target.
  assert.equal(report.dryRun, true);
  assert.equal(report.firestoreInitialised, false);
  assert.equal(report.targetProject, "jntuh-notes-staging");
});
