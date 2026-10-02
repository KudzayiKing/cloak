/*
 * TEMPORARY browser probe — the account deletion UI.
 *
 * What only a browser can prove: the destructive flow is actually reachable
 * and actually GATED. Source text can show that a `canSubmit` expression
 * exists; it cannot show that the button is disabled when the handle does not
 * match, or that the dialog opens at all.
 *
 * Asserts:
 *   1. the Account section renders both new controls, visible;
 *   2. the delete dialog opens and asks for the handle AND the password;
 *   3. the confirm button is DISABLED until the handle matches;
 *   4. a wrong handle keeps it disabled, the right one enables it;
 *   5. Cancel closes the dialog.
 *
 * Nothing is submitted — no account is touched.
 *
 * Run: node scripts/probe-account-ui.mjs   (with the dev server up)
 */
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/kudzayi/.workbuddy-ai/binaries/node/workspace/");
const puppeteer = require("puppeteer-core");

function chromePath() {
  const root = join(homedir(), ".cache/puppeteer/chrome");
  for (const version of readdirSync(root)) {
    for (const dir of readdirSync(join(root, version))) {
      const candidate = join(
        root,
        version,
        dir,
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      );
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("no chrome-for-testing build found");
}

const URL = "http://localhost:3000/dev-account-harness";
const results = [];
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
};

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-proxy-server", "--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));

  await page.goto(URL, { waitUntil: "networkidle0", timeout: 120_000 });

  /* Hydration must be real before any measurement means anything. */
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="harness-root"]')?.closest("body")?.children.length,
    { timeout: 60_000 }
  );

  const findButton = (text) =>
    page.evaluate((t) => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => (x.textContent ?? "").trim() === t);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent.trim(),
        visible: getComputedStyle(b).display !== "none" && r.width > 0 && r.height > 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }, text);

  /* ---------------- 1. both controls render ---------------- */

  const exportBtn = await findButton("Export my data");
  check("the export control renders and is visible", !!exportBtn && exportBtn.visible, true);

  const deleteBtn = await findButton("Delete account");
  check("the delete control renders and is visible", !!deleteBtn && deleteBtn.visible, true);

  /* The handle in the seeded account — the dialog must name it. */
  const mentionsHandle = await page.evaluate(() =>
    (document.body.textContent ?? "").includes("@harnesshandle")
  );
  check("the page shows the account handle", mentionsHandle, true);

  /* ---------------- 2. the dialog opens ---------------- */

  const clickByText = async (text) => {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => (x.textContent ?? "").trim() === t
      );
      if (!b) return false;
      b.click();
      return true;
    }, text);
    return ok;
  };

  check("the delete button is clickable", await clickByText("Delete account"), true);
  await new Promise((r) => setTimeout(r, 400));

  const dialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const inputs = [...dlg.querySelectorAll("input")];
    return {
      present: true,
      title: (dlg.querySelector("h2, [id^='radix']")?.textContent ?? "").trim() || null,
      text: (dlg.textContent ?? "").trim(),
      inputCount: inputs.length,
      passwordInputs: inputs.filter((i) => i.type === "password").length,
      placeholder: inputs[0]?.getAttribute("placeholder") ?? null,
    };
  });
  check("the confirmation dialog opens", !!dialog?.present, true);
  check("it asks for two inputs (handle + password)", dialog?.inputCount, 2);
  check("exactly one of them is a password field", dialog?.passwordInputs, 1);
  check("the handle field names the account", dialog?.placeholder, "@harnesshandle");
  check(
    "the dialog says the action cannot be undone",
    /cannot be undone|no recovery window/i.test(dialog?.text ?? ""),
    true
  );

  /* ---------------- 3. the confirm button is gated ---------------- */

  const confirmState = () =>
    page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = [...dlg.querySelectorAll("button")].find(
        (x) => (x.textContent ?? "").trim().startsWith("Delete forever")
      );
      return b ? { found: true, disabled: b.disabled } : { found: false, disabled: null };
    });

  check("the confirm button exists", (await confirmState()).found, true);
  check("it starts DISABLED", (await confirmState()).disabled, true);

  const type = async (index, value) => {
    await page.evaluate(
      (i, v) => {
        const dlg = document.querySelector('[role="dialog"]');
        const input = [...dlg.querySelectorAll("input")][i];
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        setter.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      index,
      value
    );
  };

  /* A wrong handle, WITH a password: still disabled — the gate is the handle. */
  await type(0, "someone-else");
  await type(1, "some-password");
  await new Promise((r) => setTimeout(r, 250));
  check("a WRONG handle keeps it disabled even with a password", (await confirmState()).disabled, true);

  /* The right handle, no password: still disabled — the gate is also the password. */
  await type(0, "harnesshandle");
  await type(1, "");
  await new Promise((r) => setTimeout(r, 250));
  check("the right handle with NO password is still disabled", (await confirmState()).disabled, true);

  /* The "@" form is accepted, and a password enables it. */
  await type(0, "@harnesshandle");
  await type(1, "some-password");
  await new Promise((r) => setTimeout(r, 250));
  check("the '@'-prefixed handle with a password ENABLES it", (await confirmState()).disabled, false);

  /* ---------------- 4. cancel closes ---------------- */

  check("Cancel is clickable", await clickByText("Cancel"), true);
  await new Promise((r) => setTimeout(r, 400));
  const stillOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
  check("Cancel closes the dialog", stillOpen, false);

  check("the page rendered with no runtime errors", pageErrors, []);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} account-UI probe checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
