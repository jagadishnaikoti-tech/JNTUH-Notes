import { useState } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { weeklyFromDaily } from "../../lib/analyticsQuery.js";

const numberFmt = new Intl.NumberFormat("en-IN");

export function formatNumber(n) {
  return numberFmt.format(Number(n) || 0);
}

export function formatDateTime(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export function formatDay(date) {
  if (!date || date === "unknown") return "Unknown";
  try {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="admin-loading" role="status">
      <Loader2 size={20} className="admin-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox }) {
  return (
    <div className="admin-empty">
      <Icon size={26} aria-hidden="true" />
      <p className="admin-empty-title">{title}</p>
      {children ? <div className="admin-empty-body">{children}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon }) {
  return (
    <div className="admin-stat">
      <div className="admin-stat-head">
        <span className="admin-stat-label">{label}</span>
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      </div>
      <p className="admin-stat-value">{value}</p>
      {hint ? <p className="admin-stat-hint">{hint}</p> : null}
    </div>
  );
}

export function Panel({ title, subtitle, actions, children }) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">{title}</h2>
          {subtitle ? <p className="admin-panel-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="admin-panel-actions">{actions}</div> : null}
      </header>
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}

/**
 * Accessible CSS bar chart for the daily series. The visual bars are
 * aria-hidden; an off-screen table carries the same data for screen readers.
 */
export function TrendChart({ daily, series = ["pageViews", "pdfClicks"], caption = "Daily activity" }) {
  const rows = daily.filter((d) => d.date !== "unknown");
  if (!rows.length) return null;

  const max = Math.max(
    1,
    ...rows.flatMap((d) => series.map((s) => d[s] || 0))
  );

  return (
    <div className="admin-chart">
      <div className="admin-chart-bars" aria-hidden="true">
        {rows.map((d) => (
          <div className="admin-chart-col" key={d.date} title={`${d.date}`}>
            <div className="admin-chart-stack">
              {series.map((s) => (
                <span
                  key={s}
                  className={`admin-chart-bar admin-chart-${s}`}
                  style={{ height: `${Math.round(((d[s] || 0) / max) * 100)}%` }}
                />
              ))}
            </div>
            <span className="admin-chart-label">{formatDay(d.date)}</span>
          </div>
        ))}
      </div>
      <div className="admin-chart-legend">
        <span className="admin-legend admin-chart-pageViews">Page views</span>
        <span className="admin-legend admin-chart-pdfClicks">PDF clicks</span>
      </div>
      <table className="admin-sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Page views</th>
            <th>PDF clicks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.pageViews}</td>
              <td>{d.pdfClicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Trend panel with a Daily / Weekly toggle. Basis for every time-series view so
 * the same aggregation (and the same honest, empty-aware chart) is reused.
 */
export function TrendPanel({ title, subtitle, daily, series }) {
  const [granularity, setGranularity] = useState("daily");
  const rows = granularity === "weekly" ? weeklyFromDaily(daily) : daily;

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      actions={
        <div className="admin-range" role="group" aria-label="Trend granularity">
          {[
            ["daily", "Daily"],
            ["weekly", "Weekly"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`admin-range-btn${granularity === key ? " is-active" : ""}`}
              aria-pressed={granularity === key}
              onClick={() => setGranularity(key)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <TrendChart
        daily={rows}
        series={series}
        caption={`${granularity === "weekly" ? "Weekly" : "Daily"} activity`}
      />
    </Panel>
  );
}

export function RangeSelector({ value, onChange, options = [7, 30, 90] }) {
  return (
    <div className="admin-range" role="group" aria-label="Date range">
      {options.map((days) => (
        <button
          key={days}
          type="button"
          className={`admin-range-btn${value === days ? " is-active" : ""}`}
          aria-pressed={value === days}
          onClick={() => onChange(days)}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}
