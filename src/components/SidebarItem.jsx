import { Link } from "react-router-dom";

/**
 * A single navigation row in the sidebar.
 *
 * Renders a react-router <Link> when `to` is provided, otherwise a <button>
 * for toggle-style controls. When the sidebar is collapsed the label is hidden
 * visually and the accessible name is carried by `label` + `title` (tooltip).
 */
export default function SidebarItem({
  to,
  label,
  icon: Icon,
  badge,
  active = false,
  collapsed = false,
  onClick,
  className = "",
  disabled = false,
  title,
}) {
  const ariaLabel = collapsed ? label : undefined;
  const tooltip = collapsed ? title || label : title;
  const classes = ["sb-item", active ? "is-active" : "", className]
    .filter(Boolean)
    .join(" ");

  if (disabled) {
    return (
      <span
        className={classes + " is-disabled"}
        aria-disabled="true"
        title={tooltip || label}
      >
        {Icon ? (
          <span className="sb-item-icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
        ) : null}
        <span className="sb-item-label">{label}</span>
      </span>
    );
  }

  if (!to) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        aria-label={ariaLabel}
        title={tooltip}
      >        {Icon ? (
          <span className="sb-item-icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
        ) : null}
        <span className="sb-item-label">{label}</span>
        {badge != null ? <span className="sb-item-badge">{badge}</span> : null}
      </button>
    );
  }

  return (
    <Link
      className={classes}
      to={to}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      title={tooltip}
    >
      {Icon ? (
        <span className="sb-item-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={2} />
        </span>
      ) : null}
      <span className="sb-item-label">{label}</span>
      {badge != null ? <span className="sb-item-badge">{badge}</span> : null}
    </Link>
  );
}
