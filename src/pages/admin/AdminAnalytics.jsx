import { useMemo, useState } from "react";
import { BarChart3, Eye, RefreshCw, Users } from "lucide-react";
import {
  EmptyState,
  Panel,
  RangeSelector,
  Spinner,
  StatCard,
  TrendPanel,
  formatNumber,
} from "../../components/admin/adminUi.jsx";
import { hasData, rangeForDays } from "../../lib/analyticsQuery.js";
import { useAnalyticsData } from "../../lib/useAnalyticsData.js";

export default function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const range = useMemo(() => rangeForDays(days), [days]);
  const { loading, error, stats, reload } = useAnalyticsData(range);

  const maxViews = stats?.topPages?.[0]?.count || 1;

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <RangeSelector value={days} onChange={setDays} options={[7, 30, 90, 365]} />
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
              ? "Your account is not authorized to read analytics data."
              : "The analytics query failed. Confirm Firestore is enabled and the security rules are deployed."}
          </p>
        </EmptyState>
      ) : !hasData(stats) ? (
        <EmptyState title="No analytics data recorded yet" icon={BarChart3}>
          <p>Nothing has been recorded in the selected period.</p>
        </EmptyState>
      ) : (
        <>
          <div className="admin-stats">
            <StatCard
              label="Page views"
              value={formatNumber(stats.totals.pageViews)}
              hint={`Last ${days} days`}
              icon={Eye}
            />
            <StatCard
              label="Estimated unique visitors"
              value={formatNumber(stats.totals.visitors)}
              hint="Distinct anonymous IDs"
              icon={Users}
            />
            <StatCard
              label="Sessions"
              value={formatNumber(stats.totals.sessions)}
              hint="30-min inactivity window"
              icon={BarChart3}
            />
          </div>

          <TrendPanel
            title="Trends over time"
            subtitle={`Recorded activity · last ${days} days`}
            daily={stats.daily}
          />

          <Panel title="Most viewed pages" subtitle="Recorded page_view events">
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
                {stats.topPages.map((p) => (
                  <tr key={p.path}>
                    <td>
                      <span className="admin-mono">{p.path}</span>
                      <span className="admin-bar">
                        <span
                          className="admin-bar-fill"
                          style={{ width: `${Math.round((p.count / maxViews) * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="admin-col-num">{formatNumber(p.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <p className="admin-methodology">
            Counts come from recorded <code>page_view</code> events. A page view
            is recorded once per client-side route change. Repeated views caused
            by React StrictMode or component remounts are de-duplicated. Unique
            visitors are an anonymous estimate based on a random browser ID and
            must not be read as a count of real people.
          </p>
        </>
      )}
    </div>
  );
}
