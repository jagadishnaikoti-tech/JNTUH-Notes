import { useEffect, useMemo, useState } from "react";
import { useAdmin } from "../../components/admin/AdminAuthContext.jsx";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  EmptyState,
  Panel,
  Spinner,
  StatCard,
  formatNumber,
} from "../../components/admin/adminUi.jsx";
import {
  DEFAULT_PAGE_SIZE,
  REVIEW_FILTER_ALL,
  REVIEW_STATE,
  countIngestStates,
  fetchIngestItems,
  fetchIngestRuns,
  fetchSourceHealth,
  filterIngestItems,
  hasContentChange,
  ignoreIngestItem,
  ingestSourceOptions,
  promoteIngestItem,
  returnIngestItemToReview,
} from "../../lib/ingest.js";
import { cleanAlert } from "../../lib/alerts.js";
import {
  friendlyAuthError,
  observeStagingAuth,
  signInToStaging,
  signOutStaging,
} from "../../lib/adminAuth.js";
import {
  ALERT_CATEGORIES,
  ALERT_CATEGORY_IDS,
  ALERT_DISCLAIMER,
  getAlertCategory,
  getAlertSource,
} from "../../data/alertSources.js";

// --- small date helpers (Firestore Timestamp | Date | string | number) --------

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** `noticeDate` is a calendar date stored at UTC midnight - render it in UTC so
 *  the day never shifts for viewers west of UTC. */
function formatNoticeDate(value) {
  const ms = millisOf(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Real instants (first/last seen, run times) render in the viewer's locale. */
function formatInstant(value) {
  const ms = millisOf(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDateInput(value) {
  const ms = millisOf(value);
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

function fileName(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "Attachment";
  } catch {
    return "Attachment";
  }
}

function splitTags(text) {
  return String(text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const STATE_LABELS = {
  [REVIEW_STATE.NEW]: "New",
  [REVIEW_STATE.PROMOTED]: "Promoted",
  [REVIEW_STATE.IGNORED]: "Ignored",
};

const STATE_FILTERS = [
  { id: REVIEW_FILTER_ALL, label: "All" },
  { id: REVIEW_STATE.NEW, label: "New" },
  { id: REVIEW_STATE.PROMOTED, label: "Promoted" },
  { id: REVIEW_STATE.IGNORED, label: "Ignored" },
];

const AUDIENCE_OPTIONS = [
  { id: "all", label: "All years" },
  { id: "1", label: "1st year" },
  { id: "2", label: "2nd year" },
  { id: "3", label: "3rd year" },
  { id: "4", label: "4th year" },
];

/** A staged notice is "source-related" if it shares the collector's source id. */
function sourceLabelFor(item, health) {
  const known = getAlertSource(item.sourceId);
  if (known) return known.name;
  return item.sourceName || health?.name || item.sourceId || "—";
}

export default function AdminIngest() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [itemsError, setItemsError] = useState(null);

  const [runs, setRuns] = useState([]);
  const [runsError, setRunsError] = useState(null);
  const [health, setHealth] = useState([]);
  const [healthError, setHealthError] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState(REVIEW_FILTER_ALL);
  const [sourceFilter, setSourceFilter] = useState(REVIEW_FILTER_ALL);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);

  const { user: productionUser } = useAdmin();
  const [stagingAuth, setStagingAuth] = useState({ status: "loading", user: null });
  const [stagingEmail, setStagingEmail] = useState("");
  const [stagingPassword, setStagingPassword] = useState("");
  const [stagingSubmitting, setStagingSubmitting] = useState(false);
  const [stagingFormError, setStagingFormError] = useState("");

  async function loadItems({ reset = true } = {}) {
    if (reset) {
      setItemsLoading(true);
      setItemsError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const page = await fetchIngestItems({
        pageSize: DEFAULT_PAGE_SIZE,
        cursor: reset ? null : cursor,
      });
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      if (reset) setItemsError(err);
      else setFlash({ tone: "error", message: err?.message || "Could not load more notices." });
    } finally {
      setItemsLoading(false);
      setLoadingMore(false);
    }
  }

  async function loadMeta() {
    setMetaLoading(true);
    const [runsResult, healthResult] = await Promise.allSettled([
      fetchIngestRuns(),
      fetchSourceHealth(),
    ]);
    if (runsResult.status === "fulfilled") {
      setRuns(runsResult.value.runs);
      setRunsError(null);
    } else {
      setRunsError(runsResult.reason);
    }
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealthError(healthResult.reason);
    }
    setMetaLoading(false);
  }

  function refreshAll() {
    // Deliberately does NOT clear the flash: callers report their own outcome
    // immediately before/after refreshing, so wiping it here would hide the
    // success message of the action that triggered the refresh.
    loadItems({ reset: true });
    loadMeta();
  }

  async function connectStaging(event) {
    event.preventDefault();
    setStagingFormError("");
    if (!stagingEmail.trim() || !stagingPassword) {
      setStagingFormError("Enter the staging administrator email and password.");
      return;
    }
    setStagingSubmitting(true);
    try {
      await signInToStaging(stagingEmail, stagingPassword);
      // observeStagingAuth() updates the status; clear the secret immediately.
      setStagingPassword("");
    } catch (err) {
      setStagingFormError(
        err?.code ? friendlyAuthError(err) : err?.message || friendlyAuthError(err)
      );
    } finally {
      setStagingSubmitting(false);
    }
  }

  useEffect(() => {
    // Review data lives in the staging project, so it can only load once the
    // administrator has an admin session THERE. A production session is not
    // enough: Firebase Auth tokens are scoped to one project.
    if (stagingAuth.status !== "admin") return;
    loadItems({ reset: true });
    loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagingAuth.status]);

  useEffect(() => {
    const unsubscribe = observeStagingAuth((next) => {
      setStagingAuth(next);
      if (next.user?.email) setStagingEmail((prev) => prev || next.user.email);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (productionUser?.email) {
      setStagingEmail((prev) => prev || productionUser.email);
    }
  }, [productionUser]);

  const sourceOptions = useMemo(
    () => ingestSourceOptions(items),
    [items]
  );

  const filtered = useMemo(
    () =>
      filterIngestItems(items, {
        query,
        reviewState: stateFilter,
        sourceId: sourceFilter,
      }),
    [items, query, stateFilter, sourceFilter]
  );

  const counts = useMemo(() => countIngestStates(items), [items]);
  const metaIcon = metaLoading ? RefreshCw : Inbox;

  function startReview(item) {
    // Prefill ONLY from real, recorded notice metadata. The summary is always
    // left blank: an administrator must write it from the official source.
    const category = ALERT_CATEGORY_IDS.includes(item.category)
      ? item.category
      : "general";
    const sourceUrl = item.canonicalUrl || item.documentUrl || item.sourceUrl || "";
    setForm({
      id: item.id,
      item,
      title: item.title || "",
      summary: "",
      category,
      sourceName: sourceLabelFor(item, null) === "—" ? "" : sourceLabelFor(item, null),
      sourceUrl,
      publishedAt: toDateInput(item.noticeDate),
      deadlineAt: "",
      audience: [],
      tagsText: "",
      pinned: false,
      confirmed: false,
    });
    setFormError("");
    setFlash(null);
  }

  function toggleAudience(id) {
    setForm((prev) => {
      const has = prev.audience.includes(id);
      let next = has
        ? prev.audience.filter((item) => item !== id)
        : [...prev.audience, id];
      if (id === "all" && !has) next = ["all"];
      if (id !== "all" && !has) next = next.filter((item) => item !== "all");
      return { ...prev, audience: next };
    });
  }

  async function submitPromotion(event) {
    event.preventDefault();
    setFormError("");

    if (!form.confirmed) {
      setFormError(
        "Please open the official source above and confirm you have reviewed the notice."
      );
      return;
    }
    if (!form.publishedAt) {
      setFormError("Please confirm the official publication date from the source.");
      return;
    }

    const payload = {
      title: form.title,
      summary: form.summary,
      category: form.category,
      sourceName: form.sourceName,
      sourceUrl: form.sourceUrl,
      publishedAt: form.publishedAt,
      deadlineAt: form.deadlineAt,
      audience: form.audience,
      tags: splitTags(form.tagsText),
      pinned: form.pinned,
    };

    try {
      cleanAlert(payload); // validate before we open a transaction
    } catch (err) {
      setFormError(err.message);
      return;
    }

    setSaving(true);
    try {
      const result = await promoteIngestItem({ itemId: form.id, input: payload });
      setForm(null);
      setFlash({
        tone: "success",
        message: result.created
          ? "Draft created from the staged notice. Open it in Alert Radar, verify it against the source, then publish."
          : `This notice was already promoted to draft ${result.alertId} - no duplicate was created.`,
      });
      refreshAll();
    } catch (err) {
      setFormError(err?.message || "Could not promote this notice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(id, run, successMessage) {
    setBusyId(id);
    setFlash(null);
    try {
      await run();
      setFlash({ tone: "success", message: successMessage });
      refreshAll();
    } catch (err) {
      setFlash({
        tone: "error",
        message: err?.message || "The action could not be completed.",
      });
    } finally {
      setBusyId(null);
    }
  }

  function ignore(item) {
    if (
      !window.confirm(
        `Ignore “${item.title}”? It leaves the review queue. You can still promote it later.`
      )
    ) {
      return;
    }
    runAction(item.id, () => ignoreIngestItem({ itemId: item.id }), "Staged notice ignored.");
  }

  function returnToReview(item) {
    if (
      !window.confirm(
        `Return “${item.title}” to the review queue? It will appear as a new staged notice again.`
      )
    ) {
      return;
    }
    runAction(
      item.id,
      () => returnIngestItemToReview({ itemId: item.id }),
      "Staged notice returned to review."
    );
  }

  const brokenSources = useMemo(
    () => health.filter((h) => h.status === "broken" || h.status === "degraded"),
    [health]
  );

  if (stagingAuth.status !== "admin") {
    return (
      <StagingConnect
        status={stagingAuth.status}
        email={stagingEmail}
        onEmail={setStagingEmail}
        password={stagingPassword}
        onPassword={setStagingPassword}
        submitting={stagingSubmitting}
        error={stagingFormError}
        onSubmit={connectStaging}
        onDisconnect={signOutStaging}
      />
    );
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <p className="admin-toolbar-note">
          Staged notices are collected automatically but are never public. Review
          each one against the official source, then promote it into a private
          draft. Verification and publishing still happen only on the Alert Radar
          page.
        </p>
        <button
          type="button"
          className="admin-refresh"
          onClick={() => {
            setFlash(null);
            refreshAll();
          }}
          disabled={itemsLoading || metaLoading}
        >
          <RefreshCw
            size={15}
            className={itemsLoading || metaLoading ? "admin-spin" : ""}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      <div className="admin-stats">
        <StatCard label="In review" value={formatNumber(counts.new)} icon={Inbox} />
        <StatCard
          label="Promoted"
          value={formatNumber(counts.promoted)}
          icon={CheckCircle2}
        />
        <StatCard
          label="Content changed"
          value={formatNumber(counts.changed)}
          icon={AlertTriangle}
        />
        <StatCard label="Ignored" value={formatNumber(counts.ignored)} icon={Trash2} />
      </div>

      {flash ? (
        <p
          className={flash.tone === "success" ? "admin-flash" : "admin-form-error"}
          role={flash.tone === "success" ? "status" : "alert"}
        >
          {flash.message}
        </p>
      ) : null}

      {form ? (
        <Panel
          title="Review and promote"
          subtitle="The draft is private until you verify and publish it on Alert Radar. Nothing here is published automatically."
        >
          <form className="admin-alerts-form" onSubmit={submitPromotion} noValidate>
            {formError ? (
              <p className="admin-form-error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="admin-field admin-field-wide">
              <span className="admin-field-label">Staged notice (from the collector)</span>
              <span className="admin-strong">{form.item?.title || "—"}</span>
              <span className="admin-alert-meta">
                <span className="admin-pill">
                  {getAlertCategory(form.item?.category)?.label ||
                    form.item?.category ||
                    "—"}
                </span>
                <span className="admin-subtext">
                  Source: {sourceLabelFor(form.item || {}, null)}
                </span>
                <span className="admin-subtext">
                  Notice date: {formatNoticeDate(form.item?.noticeDate)}
                </span>
                <span className="admin-subtext">
                  First seen: {formatInstant(form.item?.firstSeenAt)}
                </span>
              </span>
              {form.sourceUrl ? (
                <a
                  className="admin-subtext"
                  href={form.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open the official source to verify{" "}
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              ) : null}
            </div>

            <label className="admin-field admin-field-wide">
              <span className="admin-field-label">Title</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="B.Tech IV Year II Semester exams scheduled"
                maxLength={200}
                disabled={saving}
                required
              />
            </label>

            <label className="admin-field admin-field-wide">
              <span className="admin-field-label">
                Summary (write it yourself from the official source)
              </span>
              <textarea
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                placeholder="One or two sentences in your own words. Do not copy the whole notice."
                maxLength={600}
                disabled={saving}
                required
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Category</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                disabled={saving}
              >
                {ALERT_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Source name</span>
              <input
                value={form.sourceName}
                onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
                placeholder="JNTUH Notifications"
                maxLength={80}
                disabled={saving}
              />
            </label>

            <div className="admin-field admin-field-wide">
              <label className="admin-field-label" htmlFor="admin-ingest-source-url">
                Official source URL
              </label>
              <input
                id="admin-ingest-source-url"
                type="url"
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                placeholder="https://jntuh.ac.in/notifications"
                disabled={saving}
                required
              />
            </div>

            <label className="admin-field">
              <span className="admin-field-label">Official publication date</span>
              <input
                type="date"
                value={form.publishedAt}
                onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
                disabled={saving}
                required
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Deadline (optional)</span>
              <input
                type="date"
                value={form.deadlineAt}
                onChange={(e) => setForm({ ...form, deadlineAt: e.target.value })}
                disabled={saving}
              />
            </label>

            <div
              className="admin-field admin-field-wide"
              role="group"
              aria-labelledby="admin-ingest-audience-label"
            >
              <span className="admin-field-label" id="admin-ingest-audience-label">
                Applicable audience
              </span>
              <div className="admin-check-row">
                {AUDIENCE_OPTIONS.map((option) => (
                  <label key={option.id} className="admin-check">
                    <input
                      type="checkbox"
                      checked={form.audience.includes(option.id)}
                      onChange={() => toggleAudience(option.id)}
                      disabled={saving}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="admin-field admin-field-wide">
              <span className="admin-field-label">
                Tags (optional, comma-separated)
              </span>
              <input
                value={form.tagsText}
                onChange={(e) => setForm({ ...form, tagsText: e.target.value })}
                placeholder="iv-year, ii-semester, r22"
                disabled={saving}
              />
            </label>

            <label className="admin-check admin-field-wide">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                disabled={saving}
              />
              <span>Pin / highlight this alert (shown first)</span>
            </label>

            <label className="admin-check admin-field-wide">
              <input
                type="checkbox"
                checked={form.confirmed}
                onChange={(e) => setForm({ ...form, confirmed: e.target.checked })}
                disabled={saving}
              />
              <span>
                I opened the official source above and verified the title, date
                and summary are accurate.
              </span>
            </label>

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-ghost"
                onClick={() => setForm(null)}
                disabled={saving}
              >
                <X size={15} aria-hidden="true" /> Cancel
              </button>
              <button type="submit" className="admin-primary" disabled={saving}>
                <Sparkles size={15} aria-hidden="true" />
                {saving ? "Promoting…" : "Promote to draft"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <div className="admin-toolbar">
        <div className="admin-range" role="group" aria-label="Filter by review state">
          {STATE_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`admin-range-btn${stateFilter === option.id ? " is-active" : ""}`}
              aria-pressed={stateFilter === option.id}
              onClick={() => setStateFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="admin-field admin-field-small">
          <span className="admin-field-label">Source</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value={REVIEW_FILTER_ALL}>All sources</option>
            {sourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search staged notices…"
            aria-label="Search staged notices by title or source"
          />
        </div>
      </div>

      {itemsLoading ? (
        <Spinner label="Loading staged notices…" />
      ) : itemsError ? (
        <EmptyState title="Could not load staged notices" icon={ShieldAlert}>
          <p>
            {itemsError?.message ||
              "The staging query failed. Confirm Firestore is enabled and the rules are deployed."}
          </p>
        </EmptyState>
      ) : !items.length ? (
        <EmptyState title="No staged notices yet" icon={Inbox}>
          <p>
            Once the collector runs, new notices appear here for review. Nothing
            is published until you promote and verify it.
          </p>
        </EmptyState>
      ) : !filtered.length ? (
        <EmptyState title="No notices match your filters" icon={Search}>
          <p>Try a different search term, review state or source.</p>
        </EmptyState>
      ) : (
        <Panel
          title="Staged notices"
          subtitle={`${formatNumber(filtered.length)} of ${formatNumber(items.length)} loaded shown`}
        >
          <ul className="admin-alerts">
            {filtered.map((item) => {
              const busy = busyId === item.id;
              const changed = hasContentChange(item);
              const stateClass =
                item.reviewState === REVIEW_STATE.PROMOTED
                  ? "admin-pill-on"
                  : item.reviewState === REVIEW_STATE.IGNORED
                    ? "admin-pill-off"
                    : "admin-pill-unverified";
              const primaryUrl =
                item.canonicalUrl || item.documentUrl || item.sourceUrl || "";
              return (
                <li key={item.id} className="admin-alert-row">
                  <span className="admin-alert-main">
                    <span className="admin-strong">{item.title || "Untitled notice"}</span>
                    <span className="admin-alert-meta">
                      <span className={`admin-pill ${stateClass}`}>
                        {STATE_LABELS[item.reviewState] || item.reviewState}
                      </span>
                      <span className="admin-pill">
                        {getAlertCategory(item.category)?.label ||
                          item.category ||
                          "—"}
                      </span>
                      {changed ? (
                        <span className="admin-pill admin-pill-unverified">
                          <AlertTriangle size={12} aria-hidden="true" /> Content changed
                        </span>
                      ) : null}
                      <span className="admin-subtext">
                        Source: {sourceLabelFor(item, null)}
                      </span>
                      <span className="admin-subtext">
                        Notice date: {formatNoticeDate(item.noticeDate)}
                      </span>
                      <span className="admin-subtext">
                        First seen: {formatInstant(item.firstSeenAt)}
                      </span>
                      <span className="admin-subtext">
                        Last seen: {formatInstant(item.lastSeenAt)}
                      </span>
                      {item.seenCount > 1 ? (
                        <span className="admin-subtext">Seen {item.seenCount}×</span>
                      ) : null}
                      {item.promotedAlertId ? (
                        <span className="admin-subtext">
                          Promoted to draft {item.promotedAlertId}
                          {item.promotedBy ? ` · ${item.promotedBy}` : ""}
                        </span>
                      ) : null}
                      {changed && item.changedAt ? (
                        <span className="admin-subtext">
                          Changed: {formatInstant(item.changedAt)}
                        </span>
                      ) : null}
                    </span>

                    {item.attachments.length || item.documentUrl ? (
                      <span className="admin-alert-meta">
                        {item.documentUrl ? (
                          <a
                            className="admin-subtext"
                            href={item.documentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FileText size={11} aria-hidden="true" /> Notice PDF
                          </a>
                        ) : null}
                        {item.attachments.map((url) => (
                          <a
                            key={url}
                            className="admin-subtext"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FileText size={11} aria-hidden="true" /> {fileName(url)}
                          </a>
                        ))}
                      </span>
                    ) : null}
                  </span>

                  <span className="admin-alert-actions">
                    {primaryUrl ? (
                      <a
                        className="admin-ghost"
                        href={primaryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open the source for ${item.title}`}
                      >
                        <ExternalLink size={15} aria-hidden="true" /> Source
                      </a>
                    ) : null}
                    {item.reviewState !== REVIEW_STATE.PROMOTED ? (
                      <button
                        type="button"
                        className="admin-primary"
                        onClick={() => startReview(item)}
                        disabled={busy}
                      >
                        <Sparkles size={15} aria-hidden="true" />
                        {item.reviewState === REVIEW_STATE.IGNORED ? "Review" : "Promote"}
                      </button>
                    ) : null}
                    {item.reviewState === REVIEW_STATE.NEW ? (
                      <button
                        type="button"
                        className="admin-ghost admin-danger"
                        onClick={() => ignore(item)}
                        disabled={busy}
                        aria-label={`Ignore ${item.title}`}
                      >
                        <Trash2 size={15} aria-hidden="true" /> Ignore
                      </button>
                    ) : null}
                    {item.reviewState === REVIEW_STATE.IGNORED ? (
                      <button
                        type="button"
                        className="admin-ghost"
                        onClick={() => returnToReview(item)}
                        disabled={busy}
                        aria-label={`Return ${item.title} to review`}
                      >
                        <Undo2 size={15} aria-hidden="true" /> Return to review
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {hasMore ? (
            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-ghost"
                onClick={() => loadItems({ reset: false })}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </Panel>
      )}

      <Panel
        title="Source health"
        subtitle="Last attempt and last successful collection per official source."
      >
        {metaLoading ? (
          <Spinner label="Loading source health…" />
        ) : healthError ? (
          <EmptyState title="Could not load source health" icon={ShieldAlert}>
            <p>{healthError?.message || "The source-health query failed."}</p>
          </EmptyState>
        ) : !health.length ? (
          <EmptyState title="No source health recorded yet" icon={metaIcon}>
            <p>Health records appear after the collector's first run.</p>
          </EmptyState>
        ) : (
          <ul className="admin-alerts">
            {brokenSources.length ? (
              <li className="admin-form-error" role="alert">
                {brokenSources.length} source
                {brokenSources.length === 1 ? "" : "s"} need attention:{" "}
                {brokenSources
                  .map((h) => sourceLabelFor({ sourceId: h.sourceId, sourceName: h.name }, h))
                  .join(", ")}
                .
              </li>
            ) : null}
            {health.map((record) => {
              const broken = record.status === "broken" || record.status === "degraded";
              const stateClass =
                record.status === "ok"
                  ? "admin-pill-on"
                  : record.status === "broken"
                    ? "admin-pill-unverified"
                    : "admin-pill-off";
              return (
                <li
                  key={record.id}
                  className={`admin-alert-row${broken ? " is-broken" : ""}`}
                >
                  <span className="admin-alert-main">
                    <span className="admin-strong">
                      {sourceLabelFor(
                        { sourceId: record.sourceId, sourceName: record.name },
                        record
                      )}
                      {broken ? (
                        <span className="admin-pill admin-pill-unverified">
                          <ShieldAlert size={12} aria-hidden="true" /> Needs attention
                        </span>
                      ) : null}
                    </span>
                    <span className="admin-alert-meta">
                      <span className={`admin-pill ${stateClass}`}>{record.status}</span>
                      <span className="admin-subtext">
                        Last attempt: {formatInstant(record.lastRunAt)}
                      </span>
                      <span className="admin-subtext">
                        Last success: {formatInstant(record.lastSuccessAt)}
                      </span>
                      <span className="admin-subtext">
                        Consecutive failures: {formatNumber(record.consecutiveFailures)}
                      </span>
                      <span className="admin-subtext">
                        Notices last run: {formatNumber(record.lastNotices)}
                      </span>
                      <span className="admin-subtext">
                        Runs: {formatNumber(record.totalRuns)} · Failures:{" "}
                        {formatNumber(record.totalFailures)}
                      </span>
                    </span>
                    {record.lastError?.message ? (
                      <span className="admin-subtext">
                        Last error:{" "}
                        {record.lastError.code ? `[${record.lastError.code}] ` : ""}
                        {record.lastError.message}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Recent ingestion runs"
        subtitle="What the collector did on each run, newest first."
      >
        {metaLoading ? (
          <Spinner label="Loading runs…" />
        ) : runsError ? (
          <EmptyState title="Could not load ingestion runs" icon={ShieldAlert}>
            <p>{runsError?.message || "The runs query failed."}</p>
          </EmptyState>
        ) : !runs.length ? (
          <EmptyState title="No ingestion runs yet" icon={Inbox}>
            <p>Run reports appear after the collector's first run.</p>
          </EmptyState>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Status</th>
                <th scope="col">Mode</th>
                <th scope="col">Sources</th>
                <th scope="col">Notices</th>
                <th scope="col">Created</th>
                <th scope="col">Changed</th>
                <th scope="col">Failed</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatInstant(run.startedAt)}</td>
                  <td>
                    <span
                      className={`admin-pill ${
                        run.status === "ok"
                          ? "admin-pill-on"
                          : run.status === "failed"
                            ? "admin-pill-unverified"
                            : "admin-pill-off"
                      }`}
                    >
                      {run.status}
                      {run.dryRun ? " · dry" : ""}
                    </span>
                  </td>
                  <td>{run.mode || "—"}</td>
                  <td>{formatNumber(run.counts.sources)}</td>
                  <td>{formatNumber(run.counts.notices)}</td>
                  <td>{formatNumber(run.counts.itemsCreated)}</td>
                  <td>{formatNumber(run.counts.itemsChanged)}</td>
                  <td>{formatNumber(run.counts.failed)}</td>
                  <td>{run.durationMs ? `${formatNumber(run.durationMs)} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <p className="admin-methodology">
        Staged notices live in the <code>jntuh-notes-staging</code> Firebase
        project's <code>ingestItems</code> collection; run reports and source
        health live in <code>ingestRuns</code> and{" "}
        <code>ingestSourceHealth</code> there. Only administrators with that
        project's <code>admin</code> claim may read them, and only the review
        fields (<code>reviewState</code>, <code>promotedAlertId</code>,{" "}
        <code>promotedAt</code>, <code>promotedBy</code>) may be changed from the
        browser. Promotion creates a private draft in the production project,
        once and never as a duplicate; nothing is verified or published here.{" "}
        {ALERT_DISCLAIMER}
      </p>
    </div>
  );
}

// --- staging project connection ---------------------------------------------

/**
 * A Firebase Auth session is scoped to one project, so the staging project needs
 * its own sign-in. Production login attempts this automatically; this panel is
 * the explicit fallback (and the explanation when staging is not configured).
 */
function StagingConnect({
  status,
  email,
  onEmail,
  password,
  onPassword,
  submitting,
  error,
  onSubmit,
  onDisconnect,
}) {
  if (status === "unconfigured") {
    return (
      <div className="admin-stack">
        <Panel title="Staging project not configured">
          <p className="admin-subtext">
            Collected notices are stored in the separate Firebase project{" "}
            <code>jntuh-notes-staging</code>, not in this site's production
            project. Set the <code>VITE_STAGING_FIREBASE_*</code> environment
            variables (see <code>.env.example</code>) and redeploy to enable this
            page. The collector is unaffected; it continues to stage notices.
          </p>
        </Panel>
      </div>
    );
  }

  const forbidden = status === "forbidden";

  return (
    <div className="admin-stack">
      <Panel
        title={forbidden ? "Staging access denied" : "Connect the staging project"}
        subtitle="A Firebase session is scoped to one project. Sign in to the staging project to review collected notices."
      >
        <form className="admin-alerts-form" onSubmit={onSubmit} noValidate>
          {forbidden && (
            <p className="admin-form-error" role="alert">
              This account is signed in to the staging project but does not have
              the <code>admin</code> claim there. Grant the claim in{" "}
              <code>jntuh-notes-staging</code>, or sign in with a staging
              administrator account.
            </p>
          )}
          {status === "unavailable" && (
            <p className="admin-form-error" role="alert">
              Could not reach the staging project. Check your connection and
              reload this page.
            </p>
          )}
          {error && (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          )}
          <label className="admin-field admin-field-wide">
            <span className="admin-field-label">Administrator email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
              disabled={submitting}
              required
            />
          </label>
          <label className="admin-field admin-field-wide">
            <span className="admin-field-label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>
          <div className="admin-form-actions">
            <button type="submit" className="admin-primary" disabled={submitting}>
              {submitting ? "Connecting…" : "Connect staging"}
            </button>
            {forbidden && (
              <button
                type="button"
                className="admin-ghost"
                onClick={onDisconnect}
                disabled={submitting}
              >
                Use a different account
              </button>
            )}
          </div>
          <p className="admin-subtext">
            The staging project has its own Firestore rules and its own{" "}
            <code>admin</code> claim. This page never stores your credentials.
          </p>
        </form>
      </Panel>
    </div>
  );
}
