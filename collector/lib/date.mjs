// ---------------------------------------------------------------------------
// Collector - notice date parsing.
//
// The two sources use two different, unambiguous, day-first formats:
//   * jntuh.ac.in listings ......... "15 Oct 2026"
//   * exams1.jntuh.ac.in items ..... "16-10-2026"  (DD-MM-YYYY)
//
// Nothing here invents a date: an unrecognised or incomplete value returns
// `null` and the caller records the notice as "date unavailable".
// Dates are built in UTC so a notice never shifts by a day for a reader in a
// different timezone (the public UI also formats in UTC).
// ---------------------------------------------------------------------------

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function utcDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  // Reject impossible days such as 31 Feb.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * Parse a notice date into a UTC `Date`, or `null` when it cannot be read.
 * Supported: `15 Oct 2026`, `15 October 2026`, `16-10-2026`, `16.10.2026`,
 * `16/10/2026`, `2026-10-16`.
 */
export function parseNoticeDate(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;

  let match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    return utcDate(Number(match[3]), month, Number(match[1]));
  }

  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    return utcDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    return utcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  return null;
}

/** Format a parsed notice date as `YYYY-MM-DD` for the dry-run report. */
export function formatDateUtc(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
