import { useEffect, useState } from "react";
import {
  ExternalLink,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState, Panel, Spinner, formatNumber } from "../../components/admin/adminUi.jsx";
import {
  createChannel,
  deleteChannel,
  fetchAllChannels,
  updateChannel,
} from "../../lib/channels.js";
import { SOCIAL_ICON_KEYS, socialIcon } from "../../lib/social.js";

const EMPTY = { id: null, name: "", url: "", icon: "website", order: 0, active: true };

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default function AdminChannels() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setChannels(await fetchAllChannels());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startAdd() {
    setForm({ ...EMPTY, order: channels.length });
    setFormError("");
  }

  function startEdit(channel) {
    setForm({
      id: channel.id,
      name: channel.name || "",
      url: channel.url || "",
      icon: channel.icon || "other",
      order: Number.isFinite(channel.order) ? channel.order : 0,
      active: Boolean(channel.active),
    });
    setFormError("");
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("A channel name is required.");
      return;
    }
    if (!isValidUrl(form.url.trim())) {
      setFormError("Enter a valid http(s) URL.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (form.id) await updateChannel(form.id, form);
      else await createChannel(form);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(
        err?.code === "permission-denied"
          ? "Permission denied. Confirm your account has the admin claim and the rules are deployed."
          : "Could not save the channel."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(channel) {
    setBusyId(channel.id);
    try {
      await updateChannel(channel.id, { ...channel, active: !channel.active });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(channel) {
    if (!window.confirm(`Delete the “${channel.name}” channel? This cannot be undone.`)) {
      return;
    }
    setBusyId(channel.id);
    try {
      await deleteChannel(channel.id);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <p className="admin-toolbar-note">
          Active channels appear in the public sidebar and footer.
        </p>
        <button type="button" className="admin-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "admin-spin" : ""} aria-hidden="true" />
          Refresh
        </button>
        <button type="button" className="admin-primary" onClick={startAdd}>
          <Plus size={15} aria-hidden="true" /> Add channel
        </button>
      </div>

      {form ? (
        <Panel title={form.id ? "Edit channel" : "New channel"}>
          <form className="admin-form admin-form-row" onSubmit={save} noValidate>
            {formError ? (
              <p className="admin-form-error" role="alert">
                {formError}
              </p>
            ) : null}

            <label className="admin-field">
              <span className="admin-field-label">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Instagram"
                disabled={saving}
                required
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">URL</span>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://instagram.com/yourhandle"
                disabled={saving}
                required
              />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Icon</span>
              <select
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                disabled={saving}
              >
                {SOCIAL_ICON_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {socialIcon(key).label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field admin-field-small">
              <span className="admin-field-label">Order</span>
              <input
                type="number"
                value={form.order}
                onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
                disabled={saving}
              />
            </label>

            <label className="admin-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                disabled={saving}
              />
              <span>Active (visible to visitors)</span>
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
                {saving ? "Saving…" : form.id ? "Save changes" : "Add channel"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      {loading ? (
        <Spinner label="Loading channels…" />
      ) : error ? (
        <EmptyState title="Could not load channels">
          <p>
            {error?.code === "permission-denied"
              ? "Permission denied. Confirm your account has the admin claim and the Firestore rules are deployed."
              : "The channels query failed. Confirm Firestore is enabled."}
          </p>
        </EmptyState>
      ) : !channels.length ? (
        <EmptyState title="No social channels yet" icon={Share2}>
          <p>
            Add the first channel to display it in the public sidebar and footer.
            Visitors see nothing until a channel is marked active.
          </p>
        </EmptyState>
      ) : (
        <Panel title="Channels" subtitle={`${formatNumber(channels.length)} configured`}>
          <ul className="admin-channels">
            {channels.map((channel) => {
              const { Icon } = socialIcon(channel.icon);
              return (
                <li key={channel.id} className="admin-channel">
                  <span className="admin-channel-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="admin-channel-main">
                    <span className="admin-strong">{channel.name}</span>
                    <a
                      className="admin-subtext admin-mono"
                      href={channel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {channel.url}
                    </a>
                  </span>
                  <span className="admin-channel-order">#{channel.order ?? "—"}</span>
                  <span
                    className={`admin-pill ${channel.active ? "admin-pill-on" : "admin-pill-off"}`}
                  >
                    {channel.active ? "active" : "hidden"}
                  </span>
                  <span className="admin-channel-actions">
                    <button
                      type="button"
                      className="admin-ghost"
                      onClick={() => toggleActive(channel)}
                      disabled={busyId === channel.id}
                    >
                      {channel.active ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="admin-ghost"
                      onClick={() => startEdit(channel)}
                      aria-label={`Edit ${channel.name}`}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="admin-ghost admin-danger"
                      onClick={() => remove(channel)}
                      disabled={busyId === channel.id}
                      aria-label={`Delete ${channel.name}`}
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
        Channels are stored in the Firestore <code>channels</code> collection.
        Only administrators may read inactive channels or write to the
        collection; visitors may read active channels only.{" "}
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
