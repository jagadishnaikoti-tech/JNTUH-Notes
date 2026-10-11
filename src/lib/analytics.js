// ---------------------------------------------------------------------------
// First-party visitor analytics for the public website.
//
// What this records (Firestore collection `analyticsEvents`, the dashboard's
// source of truth):
//   - page_view           { path, title }
//   - pdf_click           { docId, docTitle, subject, yearId, yearName,
//                           action, sourcePath, sourceTitle }
//
// Privacy model
//   * No personal data, no IP addresses, no emails, no user-agent strings.
//   * A random, anonymous browser id ("visitor id") in localStorage stands in
//     for "estimated unique visitors". It is not tied to any real person.
//   * A per-session id in sessionStorage distinguishes sessions.
//   * When VITE_REQUIRE_CONSENT=true nothing is recorded until the visitor
//     accepts the consent banner.
//
// Reliability
//   * Every write is best-effort: failures are swallowed so analytics can never
//     break the site.
//   * Page views are de-duplicated (React StrictMode double-invokes effects,
//     and remounts can repeat an effect) within a short window.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadAnalytics, loadFirestore, isFirebaseConfigured } from "./firebase.js";

const CONSENT_KEY = "ln:analytics-consent";
const VISITOR_KEY = "ln:visitor-id";
const SESSION_KEY = "ln:session";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min of inactivity starts a session
const PAGEVIEW_DEDUPE_MS = 4000;
const PDF_DEDUPE_MS = 800;
const MAX_FIELD = 300;

const REQUIRE_CONSENT =
  String(import.meta.env.VITE_REQUIRE_CONSENT || "").toLowerCase() === "true";

// --- small storage helpers (all guarded; private mode must not throw) -------

function readStorage(kind, key) {
  try {
    return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(kind, key, value) {
  try {
    (kind === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    /* storage disabled - tracking degrades to non-persistent */
  }
}

function uuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const clip = (v) => (typeof v === "string" ? v.slice(0, MAX_FIELD) : "");

// --- identity ---------------------------------------------------------------

/** Stable, anonymous, browser-scoped id. Not a person identifier. */
export function getVisitorId() {
  let id = readStorage("local", VISITOR_KEY);
  if (!id) {
    id = uuid();
    writeStorage("local", VISITOR_KEY, id);
  }
  return id;
}

/** Session id, refreshed after SESSION_TTL_MS of inactivity. */
export function getSessionId() {
  const now = Date.now();
  let data = null;
  const raw = readStorage("session", SESSION_KEY);
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!data || !data.id || now - (data.t || 0) > SESSION_TTL_MS) {
    data = { id: uuid(), t: now };
  } else {
    data.t = now;
  }
  writeStorage("session", SESSION_KEY, JSON.stringify(data));
  return data.id;
}

// --- consent ----------------------------------------------------------------

export function isConsentRequired() {
  return REQUIRE_CONSENT;
}

export function getConsent() {
  const v = readStorage("local", CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

export function setConsent(value) {
  const granted = value === "granted";
  writeStorage("local", CONSENT_KEY, granted ? "granted" : "denied");
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: granted ? "granted" : "denied",
      });
    }
  } catch {
    /* gtag missing - fine */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("ln:consent-change", { detail: granted ? "granted" : "denied" })
    );
  } catch {
    /* no window - fine */
  }
}

/** True when analytics may record right now. */
export function analyticsAllowed() {
  if (typeof window === "undefined") return false;
  if (!isFirebaseConfigured) return false;
  return !REQUIRE_CONSENT || getConsent() === "granted";
}

// --- transport --------------------------------------------------------------

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = loadFirestore().catch((err) => {
      console.warn("[analytics] firestore unavailable:", err);
      return null;
    });
  }
  return sdkPromise;
}

/** Best-effort fan-out to GA4 (existing gtag tag + Firebase Analytics). */
function emitToProviders(name, params) {
  const safe = {};
  for (const [k, v] of Object.entries(params)) safe[k] = clip(String(v));
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", name, safe);
    }
  } catch {
    /* ignore */
  }
  loadAnalytics()
    .then((mod) => {
      try {
        mod?.logEvent?.(mod.analytics, name, safe);
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
}

async function record(payload) {
  const mod = await loadSdk();
  if (!mod) return;
  const app = await getFirebaseApp();
  if (!app) return;
  try {
    const { getFirestore, collection, addDoc, serverTimestamp } = mod;
    const db = getFirestore(app);
    await addDoc(collection(db, "analyticsEvents"), {
      ...payload,
      ts: serverTimestamp(),
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
    });
  } catch (err) {
    // Analytics must never surface an error to the visitor.
    if (import.meta.env.DEV) console.debug("[analytics] write skipped:", err?.code || err);
  }
}

// --- public API -------------------------------------------------------------

let lastPageView = { key: null, at: 0 };

/** Record one page view, de-duplicating StrictMode/remount repeats. */
export function trackPageView({ path, title } = {}) {
  if (!analyticsAllowed()) return;
  if (typeof document === "undefined") return;
  if (!path || path.startsWith("/admin")) return;

  const key = path;
  const now = Date.now();
  if (key === lastPageView.key && now - lastPageView.at < PAGEVIEW_DEDUPE_MS) return;
  lastPageView = { key, at: now };

  const pageTitle = clip(title || document.title || "");
  record({ type: "page_view", path: clip(path), title: pageTitle });
  emitToProviders("page_view", { page_path: path, page_title: title || "" });
}

let lastPdf = { key: null, at: 0 };

/**
 * Record a PDF/document interaction. `action` is one of "open" | "view" |
 * "download" and describes the *click*, not a confirmed successful download.
 */
export function trackPdfClick({
  docId,
  docTitle,
  subject,
  yearId,
  yearName,
  action,
  sourcePath,
  sourceTitle,
}) {
  if (!analyticsAllowed()) return;
  if (!docId || !action) return;
  const key = `${docId}|${action}`;
  const now = Date.now();
  if (key === lastPdf.key && now - lastPdf.at < PDF_DEDUPE_MS) return;
  lastPdf = { key, at: now };

  const path = sourcePath || (typeof window !== "undefined" ? window.location.pathname : "");
  const title = docTitle || sourceTitle || "";

  record({
    type: "pdf_click",
    docId: clip(docId),
    docTitle: clip(title),
    subject: clip(subject),
    yearId: clip(yearId),
    yearName: clip(yearName),
    action,
    sourcePath: clip(path),
    sourceTitle: clip(sourceTitle),
  });

  emitToProviders(`pdf_${action}`, {
    document_id: docId,
    document_title: title,
    subject: subject || "",
    year: yearName || "",
    action,
    page_path: path,
  });
}
