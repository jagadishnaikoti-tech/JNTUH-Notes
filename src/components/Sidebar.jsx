import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BookMarked,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  GraduationCap,
  Home,
  LogOut,
  Search,
  X,
} from "lucide-react";
import { CODE_LINKS, SITE, YEARS } from "../data/site.js";
import { useSidebar } from "./SidebarContext.jsx";
import { useCopyrightModal } from "./ModalContext.jsx";
import { useToast } from "./ToastContext.jsx";
import SidebarItem from "./SidebarItem.jsx";

const SUBJECT_PATH = /^\/subject\/([^/]+)\/([^/]+)/;

/** Structured navigation model derived from the site data (single source). */
const NAV = {
  home: { to: "/", label: "Home", icon: Home },
  years: { to: "/years", label: "Select Year", icon: GraduationCap },
  code: { to: "/code", label: "Learn Code", icon: Code2 },
  search: { to: "/search", label: "Search", icon: Search },
};

export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const {
    collapsed,
    mobileOpen,
    closeMobile,
    toggleCollapsed,
    expand,
  } = useSidebar();
  const openCopyright = useCopyrightModal();
  const showToast = useToast();

  const onSignOut = () => {
    try {
      localStorage.clear();
    } catch {
      /* storage may be unavailable */
    }
    closeMobile();
    navigate("/");
    showToast("You are signed out. This site is free \u2014 no account is needed.");
  };

  const subjectMatch = SUBJECT_PATH.exec(pathname);
  const activeFolderId = subjectMatch ? subjectMatch[2] : null;
  const activeGroupId = subjectMatch ? subjectMatch[1] : null;

  const yearActive = (id) =>
    pathname === `/year/${id}` || activeGroupId === `year${id}`;

  const [openYears, setOpenYears] = useState(() => {
    const initial = {};
    for (const y of YEARS) if (yearActive(y.id)) initial[y.id] = true;
    return initial;
  });

  // Keep the group that owns the current route expanded, and collapse the
  // drawer whenever the destination changes (mobile friendly).
  useEffect(() => {
    for (const y of YEARS) {
      if (yearActive(y.id)) {
        setOpenYears((prev) => (prev[y.id] ? prev : { ...prev, [y.id]: true }));
      }
    }
    closeMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const toggleYear = (id) => {
    if (collapsed) {
      expand();
      setOpenYears((prev) => ({ ...prev, [id]: true }));
      return;
    }
    setOpenYears((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const subjectCount = (year) =>
    year.subjects.filter((s) => !s.disabled && s.folderId).length;

  return (
    <>
      {mobileOpen ? (
        <div
          className="sidebar-overlay"
          role="presentation"
          onClick={closeMobile}
        />
      ) : null}

      <aside
        id="primary-sidebar"
        className={"sidebar" + (collapsed ? " is-collapsed" : "")}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <Link className="sidebar-brand-inner" to="/" title="LECTURE NOTES — Home">
            <span className="sidebar-brand-mark" aria-hidden="true">
              <BookOpen size={22} strokeWidth={2} />
            </span>
            <span className="sidebar-brand-text">
              <span className="sidebar-brand-title">{SITE.heading}</span>
              <span className="sidebar-brand-sub">
                {SITE.brand} {SITE.brandEmoji}
              </span>
            </span>
          </Link>
          <button
            type="button"
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={closeMobile}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav">
          <SidebarItem
            to={NAV.home.to}
            label={NAV.home.label}
            icon={NAV.home.icon}
            active={pathname === "/"}
            collapsed={collapsed}
          />
          <SidebarItem
            to={NAV.years.to}
            label={NAV.years.label}
            icon={NAV.years.icon}
            active={pathname === "/years"}
            collapsed={collapsed}
          />

          <p className="sidebar-section-label">Subjects by year</p>

          {YEARS.map((year) => {
            const open = !!openYears[year.id];
            const panelId = `sidebar-year-${year.id}`;
            return (
              <div className="sb-group" key={year.id}>
                <button
                  type="button"
                  className={
                    "sb-group-toggle" + (yearActive(year.id) ? " is-current" : "")
                  }
                  aria-expanded={collapsed ? undefined : open}
                  aria-controls={panelId}
                  onClick={() => toggleYear(year.id)}
                  title={collapsed ? year.name : undefined}
                >
                  <span className="sb-item-icon" aria-hidden="true">
                    <BookMarked size={18} strokeWidth={2} />
                  </span>
                  <span className="sb-item-label sb-group-label">
                    {year.name}
                  </span>
                  <span className="sb-item-badge">{subjectCount(year)}</span>
                  <ChevronsRight
                    className={"sb-group-arrow" + (open ? " is-open" : "")}
                    size={16}
                    aria-hidden="true"
                  />
                </button>

                {open ? (
                  <div className="sb-group-panel" id={panelId}>
                    {year.subjects.map((subject) => {
                      const isActive = activeFolderId === subject.folderId;
                      return (
                        <SidebarItem
                          key={subject.label}
                          className="sb-sub"
                          to={
                            subject.disabled || !subject.folderId
                              ? undefined
                              : `/subject/year${year.id}/${subject.folderId}`
                          }
                          label={subject.label}
                          active={isActive}
                          disabled={subject.disabled || !subject.folderId}
                        />
                      );
                    })}
                    {(year.extras || []).map((extra) => (
                      <SidebarItem
                        key={extra.label}
                        className="sb-sub"
                        to={`/subject/year${year.id}/${extra.folderId}`}
                        label={extra.label}
                        active={activeFolderId === extra.folderId}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <p className="sidebar-section-label">More</p>

          <SidebarItem
            to={NAV.code.to}
            label={NAV.code.label}
            icon={NAV.code.icon}
            active={pathname === "/code" || activeGroupId === "learncode"}
            collapsed={collapsed}
          />
          <SidebarItem
            to={NAV.search.to}
            label={NAV.search.label}
            icon={NAV.search.icon}
            active={pathname === "/search"}
            collapsed={collapsed}
          />

          <p className="sidebar-section-label">Coding resources</p>
          {CODE_LINKS.map((link) => (
            <a
              key={link.label}
              className="sb-sub"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${link.label} (opens in a new tab)`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="sb-attribution">
            <span className="sb-attribution-text">Developed by </span>
            <span className="sb-attribution-name">Jagadish</span>
          </p>
          <p className="sb-attribution sb-attribution-links">
            <button type="button" className="link-btn" onClick={openCopyright}>
              Credits
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="link-btn" onClick={onSignOut}>
              <LogOut size={13} aria-hidden="true" />
              Sign out
            </button>
          </p>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? (
              <ChevronsRight size={18} aria-hidden="true" />
            ) : (
              <ChevronsLeft size={18} aria-hidden="true" />
            )}
            <span className="sidebar-collapse-label">Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}
