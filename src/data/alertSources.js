// ---------------------------------------------------------------------------
// JNTUH Alert Radar - official source references & category metadata.
//
// IMPORTANT
//   These are REFERENCE LINKS ONLY. The Alert Radar never scrapes, mirrors or
//   automatically re-publishes these pages, and this project is not affiliated
//   with, endorsed by or operated by JNTUH. An administrator verifies every
//   notice against the official source by hand before publishing it.
//
// The category ids below are the single source of truth for the allowed
// `category` values; they must stay in sync with the `alerts` block in
// firestore.rules.
// ---------------------------------------------------------------------------

/** Shown alongside alert content so the unofficial status is always clear. */
export const ALERT_DISCLAIMER =
  "Alert Radar is an independent, unofficial compilation of JNTUH announcements. " +
  "Always confirm the details on the official JNTUH website before acting.";

/** The official pages notices are verified against (links only, never scraped). */
export const ALERT_SOURCES = [
  {
    id: "notifications",
    name: "JNTUH Notifications",
    url: "https://jntuh.ac.in/notifications",
    description: "University notifications from DAP, DUEX, admissions and more.",
  },
  {
    id: "bulletins",
    name: "JNTUH Bulletin Board",
    url: "https://jntuh.ac.in/bulletins",
    description: "Circulars, regulations and general announcements.",
  },
  {
    id: "calendars",
    name: "JNTUH Academic Calendars",
    url: "https://jntuh.ac.in/academic-calendars",
    description: "Semester academic calendars, grouped by academic year.",
  },
  {
    id: "exams",
    name: "JNTUH Examinations Portal",
    url: "https://exams1.jntuh.ac.in/",
    description: "Examination branch portal for timetables, results and hall tickets.",
  },
];

/**
 * Allowed alert categories. `id` is persisted in Firestore and must never
 * drift from the `d.category in [...]` list in firestore.rules.
 */
export const ALERT_CATEGORIES = [
  { id: "exams", label: "Exams" },
  { id: "timetable", label: "Timetables" },
  { id: "calendar", label: "Academic Calendar" },
  { id: "results", label: "Results" },
  { id: "admissions", label: "Admissions" },
  { id: "scholarship", label: "Scholarships" },
  { id: "deadline", label: "Deadlines" },
  { id: "general", label: "General" },
];

/** Convenience list of just the category ids (for validation). */
export const ALERT_CATEGORY_IDS = ALERT_CATEGORIES.map((c) => c.id);

/** Look up a category descriptor by id, or null when unknown. */
export function getAlertCategory(id) {
  return ALERT_CATEGORIES.find((c) => c.id === id) || null;
}

/** Look up an official source descriptor by id, or null when unknown. */
export function getAlertSource(id) {
  return ALERT_SOURCES.find((s) => s.id === id) || null;
}
