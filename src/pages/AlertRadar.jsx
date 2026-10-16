import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  ExternalLink,
  RefreshCw,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import Footer from "../components/Footer.jsx";
import { fetchPublishedAlerts } from "../lib/alerts.js";
import { ALERT_DISCLAIMER, getAlertCategory } from "../data/alertSources.js";

// The shared .doc-grid only defines the grid + gap, so the column count is set
// per page (responsive auto-fill), matching the rest of the site.
const CARD_GRID = {
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
};

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
        ) : (
          <div className="doc-grid" style={CARD_GRID}>
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
