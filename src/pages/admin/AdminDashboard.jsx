import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Eye,
  FileDown,
  MousePointerClick,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  EmptyState,
  Panel,
  RangeSelector,
  Spinner,
  StatCard,
  TrendPanel,
  formatDateTime,
  formatNumber,
} from "../../components/admin/adminUi.jsx";
import { hasData, rangeForDays } from "../../lib/analyticsQuery.js";
import { useAnalyticsData } from "../../lib/useAnalyticsData.js";

function recentLabel(event) {
  if (event.type === "pdf_click") {
    const title = event.docTitle || event.docId || "document";
    return `${event.action === "download" ? "Download" : event.action === "view" ? "Preview" : "Open"} · ${title}`;
  }
  return event.path || "page";
}

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const range = useMemo(() => rangeForDays(days), [days]);
  const { loading, error, stats, reload } = useAnalyticsData(range);

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <RangeSelector value={days} onChange={setDays} />
        <button type="button" className="admin-refresh" onClick={reload} disabled={loading}>
          <RefreshCw size={15} className={loading ? "admin-spin" : ""} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading recorded activity…" />
      ) : error ? (
        <EmptyState title="Could not load analytics">
          <p>
            {error?.code === "permission-denied"
              ? "Your account is not authorized to read analytics data. Check the Firestore rules and the admin claim."
              : "The analytics query failed. Confirm Firestore is enabled and the security rules are deployed."}
          </p>
        </EmptyState>
      ) : !hasData(stats) ? (
        <EmptyState title="No analytics data recorded yet" icon={BarChart3}>
          <p>
            Nothing has been recorded in the last {days} days. Data appears here
            once visitors browse the public site
            {import.meta.env.VITE_REQUIRE_CONSENT === "true"
              ? " and accept the analytics consent prompt"
              : ""}
            .
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="admin-stats">
            <StatCard
              label="Total page views"
              value={formatNumber(stats.totals.pageViews)}
              hint={`Last ${days} days`}
              icon={Eye}
            />
            <StatCard
              label="Estimated unique visitors"
              value={formatNumber(stats.totals.visitors)}
              hint="Anonymous browser IDs"
              icon={Users}
            />
            <StatCard
              label="PDF clicks"
              value={formatNumber(stats.totals.pdfClicks)}
              hint="Open, preview & download"
              icon={MousePointerClick}
            />
            <StatCard
              label="Sessions"
              value={formatNumber(stats.totals.sessions)}
              hint="30-min inactivity window"
              icon={BarChart3}
            />
          </div>

          <TrendPanel
            title="Visitor trends over time"
            subtitle={`Page views and PDF clicks · last ${days} days`}
            daily={stats.daily}
          />

          <div className="admin-grid-2">
            <Panel
              title="Most viewed pages"
              actions={
                <Link className="admin-link" to="/admin/analytics">
                  Full analytics →
                </Link>
              }
            >
              {stats.topPages.length ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col" className="admin-col-num">
                        Views
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPages.slice(0, 8).map((p) => (
                      <tr key={p.path}>
                        <td className="admin-mono">{p.path}</td>
                        <td className="admin-col-num">{formatNumber(p.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="admin-muted">No page views recorded yet.</p>
              )}
            </Panel>

            <Panel
              title="Most clicked PDFs"
              actions={
                <Link className="admin-link" to="/admin/pdf-activity">
                  PDF activity →
                </Link>
              }
            >
              {stats.topPdfs.length ? (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col" className="admin-col-num">
                        Clicks
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPdfs.slice(0, 8).map((p) => (
                      <tr key={p.docId}>
                        <td>
                          <span className="admin-strong">{p.title || "(untitled)"}</span>
                          {p.subject ? (
                            <span className="admin-subtext">{p.subject}</span>
                          ) : null}
                        </td>
                        <td className="admin-col-num">{formatNumber(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="admin-muted">No PDF clicks recorded yet.</p>
              )}
            </Panel>
          </div>

          <Panel title="Recent activity" subtitle="Newest recorded events first">
            {stats.recent.length ? (
              <ul className="admin-activity">
                {stats.recent.map((e) => (
                  <li key={e.id}>
                    <span className={`admin-dot admin-dot-${e.type}`} aria-hidden="true" />
                    <span className="admin-activity-label">{recentLabel(e)}</span>
                    <span className="admin-activity-meta">
                      <FileDown size={13} aria-hidden="true" />
                      {e.type === "pdf_click" ? "PDF click" : "Page view"} ·{" "}
                      {formatDateTime(e.ts?.toMillis?.() ?? e.tsClient)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">No activity recorded yet.</p>
            )}
          </Panel>

          <p className="admin-methodology">
            Page views count each recorded <code>page_view</code>. PDF clicks
            count each recorded <code>pdf_click</code> (an open, preview or
            download <em>intent</em>, not proof of a completed download).
            &ldquo;Estimated unique visitors&rdquo; counts distinct anonymous
            browser IDs and sessions use a 30-minute inactivity window. These are
            anonymous estimates, not counts of individual people.
          </p>
        </>
      )}
    </div>
  );
}
