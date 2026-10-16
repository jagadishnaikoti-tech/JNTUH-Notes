import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck,
  BellRing,
  Compass,
  ExternalLink,
  Pin,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import Footer from "../components/Footer.jsx";
import { fetchPublishedAlert } from "../lib/alerts.js";
import { ALERT_DISCLAIMER, getAlertCategory } from "../data/alertSources.js";

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar-date fields are shown in UTC so a notice never shifts by a day. */
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

export default function AlertDetail() {
  const { id } = useParams();
  const [status, setStatus] = useState("loading");
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setAlert(null);
    (async () => {
      try {
        const found = await fetchPublishedAlert(id);
        if (!active) return;
        if (found) {
          setAlert(found);
          setStatus("ready");
        } else {
          setStatus("missing");
        }
      } catch {
        if (!active) return;
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (status === "loading") {
    return (
      <main className="page-main">
        <div className="empty-state" role="status" aria-live="polite">
          <span className="empty-state-icon" aria-hidden="true">
            <RefreshCw size={26} />
          </span>
          <p className="muted" style={{ margin: 0 }}>
            Loading alert…
          </p>
        </div>
        <Footer />
      </main>
    );
  }

  if (status === "error" || status === "missing") {
    const isError = status === "error";
    return (
      <main className="page-main">
        <div className="empty-state" role={isError ? "alert" : "status"}>
          <span className="empty-state-icon" aria-hidden="true">
            <Compass size={26} />
          </span>
          <h1 style={{ margin: 0 }}>
            {isError ? "We couldn’t load this alert" : "Alert not available"}
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {isError
              ? "Something went wrong while loading this notice. Please try again."
              : "This alert doesn’t exist or is no longer published."}
          </p>
          <div className="row-center mt-md">
            <Link className="btn btn-primary" to="/alerts">
              <BellRing size={16} aria-hidden="true" />
              All alerts
            </Link>
            <Link className="btn btn-ghost" to="/">
              Go home
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  const category = getAlertCategory(alert.category);
  const published = formatDay(alert.publishedAt || alert.createdAt);
  const deadline = formatDay(alert.deadlineAt);

  const metaBits = [];
  if (alert.sourceName) metaBits.push(`Source: ${alert.sourceName}`);
  if (published) metaBits.push(`Published ${published}`);
  if (deadline) metaBits.push(`Deadline ${deadline}`);
  const meta = metaBits.join(" • ");

  return (
    <main className="page-main">
      <p style={{ margin: 0 }}>
        <Link className="btn btn-ghost btn-sm" to="/alerts">
          <BellRing size={15} aria-hidden="true" />
          All alerts
        </Link>
      </p>

      <article style={{ marginTop: "var(--space-lg)" }}>
        <div className="chip-row">
          <span className="doc-badge">{category ? category.label : "General"}</span>
          {alert.pinned ? (
            <span
              className="doc-badge"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Pin size={12} aria-hidden="true" />
              Pinned
            </span>
          ) : null}
          {alert.verifiedAt ? (
            <span
              className="doc-badge"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <BadgeCheck size={12} aria-hidden="true" />
              Verified
            </span>
          ) : null}
        </div>

        <h1 className="section-title" style={{ marginTop: "var(--space-sm)" }}>
          {alert.title}
        </h1>

        {alert.summary ? (
          <p className="section-sub" style={{ marginTop: "var(--space-sm)" }}>
            {alert.summary}
          </p>
        ) : null}

        {meta ? (
          <p className="meta-line" style={{ marginTop: "var(--space-md)" }}>
            {meta}
          </p>
        ) : null}

        {alert.sourceUrl ? (
          <div className="doc-actions" style={{ marginTop: "var(--space-lg)" }}>
            <a
              className="btn btn-primary btn-sm"
              href={alert.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open official source
            </a>
          </div>
        ) : null}

        {Array.isArray(alert.tags) && alert.tags.length ? (
          <div className="chip-row" style={{ marginTop: "var(--space-lg)" }}>
            {alert.tags.map((tag) => (
              <span className="doc-badge" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </article>

      <p
        className="notice mt-md"
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

      <Footer />
    </main>
  );
}
