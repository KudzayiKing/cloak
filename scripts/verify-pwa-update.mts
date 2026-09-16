/*
 * Verifies the staged-update flow: a newly deployed service worker must WAIT
 * (not self-skip), the app must show a bottom prompt instead of reloading
 * itself, and only a tap on Refresh may hand over and reload.
 *
 * This exists because the previous behaviour was the opposite of all three:
 * sw.js called self.skipWaiting() from its install handler, so a new worker
 * activated the instant it was fetched and force-reloaded every open window —
 * mid-interaction, typically right after sign-in.
 *
 * Two halves:
 *   1. behavioural — drives src/lib/cloak/pwa-update.ts with a fake registration
 *   2. source-scan — pins the invariants that live in files we cannot execute
 *      here (sw.js must not self-skip; the prompt must use the Cloak logo and
 *      must be mounted; the docking CSS and the nav-height publisher must exist)
 *
 * Run: node_modules/.bin/tsx scripts/verify-pwa-update.mts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ---------- harness ---------- */

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

/* A source assertion must not be satisfiable by a comment — sw.js explains
   "deliberately NO self.skipWaiting() here", which a naive regex would read as
   a call. Strip comments before every scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

let reloads = 0;
const timers: Array<() => void> = [];

defineGlobal("window", {
  location: {
    reload: () => {
      reloads += 1;
    },
  },
  setTimeout: (fn: () => void) => {
    timers.push(fn);
    return timers.length;
  },
  clearTimeout: () => undefined,
});

/* ---------- import under test ---------- */

const {
  APPLY_RELOAD_FALLBACK_MS,
  applyUpdate,
  dismissUpdate,
  isUpdateDismissed,
  markUpdateAvailable,
  resetUpdateState,
  subscribeUpdate,
  updatePhase,
} = await import("../src/lib/cloak/pwa-update.ts");

/* ---------- 1. publishing a staged update ---------- */

{
  check("starts idle (no prompt on a current bundle)", updatePhase(), "idle");

  let emits = 0;
  subscribeUpdate(() => {
    emits += 1;
  });

  const posted: Array<{ type?: string }> = [];
  const registration = {
    waiting: {
      postMessage: (message: { type?: string }) => {
        posted.push(message);
      },
    },
  };

  markUpdateAvailable(registration as unknown as ServiceWorkerRegistration);
  check("a waiting worker raises the prompt", updatePhase(), "available");
  check("subscribers are notified once", emits, 1);

  markUpdateAvailable(registration as unknown as ServiceWorkerRegistration);
  check("re-publishing the same update does not re-notify", emits, 1);
  check("still available after a repeated poll", updatePhase(), "available");

  /* ---------- 2. the handover ---------- */

  applyUpdate();
  check("tapping Refresh enters the applying state", updatePhase(), "applying");
  check("exactly one handover is sent", posted.length, 1);
  check("the handover is SKIP_WAITING", posted[0]?.type, "SKIP_WAITING");
  check("the page is NOT reloaded before controllerchange", reloads, 0);
  check("a fallback reload is scheduled", timers.length, 1);

  applyUpdate();
  check("a second tap sends nothing more", posted.length, 1);

  /* The fallback must fire only if controllerchange never lands. */
  timers[0]?.();
  check("the fallback reloads after the budget", reloads, 1);
  check("the fallback budget is a sane 4s", APPLY_RELOAD_FALLBACK_MS, 4000);
}

/* ---------- 3. "Later" must actually silence the prompt ---------- */

{
  resetUpdateState();
  check("reset returns to idle", updatePhase(), "idle");
  check("reset clears the dismissal", isUpdateDismissed(), false);

  let emits = 0;
  subscribeUpdate(() => {
    emits += 1;
  });

  dismissUpdate();
  check("dismissing from idle notifies nobody", emits, 0);

  const registration = {
    waiting: { postMessage: () => undefined },
  } as unknown as ServiceWorkerRegistration;

  markUpdateAvailable(registration);
  check("the prompt appears for a staged update", updatePhase(), "available");

  dismissUpdate();
  check("Later hides the prompt", updatePhase(), "idle");
  check("the dismissal is recorded", isUpdateDismissed(), true);

  /* The 60s update poll keeps finding the same waiting worker — it must not
     re-open a prompt the user already answered. */
  markUpdateAvailable(registration);
  check("the update poll does not nag after Later", updatePhase(), "idle");
  check("no notification for the suppressed update", emits, 2);
}

/* ---------- 4. no staged worker -> reload directly ---------- */

{
  resetUpdateState();
  reloads = 0;

  applyUpdate();
  check("with nothing staged the reload is immediate", reloads, 1);
  check("... and the phase is still applying", updatePhase(), "applying");
}

/* ---------- 5. source-scan: files we cannot execute here ---------- */

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

{
  const sw = stripComments(read("public/sw.js"));

  const install = sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/)?.[0] ?? "";
  check("the SW install handler was found", install.length > 0, true);
  check(
    "  ... and does NOT self-skip (a new worker must wait)",
    /self\.skipWaiting\(\)/.test(install),
    false
  );
  check(
    "the SW still handles the SKIP_WAITING handover",
    /SKIP_WAITING/.test(sw),
    true
  );
  check(
    "activate no longer force-nudges clients",
    /CLOAK_SW_UPDATED/.test(sw),
    false
  );
}

{
  const prompt = stripComments(
    read("src/components/cloak/pwa/pwa-update-prompt.tsx")
  );
  check("the prompt renders the Cloak logo", /CloakLogoImage/.test(prompt), true);
  check("  ... at an explicit size", /<CloakLogoImage size=\{\d+\}/.test(prompt), true);
  check("the prompt can apply the update", /applyUpdate/.test(prompt), true);
  check("the prompt can be dismissed", /dismissUpdate/.test(prompt), true);
  check("the prompt docks via the shared class", /cloak-update-prompt/.test(prompt), true);
  check(
    "the prompt is announced to assistive tech",
    /role="status"/.test(prompt),
    true
  );
  check(
    "the prompt does not block the app with a backdrop",
    /fixed inset-0/.test(prompt),
    false
  );

  const cloakRoot = stripComments(read("src/components/cloak/router/cloak-root.tsx"));
  check("the prompt is mounted in the app root", /<PwaUpdatePrompt \/>/.test(cloakRoot), true);

  const layout = stripComments(read("src/app/layout.tsx"));
  check("automatic Cloaq AI install is mounted", /<AutoModelInstall \/>/.test(layout), true);

  const register = stripComments(read("src/components/cloak/pwa/pwa-register.tsx"));
  check(
    "a reload happens only on a consented handover",
    /updatePhase\(\) !== "applying"/.test(register),
    true
  );
  check(
    "PwaRegister no longer listens for a worker reload nudge",
    /CLOAK_SW_UPDATED/.test(register),
    false
  );
  check(
    "an already-waiting worker is detected on load",
    /registration\.waiting && navigator\.serviceWorker\.controller/.test(register),
    true
  );
}

{
  const autoInstall = stripComments(read("src/components/cloak/pwa/auto-model-install.tsx"));
  check("auto model install runs only in standalone PWA", /display-mode:\s*standalone/.test(autoInstall), true);
  check("auto model install does not run in development", /NODE_ENV !== "production"/.test(autoInstall), true);
  check("auto model install starts when not installed", /snapshot\.state === "not-installed"[\s\S]{0,80}modelManager\.install/.test(autoInstall), true);

  const manager = stripComments(read("src/ai/models/modelManager.ts"));
  check("model manager downloads Cloaq AI with progress", /installArtifact[\s\S]{0,220}onProgress/.test(manager), true);
  check("model manager exposes Cloaq AI copy", /displayName:\s*"Cloaq AI"/.test(manager), true);
}

{
  const css = stripComments(read("src/app/globals.css"));
  check("the docking rule exists", /\.cloak-update-prompt\s*\{/.test(css), true);
  check(
    "  ... it clears the mobile bottom nav",
    /--cloak-bottom-nav-h/.test(css),
    true
  );
  check(
    "  ... it respects the device safe area",
    /env\(safe-area-inset-bottom\)/.test(css),
    true
  );
  check(
    "  ... and desktop overrides the offset",
    /@media \(min-width: 768px\)[\s\S]{0,160}\.cloak-update-prompt/.test(css),
    true
  );

  const shell = stripComments(
    read("src/components/cloak/navigation/app-shell.tsx")
  );
  check(
    "AppShell publishes the bottom nav height",
    /setProperty\("--cloak-bottom-nav-h"/.test(shell),
    true
  );
}

/* ---------- report ---------- */

for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  [${c.detail}]`}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n=== ${checks.length - failed}/${checks.length} PWA update checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
