// ---------------------------------------------------------------------------
// JNTUH Alert Radar - client-side filtering for the public /alerts list.
//
// Pure, dependency-free helpers (no Firebase, no React) so they are trivially
// unit-tested. Filtering only ever runs over alerts that lib/alerts.js has
// already fetched as PUBLISHED, so a draft can never reach the UI through here.
// ---------------------------------------------------------------------------

/**
 * Case-insensitive match across an alert's title, summary and tags.
 * An empty query matches everything.
 */
export function alertMatchesQuery(alert, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    alert?.title,
    alert?.summary,
    Array.isArray(alert?.tags) ? alert.tags.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Apply the search + category + pinned filters to a list of published alerts.
 * `category` of "all" (or empty) means no category restriction.
 */
export function filterAlerts(
  alerts,
  { query = "", category = "all", pinnedOnly = false } = {}
) {
  const list = Array.isArray(alerts) ? alerts : [];
  return list.filter(
    (alert) =>
      (!pinnedOnly || alert?.pinned === true) &&
      (!category || category === "all" || alert?.category === category) &&
      alertMatchesQuery(alert, query)
  );
}

/** True when any filter is narrowing the list (drives the "Clear" affordance). */
export function hasActiveAlertFilters({
  query = "",
  category = "all",
  pinnedOnly = false,
} = {}) {
  return Boolean(String(query).trim()) || category !== "all" || Boolean(pinnedOnly);
}
