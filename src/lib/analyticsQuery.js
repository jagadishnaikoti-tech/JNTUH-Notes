// ---------------------------------------------------------------------------
// Admin-side analytics: fetch recorded events and aggregate them for the
// dashboard. Aggregation is a pure, dependency-free function so it can be unit
// tested and reused; only `fetchEvents` touches Firestore.
//
// Methodology (shown in the dashboard too):
//   * Page views  = number of page_view events.
//   * PDF clicks  = number of pdf_click events (an intent: open/download/view).
//   * Sessions    = distinct sessionId values (30-min inactivity window).
//   * Estimated unique visitors = distinct anonymous visitorId values.
// These are anonymous-browser estimates, not counts of real people.
// ---------------------------------------------------------------------------

import { getFirebaseApp, loadFirestore } from "./firebase.js";

export const DEFAULT_MAX_EVENTS = 5000;

/** Milliseconds for an event, tolerating Firestore Timestamp or plain numbers. */
export function eventMillis(event) {
  const ts = event?.ts;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  if (typeof event?.tsClient === "number") return event.tsClient;
  return 0;
}

export function rangeForDays(days) {
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  return { startMs, endMs, days, max: DEFAULT_MAX_EVENTS };
}

/**
 * Fetch events in [startMs, endMs]. A single-field range on `ts` with a matching
 * orderBy needs no composite index, so this works on a brand-new project.
 */
export async function fetchEvents({ startMs, endMs, max = DEFAULT_MAX_EVENTS } = {}) {
  const app = await getFirebaseApp();
  if (!app) return [];
  const { getFirestore, collection, query, where, orderBy, limit, getDocs, Timestamp } =
    await loadFirestore();
  const db = getFirestore(app);
  const q = query(
    collection(db, "analyticsEvents"),
    where("ts", ">=", Timestamp.fromMillis(startMs)),
    where("ts", "<=", Timestamp.fromMillis(endMs)),
    orderBy("ts", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function bump(map, key, init) {
  const current = map.get(key) || init();
  map.set(key, current);
  return current;
}

/** Pure aggregation of raw events into dashboard metrics. */
export function aggregate(events) {
  const topPages = new Map();
  const pdfs = new Map();
  const subjects = new Map();
  const years = new Map();
  const visitors = new Set();
  const sessions = new Set();
  const daily = new Map();
  let pageViews = 0;
  let pdfClicks = 0;

  const day = (ms) => {
    if (!ms) return "unknown";
    try {
      return new Date(ms).toISOString().slice(0, 10);
    } catch {
      return "unknown";
    }
  };

  for (const e of events) {
    const ms = eventMillis(e);
    const key = day(ms);
    const row = bump(daily, key, () => ({
      date: key,
      pageViews: 0,
      pdfClicks: 0,
      visitors: new Set(),
    }));
    if (e.visitorId) {
      visitors.add(e.visitorId);
      row.visitors.add(e.visitorId);
    }
    if (e.sessionId) sessions.add(e.sessionId);

    if (e.type === "page_view") {
      pageViews += 1;
      row.pageViews += 1;
      const p = e.path || "(unknown)";
      bump(topPages, p, () => ({ path: p, count: 0 })).count += 1;
    } else if (e.type === "pdf_click") {
      pdfClicks += 1;
      row.pdfClicks += 1;
      const id = e.docId || "(unknown)";
      const rec = bump(pdfs, id, () => ({
        docId: id,
        title: e.docTitle || "",
        subject: e.subject || "",
        yearName: e.yearName || "",
        open: 0,
        download: 0,
        view: 0,
        total: 0,
      }));
      if (e.docTitle && !rec.title) rec.title = e.docTitle;
      if (e.subject && !rec.subject) rec.subject = e.subject;
      if (e.yearName && !rec.yearName) rec.yearName = e.yearName;
      if (e.action === "download") rec.download += 1;
      else if (e.action === "view") rec.view += 1;
      else rec.open += 1;
      rec.total += 1;

      const subject = e.subject || "Unknown subject";
      bump(subjects, subject, () => ({ subject, count: 0 })).count += 1;
      const yearName = e.yearName || "Unknown year";
      bump(years, yearName, () => ({ yearName, count: 0 })).count += 1;
    }
  }

  const byCount = (a, b) => b.count - a.count;

  return {
    totals: {
      pageViews,
      pdfClicks,
      visitors: visitors.size,
      sessions: sessions.size,
    },
    topPages: [...topPages.values()].sort(byCount).slice(0, 25),
    topPdfs: [...pdfs.values()].sort((a, b) => b.total - a.total).slice(0, 50),
    bySubject: [...subjects.values()].sort(byCount),
    byYear: [...years.values()].sort(byCount),
    daily: [...daily.values()]
      .map((d) => ({ ...d, visitors: d.visitors.size }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    recent: [...events]
      .sort((a, b) => eventMillis(b) - eventMillis(a))
      .slice(0, 20),
  };
}

/**
 * Roll the daily series up into ISO weeks (weeks start on Monday). `visitors`
 * is summed across the week's days, so it over-counts a browser that returns on
 * a different day; it is shown as a trend, not a headcount.
 */
export function weeklyFromDaily(daily = []) {
  const weeks = new Map();
  for (const d of daily) {
    if (!d || !d.date || d.date === "unknown") continue;
    const dt = new Date(`${d.date}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) continue;
    const mondayOffset = (dt.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(dt.getTime() - mondayOffset * 86400000)
      .toISOString()
      .slice(0, 10);
    const row =
      weeks.get(start) || { date: start, pageViews: 0, pdfClicks: 0, visitors: 0 };
    row.pageViews += d.pageViews || 0;
    row.pdfClicks += d.pdfClicks || 0;
    row.visitors += d.visitors || 0;
    weeks.set(start, row);
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Does this event look like real recorded data (for empty-state decisions)? */
export function hasData(stats) {
  return Boolean(stats && (stats.totals.pageViews > 0 || stats.totals.pdfClicks > 0));
}
