import { Menu } from "lucide-react";
import { SITE } from "../data/site.js";
import { useSidebar } from "./SidebarContext.jsx";
import Breadcrumbs from "./Breadcrumbs.jsx";
import SearchBar from "./SearchBar.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export default function Header() {
  const { toggleMobile, mobileOpen } = useSidebar();

  return (
    <header className="app-header">
      <div className="header-inner">
        <button
          type="button"
          className="header-menu"
          onClick={toggleMobile}
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          aria-controls="primary-sidebar"
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        <span className="header-brand-mobile">{SITE.heading}</span>

        <Breadcrumbs />

        <div className="header-search">
          <SearchBar id="header-search" compact />
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}
