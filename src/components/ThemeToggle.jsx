import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, resolveInitialTheme, storeTheme } from "../lib/theme.js";

/**
 * Light / dark mode switch shown in the top-right of the header.
 *
 * The initial value comes from <html data-theme> (set by the inline script in
 * index.html before paint), so the button's icon always matches what is shown.
 * Dark is the site default until the visitor chooses otherwise.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const current = document.documentElement.getAttribute("data-theme");
    return current === "dark" || current === "light"
      ? current
      : resolveInitialTheme();
  });

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
