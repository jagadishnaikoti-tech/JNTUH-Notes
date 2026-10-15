import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BellRing,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
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
  ALERT_STATUS,
  cleanAlert,
  createAlert,
  deleteAlert,
  fetchAllAlerts,
  publishAlert,
  unpublishAlert,
  updateAlert,
  verifyAlert,
} from "../../lib/alerts.js";
import {
  ALERT_CATEGORIES,
  ALERT_DISCLAIMER,
  ALERT_SOURCES,
  getAlertCategory,
} from "../../data/alertSources.js";

const EMPTY = {
  id: null,
  title: "",
  summary: "",
  category: ALERT_CATEGORIES[0]?.id || "general",
  sourceName: "",
  sourceUrl: "",
  publishedAt: "",
  deadlineAt: "",
  audience: [],
  tagsText: "",
  pinned: false,
  status: ALERT_STATUS.DRAFT,
};

const AUDIENCE_OPTIONS = [
  { id: "all", label: "All years" },
  { id: "1", label: "1st year" },
  { id: "2", label: "2nd year" },
  { id: "3", label: "3rd year" },
  { id: "4", label: "4th year" },
];

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: ALERT_STATUS.DRAFT, label: "Drafts" },
  { id: ALERT_STATUS.PUBLISHED, label: "Published" },
];

// --- small date/list helpers (Firestore Timestamp | Date | string | number) ---

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toDateInput(value) {
  const ms = millisOf(value);
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

/** Date-only fields (publishedAt / deadlineAt) are calendar dates stored at
 *  UTC midnight, so they render in UTC - local formatting would shift the day
 *  for viewers west of UTC. Display only; stored values are untouched. */
function formatAlertDate(value) {
  const ms = millisOf(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Real instants (createdAt / verifiedAt) render in the viewer's local time. */
function formatAlertInstant(value) {
  const ms = millisOf(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isVerified(alert) {
  return Boolean(alert?.verifiedAt);
}

function splitTags(text) {
  return String(text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAlerts(await fetchAllAlerts());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    let drafts = 0;
    let published = 0;
    for (const alert of alerts) {
      if (alert.status === ALERT_STATUS.PUBLISHED) published += 1;
      else drafts += 1;
    }
    return { total: alerts.length, drafts, published };
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      if (statusFilter !== "all" && alert.status !== statusFilter) return false;
      if (categoryFilter !== "all" && alert.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        alert.title,
        alert.summary,
        alert.sourceName,
        alert.sourceUrl,
        getAlertCategory(alert.category)?.label,
        ...(Array.isArray(alert.tags) ? alert.tags : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [alerts, query, statusFilter, categoryFilter]);

  function startAdd() {
    // Spread + fresh array: EMPTY.audience must never be shared with a form.
    setForm({ ...EMPTY, audience: [] });
    setFormError("");
    setFlash(null);
  }

  function startEdit(alert) {
    setForm({
      id: alert.id,
      title: alert.title || "",
      summary: alert.summary || "",
      category: alert.category || EMPTY.category,
      sourceName: alert.sourceName || "",
      sourceUrl: alert.sourceUrl || "",
      publishedAt: toDateInput(alert.publishedAt),
      deadlineAt: toDateInput(alert.deadlineAt),
      audience: Array.isArray(alert.audience) ? alert.audience : [],
      tagsText: Array.isArray(alert.tags) ? alert.tags.join(", ") : "",
      pinned: Boolean(alert.pinned),
      // Status is carried through, never edited here: creating a draft must not
      // publish it, and editing a published alert must not unpublish it.
      status: alert.status || ALERT_STATUS.DRAFT,
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

  async function save(event) {
    event.preventDefault();
    setFormError("");

    if (!form.publishedAt) {
      setFormError("Please enter the official publication date.");
      return;
    }

    const payload = { ...form, tags: splitTags(form.tagsText) };
    try {
      cleanAlert(payload); // validate before writing anything
    } catch (err) {
      setFormError(err.message);
      return;
    }

    setSaving(true);
    try {
      const editing = Boolean(form.id);
      if (editing) await updateAlert(form.id, payload);
      else await createAlert(payload);
      setForm(null);
      setFlash({
        tone: "success",
        message: editing
          ? "Alert updated."
          : "Draft created. Open the official source, verify it, then publish.",
      });
      await load();
    } catch (err) {
      setFormError(
        err?.code === "permission-denied"
          ? "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
          : err?.message || "Could not save the alert."
      );
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
      await load();
    } catch (err) {
      setFlash({
        tone: "error",
        message:
          err?.code === "permission-denied"
            ? "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
            : err?.message || "The action could not be completed.",
      });
    } finally {
      setBusyId(null);
    }
  }

  function verify(alert) {
    runAction(alert.id, () => verifyAlert(alert.id), "Marked as verified.");
  }

  function publish(alert) {
    if (!isVerified(alert)) {
      setFlash({
        tone: "error",
        message:
          "Verify the notice against the official source before publishing it.",
      });
      return;
    }
    if (
      !window.confirm(
        `Publish “${alert.title}”? It becomes visible to visitors immediately.`
      )
    ) {
      return;
    }
    runAction(alert.id, () => publishAlert(alert.id), "Alert published.");
  }

  function unpublish(alert) {
    if (
      !window.confirm(
        `Unpublish “${alert.title}”? It will be hidden from visitors until republished.`
      )
    ) {
      return;
    }
    runAction(alert.id, () => unpublishAlert(alert.id), "Alert moved back to drafts.");
  }

  function remove(alert) {
    if (
      !window.confirm(
        `Delete “${alert.title}”? This permanently removes the alert and cannot be undone.`
      )
    ) {
      return;
    }
    runAction(alert.id, () => deleteAlert(alert.id), "Alert deleted.");
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <p className="admin-toolbar-note">
          Alert Radar publishes verified JNTUH announcements. Drafts stay
          private — open the official source, verify every detail, then publish.
        </p>
        <button
          type="button"
          className="admin-refresh"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw
            size={15}
            className={loading ? "admin-spin" : ""}
            aria-hidden="true"
          />
          Refresh
        </button>
        <button type="button" className="admin-primary" onClick={startAdd}>
          <Plus size={15} aria-hidden="true" /> New alert
        </button>
      </div>

      <div className="admin-stats">
        <StatCard label="Total alerts" value={formatNumber(stats.total)} icon={BellRing} />
        <StatCard label="Drafts" value={formatNumber(stats.drafts)} icon={Pencil} />
        <StatCard label="Published" value={formatNumber(stats.published)} icon={Send} />
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
          title={form.id ? "Edit alert" : "New alert"}
          subtitle="New alerts are saved as drafts. Verify against the official source before publishing."
        >
          <form className="admin-alerts-form" onSubmit={save} noValidate>
            {formError ? (
              <p className="admin-form-error" role="alert">
                {formError}
              </p>
            ) : null}

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
              <span className="admin-field-label">Summary</span>
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
                list="admin-alert-source-names"
                maxLength={80}
                disabled={saving}
              />
              <datalist id="admin-alert-source-names">
                {ALERT_SOURCES.map((source) => (
                  <option key={source.id} value={source.name} />
                ))}
              </datalist>
            </label>

            <div className="admin-field admin-field-wide">
              <label className="admin-field-label" htmlFor="admin-alert-source-url">
                Official source URL
              </label>
              <input
                id="admin-alert-source-url"
                type="url"
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                placeholder="https://jntuh.ac.in/notifications"
                disabled={saving}
                required
              />
              {form.sourceUrl ? (
                <a
                  className="admin-subtext"
                  href={form.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source to verify <ExternalLink size={11} aria-hidden="true" />
                </a>
              ) : null}
            </div>

            <div
              className="admin-field admin-field-wide"
              role="group"
              aria-labelledby="admin-alert-source-fill"
            >
              <span className="admin-field-label" id="admin-alert-source-fill">
                Quick fill from known official pages
              </span>
              <div className="admin-alert-sources">
                {ALERT_SOURCES.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="admin-ghost"
                    onClick={() =>
                      setForm({
                        ...form,
                        sourceName: source.name,
                        sourceUrl: source.url,
                      })
                    }
                    disabled={saving}
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="admin-field">
              <span className="admin-field-label">
                Official publication date
              </span>
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
              aria-labelledby="admin-alert-audience-label"
            >
              <span className="admin-field-label" id="admin-alert-audience-label">
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
                {saving
                  ? "Saving…"
                  : form.id
                    ? "Save changes"
                    : "Create draft"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <div className="admin-toolbar">
        <div className="admin-range" role="group" aria-label="Filter alerts by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`admin-range-btn${statusFilter === option.id ? " is-active" : ""}`}
              aria-pressed={statusFilter === option.id}
              onClick={() => setStatusFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="admin-field admin-field-small">
          <span className="admin-field-label">Category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {ALERT_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
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
            placeholder="Search alerts…"
            aria-label="Search alerts by title, summary, tags or source"
          />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading alerts…" />
      ) : error ? (
        <EmptyState title="Could not load alerts" icon={ShieldAlert}>
          <p>
            {error?.code === "permission-denied"
              ? "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
              : "The alerts query failed. Confirm Firestore is enabled."}
          </p>
        </EmptyState>
      ) : !alerts.length ? (
        <EmptyState title="No alerts yet" icon={BellRing}>
          <p>
            Create the first draft, verify it against the official JNTUH source,
            then publish. Visitors see nothing until an alert is published.
          </p>
        </EmptyState>
      ) : !filtered.length ? (
        <EmptyState title="No alerts match your filters" icon={Search}>
          <p>Try a different search term, status or category.</p>
        </EmptyState>
      ) : (
        <Panel
          title="Alerts"
          subtitle={`${formatNumber(filtered.length)} of ${formatNumber(alerts.length)} shown`}
        >
          <ul className="admin-alerts">
            {filtered.map((alert) => {
              const published = alert.status === ALERT_STATUS.PUBLISHED;
              const verified = isVerified(alert);
              const category = getAlertCategory(alert.category);
              const busy = busyId === alert.id;
              return (
                <li key={alert.id} className="admin-alert-row">
                  <span className="admin-alert-main">
                    <span className="admin-strong">{alert.title}</span>
                    <span className="admin-subtext admin-alert-summary">
                      {alert.summary}
                    </span>
                    <span className="admin-alert-meta">
                      <span className="admin-pill">
                        {category?.label || alert.category || "—"}
                      </span>
                      <span
                        className={`admin-pill ${published ? "admin-pill-on" : "admin-pill-off"}`}
                      >
                        {published ? "Published" : "Draft"}
                      </span>
                      {verified ? (
                        <span className="admin-pill admin-pill-verified">
                          <BadgeCheck size={12} aria-hidden="true" /> Verified
                        </span>
                      ) : (
                        <span className="admin-pill admin-pill-unverified">
                          <ShieldAlert size={12} aria-hidden="true" /> Unverified
                        </span>
                      )}
                      {alert.pinned ? (
                        <span className="admin-pill admin-pill-pinned">
                          <Pin size={12} aria-hidden="true" /> Pinned
                        </span>
                      ) : null}
                      <span className="admin-subtext">
                        Official: {formatAlertDate(alert.publishedAt)}
                      </span>
                      {alert.deadlineAt ? (
                        <span className="admin-subtext">
                          Deadline: {formatAlertDate(alert.deadlineAt)}
                        </span>
                      ) : null}
                      <span className="admin-subtext">
                        Added: {formatAlertInstant(alert.createdAt)}
                        {alert.createdBy ? ` · ${alert.createdBy}` : ""}
                      </span>
                      {verified ? (
                        <span className="admin-subtext">
                          Verified: {formatAlertInstant(alert.verifiedAt)}
                          {alert.verifiedBy ? ` · ${alert.verifiedBy}` : ""}
                        </span>
                      ) : null}
                    </span>
                  </span>

                  <span className="admin-alert-actions">
                    <a
                      className="admin-ghost"
                      href={alert.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open the official source for ${alert.title}`}
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                    {!verified ? (
                      <button
                        type="button"
                        className="admin-ghost"
                        onClick={() => verify(alert)}
                        disabled={busy}
                      >
                        <BadgeCheck size={15} aria-hidden="true" /> Verify
                      </button>
                    ) : null}
                    {!published && verified ? (
                      <button
                        type="button"
                        className="admin-primary"
                        onClick={() => publish(alert)}
                        disabled={busy}
                      >
                        <Send size={15} aria-hidden="true" /> Publish
                      </button>
                    ) : null}
                    {published ? (
                      <button
                        type="button"
                        className="admin-ghost"
                        onClick={() => unpublish(alert)}
                        disabled={busy}
                      >
                        <Undo2 size={15} aria-hidden="true" /> Unpublish
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="admin-ghost"
                      onClick={() => startEdit(alert)}
                      aria-label={`Edit ${alert.title}`}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="admin-ghost admin-danger"
                      onClick={() => remove(alert)}
                      disabled={busy}
                      aria-label={`Delete ${alert.title}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <p className="admin-methodology">
        Alerts are stored in the Firestore <code>alerts</code> collection. Only
        administrators may read drafts or write to the collection; visitors may
        read published alerts only. Everything here is entered and verified by hand —
        no scraping, and nothing is published automatically. {ALERT_DISCLAIMER}{" "}
        <a
          href="https://console.firebase.google.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Firebase Console <ExternalLink size={12} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
