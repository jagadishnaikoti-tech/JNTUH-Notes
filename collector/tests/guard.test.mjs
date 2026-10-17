// ---------------------------------------------------------------------------
// Write-safety guards for the collector.
//
// These tests are the machine-checkable half of the Phase 2 promise: the
// collector's only Firestore access is the narrowly-scoped staging store in
// lib/firestoreAdmin.mjs, the planning modules are pure data transforms, and no
// credential material lives in the collector at all.
//
// Scans cover *implementation* modules only (collector/index.mjs, lib/, sources/);
// the tests directory is excluded so a test may name the very APIs it forbids.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_ITEM_FIELDS,
  COLLECTOR_ITEM_FIELDS,
  REVIEW_STATES,
  planIngest,
} from "../lib/ingestPlan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLLECTOR_DIR = path.join(ROOT, "collector");
const CLI = path.join(COLLECTOR_DIR, "index.mjs");

/** Every collector module that is *not* a test. */
function implementationFiles(dir = COLLECTOR_DIR) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") continue;
      out.push(...implementationFiles(full));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

const IMPLEMENTATION = implementationFiles();

function implementationSources() {
  return IMPLEMENTATION.map((file) => ({
    file,
    rel: path.relative(ROOT, file).split(path.sep).join("/"),
    source: readFileSync(file, "utf8"),
  }));
}

/**
 * The one module allowed to import the Admin SDK and touch Firestore. It is the
 * collector's entire write surface; everything else must stay dependency-free.
 */
const ADMIN_REL = "collector/lib/firestoreAdmin.mjs";

/** Modules whose whole job is to *redact* secret-looking text, so they may name it. */
const REDACTION_MODULES = new Set(["collector/lib/runReport.mjs"]);

/** Every module specifier a source file imports. */
function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

/**
 * The bindings a module introduces: import specifiers (named/default/namespace),
 * its own top-level const/let/var/function/class declarations, and names it
 * re-exports. Used to prove a module never references a shared constant it
 * forgot to import - the exact shape of the `STAGING_COLLECTIONS is not defined`
 * write-mode failure.
 */
function boundNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bimport\s*\{([\s\S]*?)\}\s*from/g)) {
    for (const part of match[1].split(",")) {
      const alias = part.split(/\bas\b/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias)) names.add(alias);
    }
  }
  for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  // Destructuring declarations bind their identifiers too: `const { SOURCE } = mod`.
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const token of match[1].matchAll(/[A-Za-z_$][\w$]*/g)) names.add(token[0]);
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const token of match[1].matchAll(/[A-Za-z_$][\w$]*/g)) names.add(token[0]);
  }
  return names;
}

/** Uppercase constants exported by the collector's implementation modules. */
function sharedConstantNames(sources) {
  const names = new Set();
  const add = (value) => {
    if (/^[A-Z][A-Z0-9_]*$/.test(value)) names.add(value);
  };
  for (const { source } of sources) {
    for (const match of source.matchAll(/\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
      add(match[1]);
    }
    for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}\s*(?:from\b|;)/g)) {
      for (const part of match[1].split(",")) add(part.split(/\bas\b/).pop().trim());
    }
  }
  return names;
}

/** Firestore / Admin SDK APIs that would mean a write path has appeared. */
const FIRESTORE_WRITE_TOKENS = [
  "writeBatch", "runTransaction", "bulkWriter",
  "setDoc", "addDoc", "updateDoc", "deleteDoc",
  "getFirestore", "initializeApp", "applicationDefault",
  "collection(", "doc(db", "firebase/firestore",
];

/** Filesystem APIs that would let a run mutate the working tree. */
const FILESYSTEM_WRITE_TOKENS = [
  "writeFile", "appendFile", "createWriteStream",
  "mkdir", "rmdir", "unlink", "copyFile", "writeSync", "openSync", "truncate(",
];

/** Credential material that must never be present in the collector. */
const CREDENTIAL_TOKENS = [
  "firebase-adminsdk", "serviceAccount", "private_key",
  "client_email", "PRIVATE KEY", "BEGIN RSA", "BEGIN EC PRIVATE",
];

/**
 * Unambiguous secret material. Unlike the field *names* above (which the
 * redaction module legitimately mentions), these patterns can only appear if a
 * real secret has been pasted into a source file.
 */
const HARD_SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"type"\s*:\s*"service_account"/,
  /"private_key_id"\s*:\s*"/,
];

/** Recursively assert a value is plain JSON-able data (no functions/handles). */
function assertPlainData(value, at = "$", seen = new Set()) {
  if (value === null) return;
  const kind = typeof value;
  assert.notEqual(kind, "function", `${at} must not be a function`);
  assert.notEqual(kind, "symbol", `${at} must not be a symbol`);
  if (kind !== "object") return;
  if (value instanceof Date) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) assertPlainData(entry, `${at}.${key}`, seen);
}

test("the guard actually scans the implementation modules", () => {
  assert.ok(IMPLEMENTATION.length >= 10, "expected to find the collector implementation");
  assert.ok(
    IMPLEMENTATION.some((file) => file.endsWith(path.join("collector", "index.mjs"))),
    "the CLI entry point must be part of the scan",
  );
  assert.ok(
    IMPLEMENTATION.every((file) => !file.includes(`${path.sep}tests${path.sep}`)),
    "tests must be excluded from the implementation scan",
  );
});

test("the CLI still defaults to a read-only dry run", () => {
  const source = readFileSync(CLI, "utf8");
  // --write exists, but must be declared `default: false` so a bare invocation
  // stays a dry run.
  assert.match(source, /write:\s*\{\s*type:\s*"boolean",\s*default:\s*false\s*\}/);
  assert.match(source, /dryRun:\s*true/, "the JSON report must still declare a dry run");
  assert.match(source, /firestoreInitialised:\s*false/, "the report must still declare no Firestore init");
  // The gating messages must be present so the guards cannot be removed silently.
  assert.match(source, /--write requires --project/);
  assert.match(source, /production writes require --allow-production/i);
});

test("the CLI advertises its dry-run default and guarded write mode in --help", () => {
  const out = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.match(out, /dry run/i);
  assert.match(out, /--write\b/);
  assert.match(out, /--allow-production\b/);
  assert.match(out, /--emulator\b/);
  assert.match(out, /FIRESTORE_EMULATOR_HOST/);
});

test("no collector implementation module imports a non-builtin dependency except the admin store", () => {
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    for (const spec of importSpecifiers(source)) {
      const isBuiltin = spec.startsWith("node:");
      const isRelative = spec.startsWith(".");
      if (isBuiltin || isRelative) continue;
      if (rel === ADMIN_REL && spec.startsWith("firebase-admin")) continue;
      offenders.push(`${rel} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, [], "only lib/firestoreAdmin.mjs may import firebase-admin");
});

test("only the admin store references a Firestore write API", () => {
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    if (rel === ADMIN_REL) continue;
    for (const token of FIRESTORE_WRITE_TOKENS) {
      if (source.includes(token)) offenders.push(`${rel} -> ${token}`);
    }
  }
  assert.deepEqual(offenders, [], "the collector must not reference any Firestore write API outside the admin store");
});

test("every collector module imports each shared constant it references", () => {
  const sources = implementationSources();
  const shared = sharedConstantNames(sources);
  const offenders = [];
  for (const { rel, source } of sources) {
    const bound = boundNames(source);
    for (const name of shared) {
      if (bound.has(name)) continue;
      // A bare identifier use with no import/declaration is a ReferenceError at
      // run time; catch it here instead of mid --write. Member access
      // (`registry.SOURCE`) is not a free identifier, so ignore it.
      if (new RegExp(`(?<!\\.)\\b${name}\\b`).test(source)) offenders.push(`${rel} -> ${name}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a module referenced a shared constant it neither imported nor declared",
  );
});

test("no collector implementation module writes to the filesystem", () => {
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    for (const token of FILESYSTEM_WRITE_TOKENS) {
      if (source.includes(token)) offenders.push(`${rel} -> ${token}`);
    }
  }
  assert.deepEqual(offenders, [], "the collector must not write files");
});

test("no credential material appears anywhere in the collector", () => {
  const offenders = [];
  for (const { rel, source } of implementationSources()) {
    // The redaction module names these tokens only inside regexes that strip
    // them; it must never contain the material itself.
    if (!REDACTION_MODULES.has(rel)) {
      for (const token of CREDENTIAL_TOKENS) {
        if (source.includes(token)) offenders.push(`${rel} -> ${token}`);
      }
    }
    for (const pattern of HARD_SECRET_PATTERNS) {
      if (pattern.test(source)) offenders.push(`${rel} -> ${String(pattern)}`);
    }
  }
  assert.deepEqual(offenders, [], "the collector must carry no credentials");
});

test("the review vocabulary is exactly new / promoted / ignored", () => {
  assert.deepEqual([...REVIEW_STATES].sort(), ["ignored", "new", "promoted"]);
});

test("collector-owned and admin-owned item fields do not overlap", () => {
  const collectorOwned = new Set(COLLECTOR_ITEM_FIELDS);
  const clashes = ADMIN_ITEM_FIELDS.filter((field) => collectorOwned.has(field));
  assert.deepEqual(clashes, [], "a field must be owned by exactly one side");
});

test("every planned document field is a declared collector- or admin-owned field", () => {
  const declared = new Set([...COLLECTOR_ITEM_FIELDS, ...ADMIN_ITEM_FIELDS]);
  const now = new Date(Date.UTC(2026, 9, 17));
  const canonicalUrl = "https://jntuh.ac.in/uploads/notifications/a.pdf";
  const base = {
    sourceId: "notifications",
    sourceName: "JNTUH Notifications",
    category: "general",
    title: "Fee notification",
    noticeDate: new Date(Date.UTC(2026, 9, 15)),
    sourceUrl: canonicalUrl,
    sourceUrlFallback: false,
    documentUrl: canonicalUrl,
    canonicalUrl,
    attachments: [],
    position: 1,
  };

  const first = planIngest([base], { runId: "r1", now });
  const promoted = {
    ...first.documents[0],
    reviewState: "promoted",
    promotedAlertId: "a1",
    promotedAt: now,
    promotedBy: "admin@jntuh.example",
  };
  const second = planIngest([base], {
    existing: { [promoted.itemId]: promoted },
    runId: "r2",
    now,
  });

  for (const doc of second.documents) {
    for (const key of Object.keys(doc)) {
      assert.ok(declared.has(key), `undeclared ingest field: ${key}`);
    }
  }
});

test("planIngest returns plain data and no alert lifecycle field", () => {
  const now = new Date(Date.UTC(2026, 9, 17));
  const canonicalUrl = "https://jntuh.ac.in/uploads/notifications/a.pdf";
  const result = planIngest(
    [{ sourceId: "notifications", title: "T", category: "general", canonicalUrl, documentUrl: canonicalUrl }],
    { runId: "r", now },
  );

  assert.deepEqual(
    Object.keys(result).sort(),
    ["deferredItemIds", "documents", "stats", "unaddressableNotices"],
  );

  // Plain data: serialisable, no live handles or closures anywhere in the tree.
  assertPlainData(result);
  assert.doesNotThrow(() => JSON.stringify(result));

  for (const doc of result.documents) {
    assert.ok(!("status" in doc), "an ingest document must never carry an alert status");
  }
});
