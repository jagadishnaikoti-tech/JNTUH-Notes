import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyTheme,
  getStoredTheme,
  resolveInitialTheme,
  storeTheme,
} from "../lib/theme.js";

/**
 * Light / dark mode switch shown in the top-right of the header.
 *
 * The initial value comes from <html data-theme> (set by the inline script in
 * index.html before paint), so the button's icon always matches what is shown.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const current = document.documentElement.getAttribute("data-theme");
    return current === "dark" || current === "light"
      ? current
      : resolveInitialTheme();
  });

  // Follow OS changes, but only while the user has not made an explicit choice.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const onChange = (event) => {
      if (getStoredTheme()) return;
      const next = event.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const isDark = theme === "dark";

  const toggle = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
