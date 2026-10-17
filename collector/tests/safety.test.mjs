import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ALLOWED_ALERT_KEYS, toAlertDraft } from "../lib/alertDraft.mjs";
import { ALERT_CATEGORY_IDS } from "../../src/data/alertSources.js";
import { ALERT_STATUS, cleanAlert } from "../../src/lib/alerts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLLECTOR_DIR = path.join(ROOT, "collector");

function collectorModules(dir = COLLECTOR_DIR) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectorModules(full));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * Collector implementation modules only, each as `{ rel, source }` where `rel`
 * is relative to `collector/` (e.g. "lib/firestoreAdmin.mjs"). Test files are
 * excluded: they are allowed to *name* the APIs they forbid.
 */
function implementationSources() {
  const out = [];
  for (const file of collectorModules()) {
    if (path.relative(COLLECTOR_DIR, file).startsWith("tests")) continue;
    out.push({ rel: path.relative(COLLECTOR_DIR, file).split(path.sep).join("/"), source: readFileSync(file, "utf8") });
  }
  return out;
}

const ADMIN_MODULE = "lib/firestoreAdmin.mjs";

function readRules() {
  return readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
}

/** Pull a quoted list out of the first `pattern` capture group of the source. */
function quotedList(source, pattern) {
  const body = source.match(pattern)?.[1] ?? "";
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * The body of `function validAlert(d)` only. firestore.rules defines several
 * `keys().hasOnly([...])` guards (analytics events, channel docs, profiles);
 * scoping to this function is what keeps us comparing against the alerts
 * contract rather than an unrelated collection.
 */
function validAlertBody(rules) {
  const start = rules.indexOf("function validAlert");
  assert.ok(start !== -1, "could not find validAlert() in firestore.rules");
  const end = rules.indexOf("match /alerts/", start);
  return rules.slice(start, end === -1 ? undefined : end);
}

test("exactly one collector module imports the Firebase Admin SDK", () => {
  const importers = [];
  for (const { rel, source } of implementationSources()) {
    if (/from\s+["'][^"']*firebase[^"']*["']/.test(source) || /require\(\s*["'][^"']*firebase/.test(source)) {
      importers.push(rel);
    }
  }
  assert.deepEqual(importers, [ADMIN_MODULE], "firebase-admin must be confined to lib/firestoreAdmin.mjs");
});

test("no collector module references the public alert collection", () => {
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    if (/\.collection\(\s*["'`]alerts["'`]/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "no collector module may touch the alert collection");
});

test("the CLI entry point contains no Firestore/Admin initialization", () => {
  const source = readFileSync(path.join(COLLECTOR_DIR, "index.mjs"), "utf8");
  for (const forbidden of ["firebase-admin", "getFirestore", "initializeApp", "applicationDefault"]) {
    assert.ok(!source.includes(forbidden), `index.mjs must not reference "${forbidden}"`);
  }
  assert.ok(!/writeFile|appendFile|createWriteStream/.test(source), "index.mjs must not write files");
});

test("ALLOWED_ALERT_KEYS matches the hasOnly list in firestore.rules exactly", () => {
  const body = validAlertBody(readRules());
  const allowed = quotedList(body, /d\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(allowed.length > 0, "could not read the hasOnly list from firestore.rules");
  assert.deepEqual([...ALLOWED_ALERT_KEYS].sort(), allowed.sort());
});

test("the category ids used by the collector match firestore.rules", () => {
  const body = validAlertBody(readRules());
  const allowed = quotedList(body, /d\.category in \[([\s\S]*?)\]/);
  assert.ok(allowed.length > 0, "could not read the category list from firestore.rules");
  assert.deepEqual([...ALERT_CATEGORY_IDS].sort(), allowed.sort());
});

test("the rules' length limits are the limits the builder enforces", () => {
  const rules = validAlertBody(readRules());
  assert.match(rules, /isString\(d\.title, 200\) && d\.title\.size\(\) >= 3/);
  assert.match(rules, /isString\(d\.summary, 600\) && d\.summary\.size\(\) >= 1/);
  assert.match(rules, /isString\(d\.sourceName, 80\)/);
  assert.match(rules, /isString\(d\.sourceUrl, 500\)/);

  const { alert } = toAlertDraft({
    sourceId: "notifications",
    title: "x".repeat(500),
    category: "general",
    sourceName: "y".repeat(500),
    sourceUrl: "https://jntuh.ac.in/a.pdf",
    noticeDate: null,
  });
  assert.ok(alert.title.length <= 200);
  assert.ok(alert.sourceName.length <= 80);
  assert.ok(alert.sourceUrl.length <= 500);
});

test("the collector cannot produce a published alert by construction", () => {
  const { alert } = toAlertDraft({
    sourceId: "exams",
    title: "Notification for B.Tech II-I Regular Exams",
    category: "exams",
    sourceName: "JNTUH Examinations Portal",
    sourceUrl: "https://exams1.jntuh.ac.in/Portal/common/downloadFile?fileName=a.pdf",
    noticeDate: new Date(Date.UTC(2026, 9, 6)),
  });
  // The literal status plus cleared verification metadata mean the rules'
  // `published => verifiedAt && verifiedBy` invariant can never be satisfied
  // by collector output.
  assert.equal(alert.status, "draft");
  assert.equal(alert.verifiedAt, null);
  assert.equal(alert.verifiedBy, "");
  assert.equal(alert.pinned, false);
});

// ---------------------------------------------------------------------------
// Phase 2, Step 1 additions.
//
// These protect the *unwritten* half of Phase 2: the write path must not exist
// yet, no credentials may be committed, and every safeguard the alert workflow
// already relies on (publish/verify gates, the rules' published=>verified
// invariant, Phase 1 files and scripts) must still be exactly where it was.
// ---------------------------------------------------------------------------

const ALERTS_LIB = path.join(ROOT, "src", "lib", "alerts.js");

test("createAlert still refuses to create a published alert", () => {
  const source = readFileSync(ALERTS_LIB, "utf8");
  assert.match(source, /if \(fields\.status === ALERT_STATUS\.PUBLISHED\)/);
  assert.match(source, /New alerts always start as drafts/);
  assert.match(source, /verifiedAt: null/);
  assert.match(source, /verifiedBy: ""/);
});

test("publishAlert still requires verification and is the only publisher", () => {
  const source = readFileSync(ALERTS_LIB, "utf8");
  assert.match(source, /if \(!existing\.verifiedAt\)/);
  assert.match(source, /Verify this alert against the official source before publishing it/);

  const publishers = source.match(/status: ALERT_STATUS\.PUBLISHED/g) ?? [];
  assert.equal(publishers.length, 1, "publishing must have exactly one code path");
  assert.match(source, /status: ALERT_STATUS\.DRAFT/);
});

test("verifyAlert is the only writer of verification metadata", () => {
  const source = readFileSync(ALERTS_LIB, "utf8");
  const stampers = source.match(/verifiedAt: serverTimestamp\(\)/g) ?? [];
  assert.equal(stampers.length, 1, "only verifyAlert() may stamp verifiedAt");
  assert.match(source, /verifiedBy: who/);
});

test("cleanAlert still enforces title/summary/category/source and defaults to draft", () => {
  assert.equal(ALERT_STATUS.DRAFT, "draft");
  assert.equal(ALERT_STATUS.PUBLISHED, "published");

  const base = {
    title: "A valid alert title",
    summary: "A short summary.",
    category: "exams",
    sourceUrl: "https://jntuh.ac.in/uploads/notifications/a.pdf",
  };

  const cleaned = cleanAlert(base);
  assert.equal(cleaned.status, ALERT_STATUS.DRAFT, "a cleaned alert is a draft by default");
  assert.equal(cleaned.category, "exams");
  assert.equal(cleaned.pinned, false);
  assert.equal(cleaned.publishedAt, null, "no date may be invented");
  // Verification metadata is added by createAlert's write, never by validation -
  // so cleaning can never be a route to a verified/published alert.
  assert.ok(!("verifiedAt" in cleaned), "cleanAlert must not set verifiedAt");
  assert.ok(!("verifiedBy" in cleaned), "cleanAlert must not set verifiedBy");

  assert.throws(() => cleanAlert({ ...base, title: "x" }), /title/i);
  assert.throws(() => cleanAlert({ ...base, summary: "" }), /summary/i);
  assert.throws(() => cleanAlert({ ...base, category: "not-a-category" }), /category/i);
  assert.throws(() => cleanAlert({ ...base, sourceUrl: "ftp://jntuh.ac.in/a.pdf" }), /http/i);
});

test("the rules still require verification before publication", () => {
  const rules = validAlertBody(readRules());
  assert.match(rules, /d\.status != 'published'/);
  assert.match(rules, /d\.keys\(\)\.hasAll\(\['verifiedAt', 'verifiedBy'\]\)/);
});

test("the collector has a narrow Firestore staging writer (exactly one admin module)", () => {
  const forbidden = [
    "initializeApp",
    "getFirestore",
    "applicationDefault",
    "cert",
    "BulkWriter",
    "runTransaction",
  ];
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    if (rel === ADMIN_MODULE) continue;
    for (const token of forbidden) {
      if (source.includes(token)) offenders.push(rel + " -> " + token);
    }
  }
  assert.deepEqual(offenders, [], "only lib/firestoreAdmin.mjs may contain low-level Firestore setup");
});

test("no credential or service-account files are tracked by git", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const suspicious = tracked.filter((file) => {
    const name = path.basename(file).toLowerCase();
    if (/^\.env(\.|$)/.test(name) && !name.endsWith(".example")) return true;
    if (name.includes("firebase-adminsdk")) return true;
    if (/^serviceaccount.*\.json$/.test(name)) return true;
    if (/\.(pem|key|p12|pfx)$/.test(name)) return true;
    if (/credentials?.*\.json$/.test(name)) return true;
    return false;
  });

  assert.deepEqual(suspicious, [], "credential material must never be committed");
});

test(".gitignore still excludes credential files", () => {
  const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /serviceAccount\*\.json/);
  assert.match(ignore, /\*firebase-adminsdk\*\.json/);
  assert.match(ignore, /\*\.local/);
});

test("every Phase 1 collector file still exists", () => {
  const expected = [
    "collector/index.mjs",
    "collector/README.md",
    "collector/lib/alertDraft.mjs",
    "collector/lib/date.mjs",
    "collector/lib/dedup.mjs",
    "collector/lib/errors.mjs",
    "collector/lib/html.mjs",
    "collector/lib/http.mjs",
    "collector/lib/url.mjs",
    "collector/sources/notifications.mjs",
    "collector/sources/exams.mjs",
    "collector/tests/url.test.mjs",
    "collector/tests/dedup.test.mjs",
    "collector/tests/notifications.test.mjs",
    "collector/tests/exams.test.mjs",
    "collector/tests/alert-draft.test.mjs",
    "collector/tests/dry-run.test.mjs",
    "collector/tests/safety.test.mjs",
    "collector/tests/fixtures/notifications.html",
    "collector/tests/fixtures/exams.html",
  ];
  for (const rel of expected) {
    assert.ok(existsSync(path.join(ROOT, rel)), `Phase 1 file missing: ${rel}`);
  }
});

test("the Phase 1 collector scripts are still registered", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.collector, /collector\/index\.mjs/);
  assert.match(pkg.scripts["test:collector"], /collector\/tests/);
});

test("the public site bundle never depends on the Firebase Admin SDK", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
        if (/firebase-admin/.test(readFileSync(full, "utf8"))) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(offenders, [], "the frontend must never hold backend credentials");
});
