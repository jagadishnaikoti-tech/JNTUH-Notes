import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  ExternalLink,
  Pin,
  RefreshCw,
  Search,
  SearchX,
  ShieldAlert,
  X,
} from "lucide-react";
import Footer from "../components/Footer.jsx";
import { fetchPublishedAlerts } from "../lib/alerts.js";
import { filterAlerts, hasActiveAlertFilters } from "../lib/alertFilters.js";
import {
  ALERT_CATEGORIES,
  ALERT_DISCLAIMER,
  getAlertCategory,
} from "../data/alertSources.js";

// The shared .doc-grid only defines the grid + gap, so the column count is set
// per page (responsive auto-fill), matching the rest of the site. `min(100%,
// 300px)` keeps the usual 300px minimum on normal screens but lets a single
// column shrink to the container width on narrow phones, so a card can never
// force a horizontal scrollbar.
const CARD_GRID = {
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
};

const chipClass = (active) => "chip" + (active ? " is-active" : "");

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar-date fields (publishedAt / deadlineAt) are shown in UTC so a notice
 * never shifts by a day depending on the visitor's timezone.
 */
function formatDay(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function metaLine(alert) {
  const bits = [];
  if (alert.sourceName) bits.push(`Source: ${alert.sourceName}`);
  const published = formatDay(alert.publishedAt || alert.createdAt);
  if (published) bits.push(`Published ${published}`);
  const deadline = formatDay(alert.deadlineAt);
  if (deadline) bits.push(`Deadline ${deadline}`);
  return bits.join(" • ");
}

function AlertCard({ alert }) {
  const category = getAlertCategory(alert.category);
  const meta = metaLine(alert);

  return (
    <article className="doc-card">
      <div className="doc-card-head">
        <span className="doc-icon" aria-hidden="true">
          <BellRing size={18} />
        </span>
        <span className="doc-badge">{category ? category.label : "General"}</span>
        {alert.pinned ? <span className="doc-badge">Pinned</span> : null}
        {alert.verifiedAt ? <span className="doc-badge">Verified</span> : null}
      </div>

      <h2 className="doc-title">{alert.title}</h2>
      {alert.summary ? <p className="doc-path">{alert.summary}</p> : null}
      {meta ? <p className="meta-line">{meta}</p> : null}

      <div className="doc-actions">
        <Link className="btn btn-primary btn-sm" to={`/alerts/${alert.id}`}>
          <BellRing size={15} aria-hidden="true" />
          View alert
        </Link>
        {alert.sourceUrl ? (
          <a
            className="btn btn-ghost btn-sm"
            href={alert.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={15} aria-hidden="true" />
            Official source
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default function AlertRadar() {
  const [status, setStatus] = useState("loading");
  const [alerts, setAlerts] = useState([]);

  // Filters. Purely client-side and applied only to the already-published list.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const list = await fetchPublishedAlerts();
      setAlerts(Array.isArray(list) ? list : []);
      setStatus("ready");
    } catch {
      setAlerts([]);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await fetchPublishedAlerts();
        if (!active) return;
        setAlerts(Array.isArray(list) ? list : []);
        setStatus("ready");
      } catch {
        if (!active) return;
        setAlerts([]);
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filters = { query, category, pinnedOnly };
  const filtered = useMemo(() => filterAlerts(alerts, filters), [alerts, query, category, pinnedOnly]);
  const filtersActive = hasActiveAlertFilters(filters);

  const clearFilters = useCallback(() => {
    setQuery("");
    setCategory("all");
    setPinnedOnly(false);
  }, []);

  const showFilters = status === "ready" && alerts.length > 0;

  return (
    <main className="page-main">
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <p className="eyebrow">Alert Radar</p>
        <h1 className="section-title">JNTUH notices, checked by hand</h1>
        <p className="section-sub" style={{ marginTop: "var(--space-sm)" }}>
          A curated, unofficial feed of JNTUH announcements. Every notice is
          verified against the official source by a person before it appears here.
        </p>
      </header>

      <p
        className="notice"
        role="note"
        style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
      >
        <ShieldAlert
          size={16}
          aria-hidden="true"
          style={{ flex: "0 0 auto", marginTop: 2 }}
        />
        <span>{ALERT_DISCLAIMER}</span>
      </p>

      <section className="section">
        {showFilters ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
              marginBottom: "var(--space-lg)",
            }}
          >
            <div>
              <label
                htmlFor="alert-search"
                style={{ fontWeight: 700, fontSize: "var(--text-sm)" }}
              >
                Search alerts
              </label>
              <div className="searchbar alert-search" style={{ marginTop: 6 }}>
                <Search size={18} aria-hidden="true" />
                <input
                  id="alert-search"
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  className="searchbar-input"
                  placeholder="Search by title, summary or tag…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    className="searchbar-clear"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend className="sr-only">Filter by category</legend>
              <div className="chip-row">
                <button
                  type="button"
                  className={chipClass(category === "all")}
                  aria-pressed={category === "all"}
                  onClick={() => setCategory("all")}
                >
                  All
                </button>
                {ALERT_CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={chipClass(category === item.id)}
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "var(--space-sm)",
              }}
            >
              <button
                type="button"
                className={chipClass(pinnedOnly)}
                aria-pressed={pinnedOnly}
                onClick={() => setPinnedOnly((value) => !value)}
              >
                <Pin size={16} aria-hidden="true" />
                Pinned only
              </button>

              {filtersActive ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={clearFilters}
                >
                  <X size={15} aria-hidden="true" />
                  Clear filters
                </button>
              ) : null}

              <span
                className="muted"
                role="status"
                style={{ marginLeft: "auto", fontSize: "var(--text-sm)" }}
              >
                Showing {filtered.length} of {alerts.length}
              </span>
            </div>
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="empty-state" role="status" aria-live="polite">
            <span className="empty-state-icon" aria-hidden="true">
              <RefreshCw size={26} />
            </span>
            <p className="muted" style={{ margin: 0 }}>
              Loading alerts…
            </p>
          </div>
        ) : status === "error" ? (
          <div className="error-state" role="alert">
            <p style={{ marginTop: 0 }}>
              We couldn’t load alerts right now. Please try again.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={load}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              <SearchX size={26} />
            </span>
            <h2 style={{ margin: 0 }}>No alerts right now</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              There are no published alerts at the moment. Please check back soon.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" role="status">
            <span className="empty-state-icon" aria-hidden="true">
              <SearchX size={26} />
            </span>
            <h2 style={{ margin: 0 }}>No alerts match</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {query.trim() ? (
                <>
                  Nothing matches “{query.trim()}” with the current filters. Try a
                  different keyword, or clear the filters.
                </>
              ) : (
                <>No alerts match the current filters. Try clearing them.</>
              )}
            </p>
            <div className="row-center mt-md">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={clearFilters}
              >
                <X size={15} aria-hidden="true" />
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <div className="doc-grid" style={CARD_GRID}>
            {filtered.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
