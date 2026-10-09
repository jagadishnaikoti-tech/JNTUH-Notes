import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const SidebarContext = createContext(null);

const STORAGE_KEY = "ln:sidebar-collapsed";

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
};

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Tracks a CSS media query so the layout can react to viewport changes. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }, [collapsed]);

  // Never leave the drawer open when switching to the desktop layout.
  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);
  const expand = useCallback(() => setCollapsed(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

  // The collapsed (icon-only) presentation only applies on the desktop layout;
  // the mobile drawer always shows full labels.
  const isCollapsed = collapsed && isDesktop;

  const value = useMemo(
    () => ({
      collapsed: isCollapsed,
      mobileOpen,
      isDesktop,
      toggleCollapsed,
      expand,
      openMobile,
      closeMobile,
      toggleMobile,
    }),
    [
      isCollapsed,
      mobileOpen,
      isDesktop,
      toggleCollapsed,
      expand,
      openMobile,
      closeMobile,
      toggleMobile,
    ]
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}
