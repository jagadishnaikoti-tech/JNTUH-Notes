import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BellRing, RefreshCw } from "lucide-react";
import { fetchLatestPublishedAlerts } from "../lib/alerts.js";
import { alertMetaLine } from "../lib/alertFormat.js";
import { getAlertCategory } from "../data/alertSources.js";

// The shared .doc-grid only defines the grid + gap, so the column count is set
// per page. `min(100%, 280px)` keeps the usual 280px minimum on normal screens
// but lets a single column shrink to the container width on narrow phones, so a
// card can never force a horizontal scrollbar (same reasoning as the Alert
// Radar page).
const CARD_GRID = {
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
};

/** The Alert Radar card, trimmed to what a homepage teaser needs. */
function AlertCard({ alert }) {
  const category = getAlertCategory(alert.category);
  const meta = alertMetaLine(alert);
  const detailPath = `/alerts/${alert.id}`;

  return (
    <article className="doc-card">
      <div className="doc-card-head">
        <span className="doc-icon" aria-hidden="true">
          <BellRing size={18} />
        </span>
        <span className="doc-badge">{category ? category.label : "General"}</span>
        {alert.pinned ? <span className="doc-badge">Pinned</span> : null}
      </div>

      <h3 className="doc-title">{alert.title}</h3>
      {alert.summary ? <p className="doc-path">{alert.summary}</p> : null}
      {meta ? <p className="meta-line">{meta}</p> : null}

      <div className="doc-actions">
        <Link className="btn btn-ghost btn-sm" to={detailPath}>
          View alert
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

/**
 * Homepage "Latest alerts" section.
 *
 * Shows the newest few PUBLISHED notices from the existing Alert Radar data
 * layer (lib/alerts.js) and links each one to its `/alerts/:id` detail route;
 * /alerts stays the full list ("View all alerts"). Drafts and unverified
 * notices can never appear here: the public query filters
 * `status == "published"` and firestore.rules enforce the same for anonymous
 * reads, so this is not a client-side-only filter.
 */
export default function LatestAlerts() {
  const [status, setStatus] = useState("loading");
  const [alerts, setAlerts] = useState([]);

  // The read never rejects - it resolves `{ alerts, error }` - so the error
  // state is driven by the read's own success flag, not by a thrown exception.
  const load = useCallback(async () => {
    setStatus("loading");
    const { alerts: latest, error } = await fetchLatestPublishedAlerts();
    setAlerts(error ? [] : latest);
    setStatus(error ? "error" : "ready");
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { alerts: latest, error } = await fetchLatestPublishedAlerts();
      if (!active) return;
      setAlerts(error ? [] : latest);
      setStatus(error ? "error" : "ready");
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="section" aria-labelledby="latest-alerts-title">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="latest-alerts-title">
            Latest alerts
          </h2>
          <p className="section-sub">
            Recent JNTUH notices, checked by hand against the official source
            before they appear.
          </p>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/alerts">
          View all alerts
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      {status === "loading" ? (
        <p className="notice" role="status" aria-live="polite">
          Loading latest alerts…
        </p>
      ) : status === "error" ? (
        <div className="error-state" role="alert">
          <p style={{ marginTop: 0 }}>
            We couldn’t load the latest alerts right now.
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
        <p className="notice" role="status">
          No JNTUH alerts right now. New notices appear here once they are
          verified against the official source.
        </p>
      ) : (
        <div className="doc-grid" style={CARD_GRID}>
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </section>
  );
}
