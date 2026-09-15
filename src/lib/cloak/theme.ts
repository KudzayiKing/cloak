/*
 * Theme contract for Cloak. Dark is the default and the design's first-class
 * mode; light is the owner-supplied palette (see the `.light` block in
 * globals.css, which is the only place the colours live).
 *
 * The theme is carried on <html> as a single class — `.dark` or `.light` —
 * which is what Tailwind's `darkMode: "class"` and the `@custom-variant dark`
 * in globals.css key off. The app's own components never use `dark:` variants;
 * they read the `cloak-*` custom properties, so swapping the class swaps the
 * whole palette.
 *
 * Three moving parts, in order of when they run:
 *   1. THEME_BOOTSTRAP_SCRIPT — an inline <head> script that applies the stored
 *      preference BEFORE first paint, so a light-mode user never sees a flash
 *      of the dark shell.
 *   2. The store's `theme` field — the persisted preference (cloak-local-state).
 *   3. ThemeSync — re-applies the class whenever the preference changes.
 */

export type CloakTheme = "dark" | "light";

export const CLOAK_THEMES: readonly CloakTheme[] = ["dark", "light"];

export const DEFAULT_CLOAK_THEME: CloakTheme = "dark";

/** The zustand `persist` key the preference lives under. */
export const THEME_STORAGE_KEY = "cloak-local-state";

export function isCloakTheme(value: unknown): value is CloakTheme {
  return value === "dark" || value === "light";
}

/** Status-bar / browser-chrome colour per theme. */
export const CLOAK_THEME_COLORS: Record<CloakTheme, string> = {
  dark: "#0b0b0c",
  light: "#f4efe5",
};

/** iOS standalone status-bar style per theme. */
export const CLOAK_STATUS_BAR_STYLES: Record<CloakTheme, string> = {
  dark: "black-translucent",
  light: "default",
};

/** Swaps the class on <html>. Exactly one theme class is present at a time. */
export function applyCloakTheme(theme: CloakTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  /* Keep Android/iOS browser chrome in step with the theme the user actually
     chose. Next may emit multiple theme-color metas when the viewport uses
     media descriptors, so update all of them. */
  const themeColorMetas =
    typeof document.querySelectorAll === "function"
      ? Array.from(document.querySelectorAll('meta[name="theme-color"]'))
      : [];

  if (themeColorMetas.length > 0) {
    themeColorMetas.forEach((meta) =>
      meta.setAttribute("content", CLOAK_THEME_COLORS[theme])
    );
  } else {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", CLOAK_THEME_COLORS[theme]);
    }
  }

  const appleStatus = document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  );
  if (appleStatus) {
    appleStatus.setAttribute("content", CLOAK_STATUS_BAR_STYLES[theme]);
  }
}

/**
 * Reads the persisted preference without touching the store — used by the
 * inline bootstrap script's generator and by tests.
 *
 * zustand's persist middleware stores `{ state: {...}, version: n }`, so the
 * preference is nested. Anything unexpected falls back to the default rather
 * than throwing: a corrupt storage entry must not break first paint.
 */
export function readStoredTheme(raw: string | null): CloakTheme {
  if (!raw) return DEFAULT_CLOAK_THEME;
  try {
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    const theme = parsed?.state?.theme;
    return isCloakTheme(theme) ? theme : DEFAULT_CLOAK_THEME;
  } catch {
    return DEFAULT_CLOAK_THEME;
  }
}

/**
 * Runs before first paint, from a plain <script> before the app UI.
 * Deliberately dependency-free and defensive — it must never throw, because an
 * exception here would leave the document unstyled.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t="dark";if(r){var p=JSON.parse(r);if(p&&p.state&&p.state.theme==="light")t="light";}var e=document.documentElement;e.classList.remove(t==="light"?"dark":"light");e.classList.add(t);var c=t==="light"?${JSON.stringify(
  CLOAK_THEME_COLORS.light
)}:${JSON.stringify(
  CLOAK_THEME_COLORS.dark
)};var a=document.querySelectorAll?document.querySelectorAll('meta[name="theme-color"]'):null;if(a&&a.length){a.forEach(function(m){m.setAttribute("content",c);});}else{var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);}var s=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(s)s.setAttribute("content",t==="light"?${JSON.stringify(
  CLOAK_STATUS_BAR_STYLES.light
)}:${JSON.stringify(
  CLOAK_STATUS_BAR_STYLES.dark
)});}catch(e){}})();`;
