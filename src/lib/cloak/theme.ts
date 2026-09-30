/*
 * Theme contract for Cloak. Dark is the default and the design's first-class
 * mode; light uses a clean white palette (see the `.light` block in
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

/**
 * Status-bar / browser-chrome colour per theme.
 *
 * This is the ELEVATED surface, not the app background: the mobile header is
 * `bg-cloak-bg-elevated` and paints the status-bar inset itself, so the OS tint
 * has to agree with the header or the top of an installed app shows a seam.
 * Keep these in step with `--cloak-bg-elevated` in globals.css (dark #131313,
 * light #ffffff) and with `theme_color` in public/manifest.webmanifest.
 *
 * Dark is #131313 — Android's own gesture-navigation-bar colour on the owner's
 * device. See the comment on --cloak-bg-elevated in globals.css for why the app
 * adopts the platform's value rather than the platform adopting the app's.
 */
export const CLOAK_THEME_COLORS: Record<CloakTheme, string> = {
  dark: "#131313",
  light: "#ffffff",
};

/** iOS standalone status-bar style per theme. */
export const CLOAK_STATUS_BAR_STYLES: Record<CloakTheme, string> = {
  dark: "black-translucent",
  light: "default",
};

/**
 * Points the OS chrome at `color`.
 *
 * Chrome on Android does NOT re-read a `theme-color` meta whose `content` was
 * changed in place: `setAttribute` is silently ignored and the status bar keeps
 * whatever colour it read first. The value is only picked up when the element is
 * INSERTED, so the old nodes have to go and a fresh one be appended.
 *
 * It also collapses any surviving metas into the single one that now applies,
 * which is the point. The tint has to follow the APP's theme, and the app's
 * theme is a stored preference, not `prefers-color-scheme`; tying it to the
 * media query is what let a light-mode app keep a dark status bar. The server no
 * longer emits the media-scoped pair (see layout.tsx), but a browser can still
 * be holding the old document, so the cleanup stays.
 */
export function applyThemeColor(color: string) {
  const head = document.head;
  head
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.remove());

  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", color);
  head.appendChild(meta);
}

/** Swaps the class on <html>. Exactly one theme class is present at a time. */
export function applyCloakTheme(theme: CloakTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");

  /* Keep Android/iOS browser chrome in step with the theme the user actually
     chose. Replaces the element rather than mutating it — see applyThemeColor. */
  applyThemeColor(CLOAK_THEME_COLORS[theme]);

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
 *
 * The theme-color handling deliberately mirrors applyThemeColor: it REMOVES the
 * meta Next server-rendered and appends a fresh one, because Chrome on Android
 * ignores `content` written onto an existing element. Without that, a stored
 * light theme would paint a light app under a dark status bar until the user
 * happened to toggle the theme.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t="dark";if(r){var p=JSON.parse(r);if(p&&p.state&&p.state.theme==="light")t="light";}var e=document.documentElement;e.classList.remove(t==="light"?"dark":"light");e.classList.add(t);var c=t==="light"?${JSON.stringify(
  CLOAK_THEME_COLORS.light
)}:${JSON.stringify(
  CLOAK_THEME_COLORS.dark
)};var h=document.head;var a=h.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<a.length;i++){a[i].parentNode.removeChild(a[i]);}var tc=document.createElement("meta");tc.setAttribute("name","theme-color");tc.setAttribute("content",c);h.appendChild(tc);var s=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(s)s.setAttribute("content",t==="light"?${JSON.stringify(
  CLOAK_STATUS_BAR_STYLES.light
)}:${JSON.stringify(
  CLOAK_STATUS_BAR_STYLES.dark
)});}catch(e){}})();`;
