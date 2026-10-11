import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPdfClick } from "../../lib/analytics.js";
import { describeRoute } from "../../lib/meta.js";

/**
 * Site-wide PDF/document click tracker.
 *
 * A single capture-phase listener covers EVERY document action on the site
 * (document cards, the in-app viewer, question sets, search results and any
 * future link) so there is exactly one event per click - no per-component
 * handlers, no double counting.
 *
 * Document id and action come from the clicked element's data-* attributes
 * when present, and are otherwise derived from the Google Drive URL itself, so
 * links we did not annotate are still tracked for open/download.
 */

const DRIVE_FILE = /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/;
const GENERIC_ID = /[?&]id=([A-Za-z0-9_-]{10,})/;

function parseHref(href) {
  if (!href) return null;
  const file = DRIVE_FILE.exec(href);
  if (file) {
    return { docId: file[1], action: href.includes("/preview") ? "view" : "open" };
  }
  const generic = GENERIC_ID.exec(href);
  if (generic) {
    return { docId: generic[1], action: /export=download|confirm=/.test(href) ? "download" : "open" };
  }
  return null;
}

function nearestTitle(el) {
  const scope = el.closest?.(".doc-card, .qs-item, .viewer, li, tr, article");
  const heading = scope?.querySelector?.(
    ".doc-title, .qs-item-title, .viewer-title, h3, h2"
  );
  return heading?.textContent?.trim() || "";
}

export default function PdfClickTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    function onClick(event) {
      const el = event.target?.closest?.("a, button");
      if (!el) return;

      const href = el.tagName === "A" ? el.getAttribute("href") || "" : "";
      const parsed = parseHref(href);
      const host = el.closest?.("[data-doc-id]");

      const docId =
        el.getAttribute("data-doc-id") ||
        host?.getAttribute("data-doc-id") ||
        parsed?.docId;
      const action = el.getAttribute("data-doc-action") || parsed?.action;

      // Only document actions (Drive links / annotated controls) are tracked.
      if (!docId || !action) return;

      const docTitle =
        el.getAttribute("data-doc-title") ||
        host?.getAttribute("data-doc-title") ||
        nearestTitle(el);

      trackPdfClick({
        docId,
        action,
        docTitle,
        subject: host?.getAttribute("data-doc-subject") || "",
        yearId: host?.getAttribute("data-doc-year-id") || "",
        yearName: host?.getAttribute("data-doc-year") || "",
        sourcePath: pathname,
        sourceTitle: document.title,
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  return null;
}
