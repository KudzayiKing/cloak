/*
 * Unit tests for the pull-to-refresh gesture rules.
 *
 * These exist because the original implementation judged "am I at the top?"
 * against `window.scrollY` — which is ALWAYS 0 in Cloak, since the app shell
 * pins the viewport and scrolls an inner <main>. The gesture therefore fired
 * while the user was mid-list, and bailing out on buttons meant it almost
 * never started at all. Both behaviours are pinned here.
 *
 * Run: node_modules/.bin/tsx scripts/verify-pull-to-refresh.mts
 */

/* ---------- minimal DOM stubs ---------- */

class FakeElement {
  scrollTop = 0;
  parentElement: FakeElement | null = null;
  private readonly classes: string[];

  constructor(classes: string[] = []) {
    this.classes = classes;
  }

  /** Stands in for `closest()` against the ignored-target selector. */
  closest(selector: string): FakeElement | null {
    const wanted = selector.split(",").map((s) => s.trim());
    if (this.classes.some((c) => wanted.includes(c))) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

/** Node 22 defines `navigator` as a getter-only global — redefine, don't assign. */
function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

(globalThis as unknown as { Element: unknown }).Element = FakeElement;
defineGlobal("window", {
  scrollY: 0,
  matchMedia: () => ({ matches: false }),
  setTimeout: () => 0,
  clearTimeout: () => undefined,
});
defineGlobal("navigator", { maxTouchPoints: 0 });
defineGlobal("document", { scrollingElement: { scrollTop: 0 } });

const {
  PULL_START_PX,
  TRIGGER_PX,
  MAX_PULL_PX,
  isAtTop,
  isExcludedTarget,
  pullForDelta,
  shouldRefreshAt,
  supportsPull,
} = await import("../src/components/cloak/pwa/pull-to-refresh-gesture.ts");

/* ---------- helpers ---------- */

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  checks.push({ label, pass, detail: `got ${String(actual)}, want ${String(expected)}` });
}

/** Builds document > main > list > row, the real Cloak mobile structure. */
function buildTree() {
  const doc = { scrollTop: 0 };
  defineGlobal("document", { scrollingElement: doc });
  const main = new FakeElement(["main"]);
  const list = new FakeElement(["list"]);
  const row = new FakeElement(["button"]);
  list.parentElement = main;
  row.parentElement = list;
  return { doc, main, list, row };
}

function setWindowScrollY(value: number) {
  defineGlobal("window", {
    scrollY: value,
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
}

/* ---------- 1. the regression: window.scrollY is never the scroller ---------- */

{
  const { main, list, row } = buildTree();
  setWindowScrollY(0);
  check("pull from the top of an unscrolled list", isAtTop(row), true);

  list.scrollTop = 120;
  check("NO pull while the list is scrolled (window.scrollY is still 0)", isAtTop(row), false);
  list.scrollTop = 0;

  main.scrollTop = 40;
  check("NO pull while an ancestor scroller is scrolled", isAtTop(row), false);
  main.scrollTop = 0;

  const { doc, row: row2 } = buildTree();
  doc.scrollTop = 10;
  check("NO pull while the document itself is scrolled", isAtTop(row2), false);

  const { row: row3 } = buildTree();
  setWindowScrollY(30);
  check("NO pull while the window is scrolled", isAtTop(row3), false);
  setWindowScrollY(0);

  check("NO pull for a non-element target", isAtTop(null), false);
}

/* ---------- 2. the regression: buttons must NOT be excluded ---------- */

{
  const { row } = buildTree();
  check("a chat row button may start a pull", isExcludedTarget(row), false);

  const input = new FakeElement(["input"]);
  check("a text field owns its own drag", isExcludedTarget(input), true);

  const textarea = new FakeElement(["textarea"]);
  check("a textarea owns its own drag", isExcludedTarget(textarea), true);

  const dialog = new FakeElement(["[role='dialog']"]);
  const inner = new FakeElement([]);
  inner.parentElement = dialog;
  check("an open dialog owns the drag (via ancestor)", isExcludedTarget(inner), true);

  const optOut = new FakeElement(["optout"]);
  check("a non-DOM target is not excluded", isExcludedTarget({} as unknown as EventTarget), false);
}

/* ---------- 3. resistance curve and thresholds ---------- */

{
  check("no travel before the start threshold", pullForDelta(PULL_START_PX), 0);
  check("no travel on an upward drag", pullForDelta(-40), 0);
  const mid = pullForDelta(100);
  check("travel is damped below the raw delta", mid < 100, true);
  check("travel is capped", pullForDelta(10_000), MAX_PULL_PX);
  check("release below the trigger does not refresh", shouldRefreshAt(TRIGGER_PX - 1), false);
  check("release at the trigger refreshes", shouldRefreshAt(TRIGGER_PX), true);
  /* A comfortable flick must reach the trigger without hitting the cap. */
  check("a 150px flick arms the refresh", shouldRefreshAt(pullForDelta(150)), true);
}

/* ---------- 4. device gating ---------- */

{
  defineGlobal("navigator", { maxTouchPoints: 5 });
  check("touch device enables the gesture", supportsPull(), true);

  defineGlobal("navigator", { maxTouchPoints: 0 });
  defineGlobal("window", { scrollY: 0, matchMedia: () => ({ matches: true }) });
  check("coarse pointer enables the gesture", supportsPull(), true);

  defineGlobal("window", { scrollY: 0, matchMedia: () => ({ matches: false }) });
  check("fine pointer (desktop) disables the gesture", supportsPull(), false);
}

/* ---------- report ---------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} gesture checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
