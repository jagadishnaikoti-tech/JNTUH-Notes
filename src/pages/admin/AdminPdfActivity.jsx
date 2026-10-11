import { useMemo, useState } from "react";
import { FileDown, RefreshCw, Search as SearchIcon, MousePointerClick } from "lucide-react";
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
import { rangeForDays } from "../../lib/analyticsQuery.js";
import { useAnalyticsData } from "../../lib/useAnalyticsData.js";

export default function AdminPdfActivity() {
  const [days, setDays] = useState(30);
  const [term, setTerm] = useState("");
  const range = useMemo(() => rangeForDays(days), [days]);
  const { loading, error, events, stats, reload } = useAnalyticsData(range);

  const needle = term.trim().toLowerCase();
  const clicks = useMemo(
    () => (events || []).filter((e) => e.type === "pdf_click"),
    [events]
  );
  const recentClicks = useMemo(() => {
    const list = [...clicks].sort(
      (a, b) =>
        (b.ts?.toMillis?.() ?? b.tsClient ?? 0) -
        (a.ts?.toMillis?.() ?? a.tsClient ?? 0)
    );
    if (!needle) return list.slice(0, 100);
    return list
      .filter((e) => `${e.docTitle || ""} ${e.subject || ""}`.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [clicks, needle]);

  const downloads = clicks.filter((e) => e.action === "download").length;
  const opens = clicks.filter((e) => e.action === "open").length;
  const previews = clicks.filter((e) => e.action === "view").length;

  if (loading) return <Spinner label="Loading PDF activity…" />;

  if (error) {
    return (
      <EmptyState title="Could not load PDF activity">
        <p>
          {error?.code === "permission-denied"
            ? "Your account is not authorized to read analytics data."
            : "The analytics query failed. Confirm Firestore is enabled and the security rules are deployed."}
        </p>
      </EmptyState>
    );
  }

  if (!clicks.length) {
    return (
      <>
        <div className="admin-toolbar">
          <RangeSelector value={days} onChange={setDays} />
          <button type="button" className="admin-refresh" onClick={reload}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
        <EmptyState title="No PDF activity in this period" icon={FileDown}>
          <p>
            Document opens, previews and downloads are recorded when visitors
            click a PDF on the public site. Nothing has been recorded in the last{" "}
            {days} days.
          </p>
        </EmptyState>
      </>
    );
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <RangeSelector value={days} onChange={setDays} />
        <label className="admin-search">
          <SearchIcon size={15} aria-hidden="true" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by document title…"
            aria-label="Search PDF activity by title"
          />
        </label>
        <button type="button" className="admin-refresh" onClick={reload}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="admin-stats">
        <StatCard
          label="Total PDF clicks"
          value={formatNumber(stats.totals.pdfClicks)}
          hint={`Last ${days} days`}
          icon={MousePointerClick}
        />
        <StatCard label="Opens" value={formatNumber(opens)} hint="Open in Drive" icon={FileDown} />
        <StatCard label="Previews" value={formatNumber(previews)} hint="In-app viewer" icon={FileDown} />
        <StatCard label="Downloads" value={formatNumber(downloads)} hint="Download intent" icon={FileDown} />
      </div>

      <TrendPanel
        title="PDF clicks over time"
        subtitle={`Recorded activity · last ${days} days`}
        daily={stats.daily}
        series={["pdfClicks", "pageViews"]}
      />

      <div className="admin-grid-2">
        <Panel title="Clicks by subject">
          {stats.bySubject.length ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col" className="admin-col-num">
                    Clicks
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.bySubject.slice(0, 12).map(([subject, count]) => (
                  <tr key={subject}>
                    <td>{subject}</td>
                    <td className="admin-col-num">{formatNumber(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="admin-muted">No subject data recorded.</p>
          )}
        </Panel>

        <Panel title="Clicks by academic year">
          {stats.byYear.length ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="admin-col-num">
                    Clicks
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.byYear.map(([yearName, count]) => (
                  <tr key={yearName}>
                    <td>{yearName}</td>
                    <td className="admin-col-num">{formatNumber(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="admin-muted">No year data recorded.</p>
          )}
        </Panel>
      </div>

      <Panel title="Most clicked PDFs" subtitle="Aggregated by document ID">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Subject</th>
              <th scope="col" className="admin-col-num">
                Open
              </th>
              <th scope="col" className="admin-col-num">
                Preview
              </th>
              <th scope="col" className="admin-col-num">
                Download
              </th>
              <th scope="col" className="admin-col-num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.topPdfs.map((p) => (
              <tr key={p.docId}>
                <td>
                  <span className="admin-strong">{p.title || "(untitled)"}</span>
                  <span className="admin-subtext admin-mono">{p.docId}</span>
                </td>
                <td>{p.subject || "—"}</td>
                <td className="admin-col-num">{formatNumber(p.open)}</td>
                <td className="admin-col-num">{formatNumber(p.view)}</td>
                <td className="admin-col-num">{formatNumber(p.download)}</td>
                <td className="admin-col-num admin-strong">{formatNumber(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Recent PDF clicks"
        subtitle={needle ? `Filtered by “${term}”` : "Newest first"}
      >
        {recentClicks.length ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Action</th>
                <th scope="col">Page</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {recentClicks.map((e) => (
                <tr key={e.id}>
                  <td>{e.docTitle || e.docId}</td>
                  <td>
                    <span className={`admin-pill admin-pill-${e.action}`}>{e.action}</span>
                  </td>
                  <td className="admin-mono">{e.sourcePath || "—"}</td>
                  <td>{formatDateTime(e.ts?.toMillis?.() ?? e.tsClient)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="admin-muted">No PDF clicks match “{term}”.</p>
        )}
      </Panel>

      <p className="admin-methodology">
        A click is recorded when a visitor activates a document control. The
        action distinguishes an <strong>open</strong> (open in Google Drive), a{" "}
        <strong>preview</strong> (in-app viewer) and a <strong>download</strong>{" "}
        intent. A recorded download is a click on the download control — it is
        not confirmation that the file finished downloading.
      </p>
    </div>
  );
}
