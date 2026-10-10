// ---------------------------------------------------------------------------
// Theme (light / dark) helpers.
//
// The effective theme is stored on <html data-theme="...">. An inline script in
// index.html applies the saved value before first paint (no flash); these
// helpers are what the React toggle uses to read and change it at runtime.
//
// Preference resolution order:
//   1. the value the user explicitly chose (localStorage)
//   2. otherwise the site default, which is DARK
// ---------------------------------------------------------------------------

export const THEME_KEY = "ln:theme";

/** Applied when the visitor has not made an explicit choice yet. */
export const DEFAULT_THEME = "dark";

export const THEME_COLORS = {
  light: "#fffbeb",
  dark: "#16120f",
};

/** The saved choice, or null when the user has never chosen. */
export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/** What the theme should be on a fresh load. */
export function resolveInitialTheme() {
  return getStoredTheme() || DEFAULT_THEME;
}

/** Push a theme to the DOM and keep the browser theme-color in sync. */
export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.light);
}

/** Persist the user's explicit choice. */
export function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage disabled - the choice simply won't persist */
  }
}
