import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  BellRing,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  LogOut,
  MousePointerClick,
  Share2,
} from "lucide-react";
import { useAdmin } from "./AdminAuthContext.jsx";
import { signOutAdmin } from "../../lib/adminAuth.js";
import SoundToggle from "../SoundToggle.jsx";
import "../../styles/admin.css";

const NAV = [
  { to: "/admin/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/pdf-activity", label: "PDF Activity", icon: MousePointerClick },
  { to: "/admin/channels", label: "Channels", icon: Share2 },
  { to: "/admin/alerts", label: "Alerts", icon: BellRing },
  { to: "/admin/ingest", label: "Ingestion", icon: Inbox },
];

const TITLES = {
  "/admin/dashboard": "Overview",
  "/admin/analytics": "Visitor Analytics",
  "/admin/pdf-activity": "PDF Activity",
  "/admin/channels": "Social Channels",
  "/admin/alerts": "Alert Radar",
  "/admin/ingest": "Alert Ingestion",
};

export default function AdminLayout() {
  const { user } = useAdmin();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.title = `${TITLES[pathname] || "Administration"} · JNTUH Notes`;
  }, [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutAdmin();
    } catch (err) {
      console.warn("[admin] sign-out failed:", err);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            JN
          </span>
          <span className="admin-brand-text">
            <strong>JNTUH Notes</strong>
            <small>Administration</small>
          </span>
        </div>

        <nav className="admin-nav" aria-label="Admin sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `admin-nav-link${isActive ? " is-active" : ""}`
                }
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="admin-sidebar-foot">
          <a
            className="admin-view-site"
            href="/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} aria-hidden="true" />
            View website
          </a>
          <button
            type="button"
            className="admin-logout"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut size={16} aria-hidden="true" />
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <h1 className="admin-title">{TITLES[pathname] || "Administration"}</h1>
          <div className="admin-topbar-right">
            <SoundToggle />
            <span className="admin-user" title={user?.email || ""}>
              {user?.email || "administrator"}
            </span>
            <NavLink className="admin-view-site" to="/">
              <ExternalLink size={14} aria-hidden="true" />
              View site
            </NavLink>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
