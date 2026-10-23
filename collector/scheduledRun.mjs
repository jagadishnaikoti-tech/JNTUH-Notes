#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Collector - scheduled runner entry point.
//
// This is what a scheduled runner calls (`npm run collector:schedule`, or the
// GitHub Actions workflow in .github/workflows/collect-alerts.yml). It adds no
// second collection pipeline and no new write path: it resolves the run policy
// (lib/runPolicy.mjs) from the environment and then executes the ordinary CLI
// (collector/index.mjs) as a child process. Every guard the CLI already applies
// - project allowlist, emulator/live separation, staging-collection
// allowlist, operation caps - therefore still applies on top of the policy's.
//
// Deliberately does NOT forward process.argv: a caller must not be able to add
// flags (for example a project id) that the policy did not approve. Any argument
// at all is refused with a usage message rather than silently ignored, so
// `scheduledRun.mjs --help` can never turn into a network run by surprise.
// Everything is configured through COLLECTOR_* environment variables.
//
// Exit codes: 2 when the policy refuses, otherwise the CLI's own code
// (0 ok, 1 a source failed, 2 usage error, 3 refused by a safety guard,
// 4 write failed).
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRunPlan, resolveRunPlanFromEnv } from "./lib/runPolicy.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.mjs");

/**
 * Resolve and run one collector pass. Exported so a test can drive it with an
 * injected `spawn` without starting a real process.
 *
 * @param {Record<string,string|undefined>} [env]
 * @param {(command: string, args: string[], options: object) => object} [spawnFn]
 * @param {(text: string) => void} [writeErr]
 * @param {(code: number|null, signal: string|null) => void} [onExit]
 * @returns {{ok: true, mode: string, argv: string[]}|{ok: false, reason: string}}
 */
export function runScheduled(
  env = process.env,
  { spawnFn = spawn, writeOut = (t) => process.stdout.write(t), writeErr = (t) => process.stderr.write(t), onExit = null } = {},
) {
  const plan = resolveRunPlan(resolveRunPlanFromEnv(env));
  if (!plan.ok) {
    writeErr(`scheduled collector refused: ${plan.reason}\n`);
    if (onExit) onExit(2, null);
    return { ok: false, reason: plan.reason };
  }

  writeOut(`scheduled collector: ${plan.summary}\n`);

  const child = spawnFn(process.execPath, [CLI, ...plan.argv], { stdio: "inherit", env });

  child.on("error", (error) => {
    writeErr(`scheduled collector could not start: ${error?.message ?? error}\n`);
    if (onExit) onExit(2, null);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      writeErr(`scheduled collector was terminated by ${signal}\n`);
      if (onExit) onExit(1, signal);
      return;
    }
    if (onExit) onExit(code ?? 1, null);
  });

  return { ok: true, mode: plan.mode, argv: plan.argv };
}

/**
 * This entry point takes no arguments: a caller must not be able to add flags
 * that the policy did not approve. Returns a reason when arguments are present.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {string|null} a refusal reason, or null when there are none
 */
export function explainUnexpectedArguments(argv = []) {
  if (!argv.length) return null;
  return (
    `unexpected arguments (${argv.join(" ")}): this entry point takes no arguments. ` +
    "Configure a run with the COLLECTOR_* environment variables (see collector/SCHEDULING.md)."
  );
}

/** Run one scheduled pass from the real process, setting the exit code. */
function main() {
  const unexpected = explainUnexpectedArguments(process.argv.slice(2));
  if (unexpected) {
    process.stderr.write(`scheduled collector refused: ${unexpected}\n`);
    process.exitCode = 2;
    return;
  }

  const result = runScheduled(process.env, {
    onExit: (code) => {
      process.exitCode = code;
    },
  });
  if (!result.ok) process.exitCode = 2;
}

// Only run when invoked directly (importing this module in a test must not
// start a collector).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main();
}
