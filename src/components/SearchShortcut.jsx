import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Global "/" shortcut that focuses the most prominent visible search input.
 * It never fires while the user is typing in an input, textarea, select or
 * contenteditable element, so normal text entry is unaffected.
 */
export default function SearchShortcut() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditable(event.target)) return;

      const pageInput = document.querySelector("#search-input");
      const headerInput = document.querySelector("#header-search");
      const visible = [pageInput, headerInput].find(
        (el) => el && el.offsetParent !== null
      );

      if (visible) {
        event.preventDefault();
        visible.focus();
        visible.select?.();
        return;
      }

      if (pathname !== "/search") {
        event.preventDefault();
        navigate("/search");
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate, pathname]);

  return null;
}
