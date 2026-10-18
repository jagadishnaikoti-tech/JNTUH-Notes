// ---------------------------------------------------------------------------
// JNTUH Alert Radar - shared, pure formatting helpers for alert UI.
//
// Calendar-date fields (publishedAt / deadlineAt) are rendered in UTC so a
// notice never shifts by a day depending on the visitor's timezone. Kept
// dependency-free (no React, no Firebase) so the Alert Radar pages and the
// homepage "Latest alerts" section show a notice identically, and so the
// formatting is unit-testable without a DOM.
// ---------------------------------------------------------------------------

/** Coerce a Firestore Timestamp, Date, ISO string or epoch into a Date or null. */
export function toAlertDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "1 Oct 2026" (UTC), or "" when the value is missing or invalid. */
export function formatAlertDay(value) {
  const d = toAlertDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Source: JNTUH Notifications • Published 1 Oct 2026 • Deadline 9 Oct 2026",
 * omitting any part the alert does not carry. Published falls back to the
 * document creation time, matching the rest of the Alert Radar.
 */
export function alertMetaLine(alert) {
  const bits = [];
  if (alert?.sourceName) bits.push(`Source: ${alert.sourceName}`);
  const published = formatAlertDay(alert?.publishedAt || alert?.createdAt);
  if (published) bits.push(`Published ${published}`);
  const deadline = formatAlertDay(alert?.deadlineAt);
  if (deadline) bits.push(`Deadline ${deadline}`);
  return bits.join(" • ");
}
