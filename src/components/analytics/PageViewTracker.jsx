import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../../lib/analytics.js";

/**
 * Records one page view per public route. Lives inside the public layout only,
 * so admin routes are never counted as visitor activity.
 *
 * The title is written to <head> by the layout's own effect, which runs after
 * this child effect; we defer by a tick so the recorded title is the final one.
 * The analytics module also de-duplicates, covering StrictMode double-invokes.
 */
export default function PageViewTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname.startsWith("/admin")) return undefined;
    const id = window.setTimeout(() => {
      trackPageView({ path: pathname, title: document.title });
    }, 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
