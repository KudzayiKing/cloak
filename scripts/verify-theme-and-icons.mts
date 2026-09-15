/*
 * Guards the brand icon geometry and the light theme.
 *
 * Icons: the Cloak artwork (723x806) is asymmetric — the thick arc of the C
 * sits to the upper-left, and the speech-bubble notch extends the silhouette
 * down-left. Bbox-centring the PNG inside the 943x943 viewBox (x=110, y=68.5)
 * leaves the mark visibly 42.5px to the upper-left on the home screen. The
 * <use> offset therefore has to put the visual centroid on the canvas
 * centre: x=147, y=76. These checks parse the SVG geometry rather than
 * trusting a diff, and they pin the canvas dimensions the owner asked NOT
 * to change.
 *
 * Theme: the light palette is the owner's, supplied verbatim. The valuable
 * invariant is completeness — every token the dark theme defines must also be
 * defined in the light theme, or a screen will silently render a dark value on
 * a light background. That is the failure this suite exists to prevent.
 *
 * Run: node_modules/.bin/tsx scripts/verify-theme-and-icons.mts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  checks.push({
    label,
    pass: actual === expected,
    detail: `got ${String(actual)}, want ${String(expected)}`,
  });
}

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/* ============================ 1. icon geometry ============================ */

/** Parses the viewBox, the embedded <image> box and the <use> offset. */
function iconGeometry(svg: string) {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const image = svg.match(/<image\s+width="([\d.]+)"\s+height="([\d.]+)"/);
  const use = svg.match(/<use[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"/);
  if (!viewBox || !image || !use) return null;
  const [vbW, vbH] = [Number(viewBox[1]), Number(viewBox[2])];
  const [imgW, imgH] = [Number(image[1]), Number(image[2])];
  const [x, y] = [Number(use[1]), Number(use[2])];
  return {
    vbW,
    vbH,
    imgW,
    imgH,
    x,
    y,
    left: x,
    right: vbW - (x + imgW),
    top: y,
    bottom: vbH - (y + imgH),
  };
}

/**
 * Visual-centre offset for the artwork. The C mark is asymmetric (the
 * "thick" part of the C sits to the upper-left, and the speech-bubble notch
 * extends the silhouette down-left), so its centroid is offset from the
 * artwork's bbox centre by about (-36.9, -7.3) px. To make the mark LOOK
 * centred on the home screen, the <use> offset has to compensate.
 *
 * This number is computed from the embedded PNG once (see note above the
 * 1. geometry block) and pinned here so the SVG can't drift back to
 * bbox-centred, which leaves the mark visibly upper-left in the dock.
 */
const VISUAL_CENTRE_OFFSET = { x: 147, y: 76 };

const iconFiles = [
  "public/icons/icon.svg",
  "public/cloak-logo.svg",
  "upload/cloak_logo.svg",
];

for (const file of iconFiles) {
  let svg: string;
  try {
    svg = read(file);
  } catch {
    continue; // upload/ is gitignored and may be absent
  }
  const g = iconGeometry(svg);
  check(`${file}: geometry parsed`, Boolean(g), true);
  if (!g) continue;

  check(`${file}: canvas is still 943x943`, `${g.vbW}x${g.vbH}`, "943x943");
  check(`${file}: artwork is still 723x806`, `${g.imgW}x${g.imgH}`, "723x806");
  /* The artwork is asymmetric (a C with the bubble notch down-left), so the
     <use> offset has to put the VISUAL centre — the white-pixel centroid —
     on the SVG centre, not the bbox centre. The pinned value was derived
     from the embedded PNG once and is stable across regenerations of the
     raster artwork. */
  check(
    `${file}: use offset pins the visual centre`,
    `${g.x},${g.y}`,
    `${VISUAL_CENTRE_OFFSET.x},${VISUAL_CENTRE_OFFSET.y}`
  );
}

/* The three copies must agree, or the app logo and the home-screen icon drift. */
{
  const geometries = iconFiles
    .map((f) => {
      try {
        return { f, g: iconGeometry(read(f)) };
      } catch {
        return { f, g: null };
      }
    })
    .filter((e) => e.g);

  const first = geometries[0];
  for (const { f, g } of geometries) {
    check(`${f}: same offset as ${first.f}`, `${g!.x},${g!.y}`, `${first.g!.x},${first.g!.y}`);
  }
}

/* The generator must keep centring: a future regeneration should not undo this. */
{
  const gen = read("scripts/generate-icons-from-logo.py");
  check("the raster generator centres via paste_center", /def paste_center/.test(gen), true);
  check(
    "  ... and every raster goes through it",
    (gen.match(/paste_center\(/g) ?? []).length >= 2,
    true
  );
}

/* Canvas sizes the owner asked not to change (read straight from IHDR). */
{
  const expected: Array<[string, number]> = [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/icon-maskable-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
  ];
  for (const [file, size] of expected) {
    const buf = readFileSync(join(root, file));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    check(`${file} is still ${size}x${size}`, `${w}x${h}`, `${size}x${size}`);
  }
}

/* ============================== 2. the theme ============================== */

const css = stripComments(read("src/app/globals.css"));

/** Variable names declared in a block whose selector matches `selector`. */
function varsIn(selector: string): string[] {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
  if (!block) return [];
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

const darkVars = varsIn(":root");
const lightVars = varsIn("\\.light");

check("the dark :root block was found", darkVars.length > 20, true);
check("the light .light block was found", lightVars.length > 20, true);

/* THE key invariant: a token defined for dark but not for light renders a dark
   value on a light background — invisible text, wrong borders, etc. */
{
  const missing = darkVars.filter((v) => v !== "--radius" && !lightVars.includes(v));
  check("every dark token is also defined for light", missing.length, 0);
  if (missing.length) console.log("  missing from .light:", missing.join(", "));
}

/* Light mode keeps every background surface white and the text neutral/readable. */
{
  const light = css.match(/\.light\s*\{([^}]*)\}/)?.[1] ?? "";
  const required: Array<[string, string]> = [
    ["--cloak-bg", "#ffffff"],
    ["--cloak-bg-elevated", "#ffffff"],
    ["--cloak-surface", "#ffffff"],
    ["--cloak-surface-hover", "#ffffff"],
    ["--cloak-border", "rgba(17, 24, 39, 0.12)"],
    ["--cloak-border-strong", "rgba(17, 24, 39, 0.18)"],
    ["--cloak-text", "#111827"],
    ["--cloak-text-secondary", "#4b5563"],
    ["--cloak-text-muted", "#6b7280"],
    ["--cloak-message-outgoing", "rgba(185, 147, 67, 0.2)"],
    ["--cloak-message-outgoing-border", "rgba(185, 147, 67, 0.24)"],
    ["--cloak-gold", "#b99343"],
    ["--cloak-gold-bright", "#cdaa59"],
    ["--cloak-gold-soft", "rgba(185, 147, 67, 0.12)"],
    ["--cloak-danger", "#a85353"],
    ["--cloak-success", "#527a63"],
    ["--cloak-warning", "#a17e3c"],
  ];
  for (const [name, value] of required) {
    check(`${name} is the light theme value`, new RegExp(`${name}:\\s*${value.replace(/[().]/g, "\\$&")}\\s*;`).test(light), true);
  }
}

check("light tells the browser to use light form controls", /\.light\s*\{[^}]*color-scheme:\s*light/.test(css), true);
check(
  "the dark root still declares color-scheme: dark",
  /color-scheme:\s*dark/.test(css),
  true
);
check("the scrollbar thumb follows the theme", /var\(--cloak-scroll-thumb\)/.test(css), true);
check("selection colours follow the theme", /var\(--cloak-selection\)/.test(css), true);

/* The logo must be black in light mode. */
check(
  "the logo mark is forced black in light mode",
  /\.light\s+\.cloak-logo-mark\s*\{[^}]*filter:\s*brightness\(0\)/.test(css),
  true
);

{
  const logo = stripComments(read("src/components/cloak/brand/CloakLogo.tsx"));
  check("CloakLogoImage carries the logo-mark class", /cloak-logo-mark/.test(logo), true);

  const signIn = stripComments(read("src/components/cloak/auth/sign-in-screen.tsx"));
  check(
    "the sign-in screen's raw <img> carries it too",
    /cloak-logo-mark/.test(signIn),
    true
  );

  const cta = css.match(/\.light\s+\.cloak-cta-gold\s*\{([^}]*)\}/)?.[1] ?? "";
  check("the gold CTA has a light-mode ramp", /#b99343/.test(cta), true);
}

/* ======================= 3. the theme module behaviour ==================== */

{
  /* Minimal DOM: just enough for applyCloakTheme and the bootstrap script.
     Both add/remove and toggle are needed — the script uses add/remove, and a
     stub missing them silently swallows into the script's own try/catch. */
  const classes = new Set<string>(["dark"]);
  const classList = {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
    toggle: (name: string, on: boolean) => {
      if (on) classes.add(name);
      else classes.delete(name);
    },
  };
  const meta = { content: "#0b0b0c", setAttribute: (_: string, v: string) => { meta.content = v; } };
  defineGlobal("document", {
    documentElement: { classList },
    querySelector: (sel: string) => (sel.includes("theme-color") ? meta : null),
  });

  const {
    DEFAULT_CLOAK_THEME,
    CLOAK_THEME_COLORS,
    applyCloakTheme,
    isCloakTheme,
    readStoredTheme,
    THEME_BOOTSTRAP_SCRIPT,
    THEME_STORAGE_KEY,
  } = await import("../src/lib/cloak/theme.ts");

  check("dark is the default theme", DEFAULT_CLOAK_THEME, "dark");

  applyCloakTheme("light");
  check("light adds .light", classes.has("light"), true);
  check("light removes .dark", classes.has("dark"), false);
  check("light updates the status-bar colour", meta.content, CLOAK_THEME_COLORS.light);

  applyCloakTheme("dark");
  check("dark adds .dark", classes.has("dark"), true);
  check("dark removes .light", classes.has("light"), false);
  check("dark updates the status-bar colour", meta.content, CLOAK_THEME_COLORS.dark);

  check("isCloakTheme accepts light", isCloakTheme("light"), true);
  check("isCloakTheme rejects nonsense", isCloakTheme("sepia"), false);

  /* A corrupt storage entry must not break first paint. */
  check(
    "readStoredTheme reads a persisted light choice",
    readStoredTheme('{"state":{"theme":"light"},"version":2}'),
    "light"
  );
  check(
    "readStoredTheme reads a persisted dark choice",
    readStoredTheme('{"state":{"theme":"dark"},"version":2}'),
    "dark"
  );
  check("readStoredTheme defaults on null", readStoredTheme(null), "dark");
  check("readStoredTheme survives malformed JSON", readStoredTheme("{not json"), "dark");
  check(
    "readStoredTheme survives a bogus value",
    readStoredTheme('{"state":{"theme":"sepia"}}'),
    "dark"
  );
  check(
    "readStoredTheme survives a missing field",
    readStoredTheme('{"state":{}}'),
    "dark"
  );

  /* The inline script is a string in the bundle — run it for real. */
  {
    const store: Record<string, string> = {
      [THEME_STORAGE_KEY]: '{"state":{"theme":"light"},"version":2}',
    };
    defineGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
    });
    classes.clear();
    classes.add("dark");
    meta.content = "#0b0b0c";

    new Function(THEME_BOOTSTRAP_SCRIPT)();
    check("the bootstrap script applies light before paint", classes.has("light"), true);
    check("  ... and drops dark", classes.has("dark"), false);
    check("  ... and fixes the status bar", meta.content, CLOAK_THEME_COLORS.light);

    /* And it must do nothing when the choice is dark. */
    store[THEME_STORAGE_KEY] = '{"state":{"theme":"dark"},"version":2}';
    classes.clear();
    classes.add("dark");
    new Function(THEME_BOOTSTRAP_SCRIPT)();
    check("the bootstrap script leaves dark alone", classes.has("dark"), true);
    check("  ... and does not add light", classes.has("light"), false);

    /* And it must never throw, whatever storage holds. */
    store[THEME_STORAGE_KEY] = "{{{";
    let threw = false;
    try {
      new Function(THEME_BOOTSTRAP_SCRIPT)();
    } catch {
      threw = true;
    }
    check("the bootstrap script never throws on corrupt storage", threw, false);
  }
}

/* ========================= 4. wiring source scans ========================= */

{
  const layout = stripComments(read("src/app/layout.tsx"));
  check("the layout inlines the bootstrap script", /THEME_BOOTSTRAP_SCRIPT/.test(layout), true);
  check("the layout mounts ThemeSync", /<ThemeSync \/>/.test(layout), true);
  /* The layout must NOT hardcode a theme class on <html>: the inline bootstrap
     script applies the stored choice before paint and ThemeSync re-applies it on
     mount. A hardcoded class would let a layout re-render wipe an imperatively
     added `.light`. */
  check(
    "the layout does not hardcode a theme class (bootstrap/ThemeSync own it)",
    !/className="(dark|light)"/.test(layout),
    true
  );

  const store = stripComments(read("src/stores/cloak-store.ts"));
  check("the store declares a theme field", /theme:\s*CloakTheme/.test(store), true);
  check("the store defaults to the default theme", /theme:\s*DEFAULT_CLOAK_THEME/.test(store), true);
  check("the store exposes setTheme", /setTheme:\s*\(theme\)\s*=>/.test(store), true);
  check("theme is persisted", /partialize[\s\S]{0,400}?theme:\s*s\.theme/.test(store), true);

  const sync = stripComments(read("src/components/cloak/theme/theme-sync.tsx"));
  check("ThemeSync subscribes rather than reading on mount", /useCloakStore\.subscribe/.test(sync), true);

  const shell = stripComments(read("src/components/cloak/navigation/app-shell.tsx"));
  check("desktop sidebar nav has a shared hover animation item", /function DesktopNavItem/.test(shell), true);
  check(
    "desktop sidebar nav triggers icons from the full button hover",
    /onMouseEnter=\{onMouseEnter\}[\s\S]{0,120}onMouseLeave=\{onMouseLeave\}/.test(shell),
    true
  );
  check(
    "mobile chrome paints the status-bar safe area",
    /h-\[env\(safe-area-inset-top\)\][^"]*bg-cloak-bg-elevated/.test(shell),
    true
  );
  check(
    "mobile chrome paints the gesture-bar safe area",
    /h-\[env\(safe-area-inset-bottom\)\][^"]*bg-cloak-bg/.test(shell),
    true
  );
  check(
    "mobile bottom nav wrapper also carries the gesture-bar theme background",
    /className="[^"]*fixed inset-x-0 bottom-0[^"]*bg-cloak-bg/.test(shell),
    true
  );

  const settings = stripComments(read("src/components/cloak/settings/settings-page.tsx"));
  check("Settings exposes a theme choice", /setTheme\(choice\.id\)/.test(settings), true);
  check("Settings previews the white light theme", /bg:\s*"#ffffff"/.test(settings), true);
  check(
    "the old 'coming after security review' placeholder is gone",
    /Coming after security review/.test(settings),
    false
  );

  const ghost = stripComments(read("src/components/cloak/shared/ghost-icon.tsx"));
  check("GhostGlyph supports explicit colour overrides", /color = "#ffffff"/.test(ghost), true);

  const chatDialogs = stripComments(read("src/components/cloak/messaging/chat-dialogs.tsx"));
  check(
    "add-chat ghost icons inherit theme text colour",
    /<GhostGlyph[^>]*color="currentColor"[^>]*text-cloak-text/.test(chatDialogs),
    true
  );
}

/* -------------------------------- report --------------------------------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} theme & icon checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
