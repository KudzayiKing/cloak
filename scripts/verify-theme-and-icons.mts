/*
 * Guards the brand icon geometry and the light theme.
 *
 * Icons: the Cloak artwork is used at very small sizes in prompt tiles and as
 * the installed PWA icon. The readable invariant is geometric centring of the
 * MARK — the artwork's own circle — which is not the same thing as centring its
 * bounding box, because a C's box is lopsided by design. These checks parse the
 * SVG geometry and measure the raster rather than trusting a diff, and they pin
 * the canvas dimensions the owner asked NOT to change.
 *
 * Theme: the light palette is the owner's, supplied verbatim. The valuable
 * invariant is completeness — every token the dark theme defines must also be
 * defined in the light theme, or a screen will silently render a dark value on
 * a light background. That is the failure this suite exists to prevent.
 *
 * Run: node_modules/.bin/tsx scripts/verify-theme-and-icons.mts
 */

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  checks.push({
    label,
    pass: actual === expected,
    detail: `got ${String(actual)}, want ${String(expected)}`,
  });
}

/* Centring is a measurement, so it needs a tolerance — but a tight one. The
   bug this guards against displaced the mark by 4.35% of the artwork (41px on
   the 943 canvas, ~7px on a 192 icon), orders of magnitude above this. */
function checkClose(label: string, actual: number, expected: number, tol: number) {
  checks.push({
    label,
    pass: Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    detail: `got ${actual.toFixed(2)}, want ${expected.toFixed(2)} ±${tol}`,
  });
}

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every .tsx under `dir`, so a source scan can cover the whole tree. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
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

/*
 * The <use> offset that puts the MARK — not the image rectangle — at the centre
 * of the canvas.
 *
 * The mark is a ring whose opening faces right, so its alpha bounding box is
 * NOT symmetric: the left edge is the ring, but the right edge is the tip of an
 * arm that stops well short of the ring's rightmost point. Centring that box
 * reads as correct in the numbers and wrong on screen, which is precisely the
 * "the C is not centred" bug: at the old x=110 the image rectangle was centred
 * while the mark sat 41/943 (4.35%) to the right of it.
 *
 * The eye centres the mark's own circle, and that circle is tangent to the top,
 * bottom and left of the artwork at x=402.5 / y=402.5 (radius 402.5). So the
 * offset is 943/2 - 402.5 = 69 on both axes.
 */
const GEOMETRIC_CENTRE_OFFSET = { x: 69, y: 69 };

type Point = [number, number];
type Circle = { x: number; y: number; r: number };

function circleFromTwo(a: Point, b: Point): Circle {
  return {
    x: (a[0] + b[0]) / 2,
    y: (a[1] + b[1]) / 2,
    r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2,
  };
}

function circleFromThree(a: Point, b: Point, c: Point): Circle {
  const d =
    2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) {
    /* Collinear: the widest of the three pairwise circles is the enclosing one. */
    return [circleFromTwo(a, b), circleFromTwo(a, c), circleFromTwo(b, c)].reduce(
      (best, cand) => (cand.r > best.r ? cand : best)
    );
  }
  const sa = a[0] ** 2 + a[1] ** 2;
  const sb = b[0] ** 2 + b[1] ** 2;
  const sc = c[0] ** 2 + c[1] ** 2;
  const ux = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
  const uy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
  return { x: ux, y: uy, r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/**
 * Minimal enclosing circle (Welzl). For this artwork that circle IS the mark's
 * outer ring, so its centre is the point the eye reads as "the middle of the C".
 *
 * The order is fixed by a small LCG rather than Math.random: Welzl needs a
 * shuffled input for its expected linear bound, but a verifier has to give the
 * same answer every run.
 */
function minimalEnclosingCircle(input: Point[]): Circle {
  const pts = input.slice();
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = pts[i];
    pts[i] = pts[j];
    pts[j] = t;
  }

  const inside = (c: Circle, p: Point) =>
    Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r + 1e-9;

  const welzl = (count: number, boundary: Point[]): Circle => {
    if (count === 0 || boundary.length === 3) {
      if (boundary.length === 0) return { x: 0, y: 0, r: -1 };
      if (boundary.length === 1) return { x: boundary[0][0], y: boundary[0][1], r: 0 };
      if (boundary.length === 2) return circleFromTwo(boundary[0], boundary[1]);
      return circleFromThree(boundary[0], boundary[1], boundary[2]);
    }
    const p = pts[count - 1];
    const c = welzl(count - 1, boundary);
    if (inside(c, p)) return c;
    return welzl(count - 1, [...boundary, p]);
  };

  return welzl(pts.length, []);
}

/**
 * The mark's visible ink, as boundary points only. The convex hull of a mask is
 * the hull of its boundary, so this pins the mark's circle while keeping the
 * point count in the thousands instead of the hundreds of thousands.
 *
 * `ox`/`oy` place the raster inside a larger canvas (the SVG's own frame).
 */
function inkBoundaryPoints(png: PNG, ox = 0, oy = 0): Point[] {
  const bg = [png.data[0], png.data[1], png.data[2], png.data[3]];
  const transparentBg = bg[3] < 250;
  const visible = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
    const i = (png.width * y + x) * 4;
    const a = png.data[i + 3];
    if (transparentBg) return a > 128;
    return (
      Math.abs(png.data[i] - bg[0]) +
        Math.abs(png.data[i + 1] - bg[1]) +
        Math.abs(png.data[i + 2] - bg[2]) +
        Math.abs(a - bg[3]) >
      24
    );
  };

  const pts: Point[] = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!visible(x, y)) continue;
      if (
        !visible(x - 1, y) ||
        !visible(x + 1, y) ||
        !visible(x, y - 1) ||
        !visible(x, y + 1)
      ) {
        pts.push([x + ox, y + oy]);
      }
    }
  }
  return pts;
}

const iconFiles = [
  "public/icons/icon.svg",
  "public/cloak-logo.svg",
];

const pngIconFiles: Array<[string, number]> = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/icon-maskable-512.png", 512],
  ["public/icons/apple-touch-icon.png", 180],
];

/** The raster the SVG wraps, decoded straight out of the data: URI. */
const pngCache = new Map<string, PNG>();
function embeddedPng(svg: string): PNG {
  const b64 = svg.match(/base64,([A-Za-z0-9+/=]+)/)?.[1];
  if (!b64) throw new Error("no embedded base64 image");
  let png = pngCache.get(b64);
  if (!png) {
    png = PNG.sync.read(Buffer.from(b64, "base64"));
    pngCache.set(b64, png);
  }
  return png;
}

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
  check(
    `${file}: use offset pins the geometric centre`,
    `${g.x},${g.y}`,
    `${GEOMETRIC_CENTRE_OFFSET.x},${GEOMETRIC_CENTRE_OFFSET.y}`
  );

  /* Pinning the offset is not enough on its own — it is only correct while the
     artwork stays where we measured it. So place the raster at the offset and
     require the mark's own circle to land on the canvas centre. */
  const mark = minimalEnclosingCircle(
    inkBoundaryPoints(embeddedPng(svg), g.x, g.y)
  );
  checkClose(`${file}: mark circle is centred horizontally`, mark.x, g.vbW / 2, 0.5);
  checkClose(`${file}: mark circle is centred vertically`, mark.y, g.vbH / 2, 0.5);
}

/* The tracked SVG copies must agree, or the app logo and the manifest icon drift. */
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

/* The generator must keep centring the MARK: a future regeneration must not
   quietly go back to centring the alpha bounding box. */
{
  let gen: string | null = null;
  try {
    gen = read("scripts/generate-icons-from-logo.py");
  } catch {
    /* Fall through to a FAIL rather than throwing: a missing generator means
       the committed icons have no reproducible source, which is a real defect,
       but it should read as a failed check and not a stack trace. */
  }
  check("the icon generator is present and tracked", gen !== null, true);
  if (gen) {
    check("the raster generator measures the mark's own circle", /def mark_circle/.test(gen), true);
    check(
      "  ... and every raster goes through paste_center",
      (gen.match(/paste_center\(/g) ?? []).length >= 2,
      true
    );
    check(
      "  ... and it refuses to write icons when the mark is off-centre",
      /refusing to write icons/.test(gen),
      true
    );
    check(
      "  ... and it reads the offset from the SVG rather than assuming one",
      /<use\[\^>\]\*\\bx="/.test(gen),
      true
    );
  }
}

/* Canvas sizes the owner asked not to change (read straight from IHDR). */
{
  for (const [file, size] of pngIconFiles) {
    const buf = readFileSync(join(root, file));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    check(`${file} is still ${size}x${size}`, `${w}x${h}`, `${size}x${size}`);
  }
}

/*
 * The installed icon is the one the user actually stares at on the home screen,
 * so the same invariant is measured on the raster the generator wrote.
 *
 * This used to compare the visible bounding box against the canvas centre. That
 * check passed on every broken icon ever shipped here, because the box of a C
 * is the full frame whether or not the mark inside it is off-centre — a check
 * that cannot fail is worse than no check.
 */
{
  for (const [file, size] of pngIconFiles) {
    const png = PNG.sync.read(readFileSync(join(root, file)));
    const mark = minimalEnclosingCircle(inkBoundaryPoints(png));
    checkClose(`${file}: mark circle is centred horizontally`, mark.x, (size - 1) / 2, 0.5);
    checkClose(`${file}: mark circle is centred vertically`, mark.y, (size - 1) / 2, 0.5);
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

/*
 * The OS status-bar tint must be the header's surface.
 *
 * The mobile header is `bg-cloak-bg-elevated` and paints the status-bar inset
 * itself, so a tint taken from --cloak-bg leaves a seam across the top of an
 * installed app. Tying the tint to the token (rather than to a literal) means
 * changing the header's surface can never silently desync the OS chrome.
 */
{
  const { CLOAK_THEME_COLORS } = await import("../src/lib/cloak/theme.ts");
  const darkElevated = css.match(/--cloak-bg-elevated:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "";
  const lightBlock = css.match(/\.light\s*\{([^}]*)\}/)?.[1] ?? "";
  const lightElevated = lightBlock.match(/--cloak-bg-elevated:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "";

  check("the dark elevated surface was found", darkElevated.length, 7);
  check(
    "the dark status-bar tint is the header's surface",
    CLOAK_THEME_COLORS.dark.toLowerCase(),
    darkElevated.toLowerCase()
  );
  check(
    "the light status-bar tint is the header's surface",
    CLOAK_THEME_COLORS.light.toLowerCase(),
    lightElevated.toLowerCase()
  );

  const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
    id?: string;
    start_url?: string;
    theme_color?: string;
    background_color?: string;
  };
  check(
    "the manifest tints the status bar with the header's surface",
    (manifest.theme_color ?? "").toLowerCase(),
    darkElevated.toLowerCase()
  );
  /*
   * `background_color` is not only the splash. In an installed Android app the
   * manifest drives the native system bars, and the navigation bar is the one
   * the web layer cannot paint for itself: the app's viewport stops above it,
   * so whatever Android picks there is what the user sees under the bottom nav.
   * Leaving `background_color` on --cloak-bg was the last colour signal still
   * disagreeing with the chrome. Every manifest colour now names the same
   * surface — a splash 2/255 off the app background is invisible, a system bar
   * 4/255 off the nav is not.
   */
  check(
    "  ... and the manifest's other colour, which Android may use for the navigation bar",
    (manifest.background_color ?? "").toLowerCase(),
    darkElevated.toLowerCase()
  );

  /*
   * Launching from the home screen must land in the chat app, not on the
   * marketing homepage. `id` stays "/" on purpose: it is the install's
   * identity, so moving it would strand every existing install as a second,
   * separate app instead of updating the one the user already has.
   */
  check(
    "the installed app opens the chat app, not the marketing homepage",
    manifest.start_url ?? "",
    "/#/app/messages"
  );
  check("  ... and the install's identity is left alone", manifest.id ?? "", "/");

  const appRouter = stripComments(read("src/components/cloak/router/cloak-app.tsx"));
  check(
    "  ... with a cold-launch fallback for installs that predate the change",
    /useInstalledEntryRedirect/.test(appRouter) &&
      /display-mode: \$\{mode\}/.test(appRouter),
    true
  );
  check(
    "  ... which fires once, so the marketing pages stay reachable",
    /if \(entryResolved\) return;\s*\n\s*entryResolved = true;/.test(appRouter),
    true
  );
}

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

  /* Centring must live in the asset, never in a nudge. A translate here, or a
     clipped oversized image there, means someone is compensating for an
     off-centre asset again instead of fixing the asset — which is exactly how
     the prompt badge ended up "centred" and visibly not. */
  const badge = stripComments(
    read("src/components/cloak/pwa/pwa-prompt-logo-badge.tsx")
  );
  check("the prompt badge renders the shared logo image", /CloakLogoImage/.test(badge), true);
  check(
    "  ... and does not fake centring with a clipped oversized image",
    /overflow-hidden/.test(badge),
    false
  );

  const splash = stripComments(read("src/components/cloak/brand/splash-screen.tsx"));
  check("the splash logo needs no translate nudge", /translate-x/.test(splash), false);

  /*
   * The splash is a lockup, not two headlines: the logo is the hero and the
   * wordmark sits under it as a caption. At text-3xl the wordmark ran about
   * 1.8x the logo's width and read as a competing headline.
   */
  const splashWordmark =
    splash.match(/cloak-wordmark[^"]*?\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/)?.[1] ?? "";
  check("the splash wordmark is a caption, not a second headline", splashWordmark, "xl");

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
  /*
   * Safe areas are painted by the chrome they belong to, not by a strip of
   * their own.
   *
   * The status bar is the header's glass and the gesture bar is the nav's, so
   * each inset spacer has to live INSIDE its panel. A spacer that carries its
   * own background is the bug this guards: a separate solid strip painted
   * --cloak-bg under a nav that composites to ~#0f0f10 (and over a header that
   * is translucent), leaving a visible seam at the bottom and a status bar that
   * did not match the header at all.
   */
  /* A safe-area spacer must be painted BY its chrome, never by a background of
     its own. "Spacer appears somewhere after the panel" is not enough — the old
     strip satisfied that and still painted a solid band, so the assertions are:
     the spacer lives between the chrome's own tags, and its className carries no
     `bg-*` at all. */
  const spacerClasses = (needle: string): string[] =>
    [...shell.matchAll(/className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((c) => c.includes(needle));

  /** The source from an opening tag to its first matching close tag. */
  const elementBlock = (open: RegExp, close: string): string => {
    const m = shell.match(open);
    if (!m || m.index === undefined) return "";
    const end = shell.indexOf(close, m.index);
    return end === -1 ? "" : shell.slice(m.index, end + close.length);
  };

  const statusSpacers = spacerClasses("h-[env(safe-area-inset-top)]");
  const gestureSpacers = spacerClasses("h-[env(safe-area-inset-bottom)]");
  const headerBlock = elementBlock(/<header\b/, "</header>");

  /* The mobile nav is identified by its aria-label, not by tag order: the
     desktop sidebar is also a <nav> and comes first in the file. */
  const navStart = shell.indexOf('aria-label="Primary"');
  const navEnd = navStart === -1 ? -1 : shell.indexOf("</nav>", navStart);
  const navBlock = navStart === -1 || navEnd === -1 ? "" : shell.slice(navStart, navEnd);

  const headerOpen = shell.match(/<header className="([^"]*)"/)?.[1] ?? "";
  check("the mobile header is itself the glass panel", /bg-cloak-bg-elevated/.test(headerOpen) && /backdrop-blur-xl/.test(headerOpen), true);
  check(
    "  ... so the status-bar inset sits inside it",
    headerBlock.includes("h-[env(safe-area-inset-top)]"),
    true
  );
  check(
    "  ... and the status-bar inset paints no background of its own",
    statusSpacers.length > 0 && statusSpacers.every((c) => !/\bbg-/.test(c)),
    true
  );

  const navGlass = navBlock.match(/className="([^"]*backdrop-blur-xl[^"]*)"/)?.[1] ?? "";
  check("the mobile nav tab row is a glass panel", /bg-cloak-bg-elevated/.test(navGlass), true);
  check(
    "  ... and the gesture-bar inset sits inside that same panel",
    navBlock.includes("h-[env(safe-area-inset-bottom)]") &&
      navBlock.indexOf("backdrop-blur-xl") < navBlock.indexOf("h-[env(safe-area-inset-bottom)]"),
    true
  );
  check(
    "  ... and the gesture-bar inset paints no background of its own",
    gestureSpacers.length > 0 && gestureSpacers.every((c) => !/\bbg-/.test(c)),
    true
  );

  /*
   * The bottom bar's opaque backing decides its colour. The panel is
   * translucent, so it composites over whatever the backing paints: a
   * --cloak-bg backing resolves to #0f0f11 while the header — which has no
   * backing and sits over the page — resolves to #111113. That 2/255 gap is
   * the "the two chromes don't match" report. Backing it with the elevated
   * surface makes the bottom bar the header's colour by construction.
   */
  const navOpen = navBlock.match(/className="([^"]*)"/)?.[1] ?? "";
  check(
    "the bottom bar's opaque backing is the header's surface",
    /bg-cloak-bg-elevated/.test(navOpen) && !/(^|\s)bg-cloak-bg(\s|$)/.test(navOpen),
    true
  );

  /* Clearance must read the shared token: a hardcoded 56px sits under the
     header on any device that reports a status-bar inset. */
  check(
    "the header's clearance height is a shared token",
    /--cloak-top-chrome-h:\s*calc\(3\.5rem \+ env\(safe-area-inset-top\)\)/.test(css),
    true
  );
  {
    const offenders = tsxFiles(root).filter((f) =>
      /pt-14[^"]*md:pt-0/.test(readFileSync(f, "utf8"))
    );
    check("no page hardcodes the old 56px header clearance", offenders.length, 0);
    if (offenders.length) {
      console.log(
        "  hardcoded pt-14:",
        offenders.map((f) => f.slice(root.length + 1)).join(", ")
      );
    }
  }

  const marketingHeader = stripComments(read("src/components/cloak/navigation/MarketingHeader.tsx"));
  check("marketing header reads the shared theme", /useCloakStore\(\(s\)\s*=>\s*s\.theme\)/.test(marketingHeader), true);
  check("marketing header can change the shared theme", /useCloakStore\(\(s\)\s*=>\s*s\.setTheme\)/.test(marketingHeader), true);
  check("marketing header includes a desktop theme toggle", /aria-label=\{themeLabel\}/.test(marketingHeader), true);
  check("marketing header includes a mobile theme toggle", /Light theme[\s\S]{0,80}Dark theme/.test(marketingHeader), true);

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

  const productMockup = stripComments(read("src/components/cloak/marketing/product-mockup.tsx"));
  check(
    "homepage mock outgoing bubble uses theme token class",
    /side === "out"[\s\S]{0,160}cloak-bubble-out/.test(productMockup),
    true
  );
  check(
    "homepage mock does not hardcode the dark outgoing bubble",
    /bg-\[#1D1A12\]|bg-\[#1d1a12\]/.test(productMockup),
    false
  );
}

/* -------------------------------- report --------------------------------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} theme & icon checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
