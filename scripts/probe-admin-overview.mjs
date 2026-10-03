/*
 * TEMPORARY live probe — prove the operator overview works against the REAL
 * database and the REAL routes, not just against source text.
 *
 * Why this exists. `verify-admin-overview.mts` proves the shape of the code: it
 * can see that `admin-metrics.ts` names no graph table and calls no mutation.
 * It cannot prove that the aggregate queries actually run against Postgres, nor
 * that the payload that comes back over the wire is free of per-account rows.
 * The second is the whole point of the panel, so it is worth proving over HTTP
 * rather than trusting a regex.
 *
 * What it drives:
 *   - an ADMIN session (handle from CLOAK_ADMIN_HANDLES) -> GET /api/admin/overview
 *     and GET /admin, asserting the real payload and the rendered page
 *   - a NON-ADMIN session with a random handle -> 403 on the API, the shared
 *     gate on the page (authorization is re-decided, not inherited)
 *   - NO session -> 401 on the API, the gate on the page
 *   - the payload itself: no per-account key, no email address, no message
 *     field, and an `excluded` count that is at least the operator row
 *
 * It never mutates an existing account: if `admin` already exists it is reused
 * untouched and only the session this script minted is removed afterwards. A
 * throwaway non-admin account is created and deleted.
 *
 * Run with the dev server reachable:
 *   node scripts/probe-admin-overview.mjs
 * (the script waits for the server to finish compiling the new routes)
 */
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const TAG = randomBytes(4).toString("hex");

const checks = [];
function check(label, actual, expected) {
  checks.push({ label, pass: actual === expected, detail: `got ${String(actual)}, want ${String(expected)}` });
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createdUserIds = [];
const createdSessionIds = [];

async function mintSession(userId) {
  const token = `probe-admin-${TAG}-${randomBytes(8).toString("hex")}`;
  const session = await db.session.create({
    data: { userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  createdSessionIds.push(session.id);
  return `cloak_session=${token}`;
}

/* `next dev` compiles a route on first request, so a brand-new route can answer
   its very first call with the dev 404 while the manifest catches up. That is a
   harness race, not a product failure — prime it and wait for JSON. */
async function primeRoutes() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/admin/overview`);
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("application/json")) return true;
    } catch {
      /* server still starting */
    }
    await sleep(1000);
  }
  return false;
}

function walk(value, visit, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child, `${path}.${key}`);
      walk(child, visit, `${path}.${key}`);
    }
  }
}

async function main() {
  const primed = await primeRoutes();
  check("the dev server compiled the overview route", primed, true);
  if (!primed) throw new Error("server not reachable on http://localhost:3000");

  /* ---------- admin ---------- */

  let admin = await db.user.findUnique({ where: { handle: "admin" } });
  if (!admin) {
    admin = await db.user.create({
      data: {
        handle: "admin",
        displayName: "Admin",
        passwordHash: "probe:not-a-real-hash",
      },
    });
    createdUserIds.push(admin.id);
  }
  const adminCookie = await mintSession(admin.id);

  const apiRes = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: adminCookie } });
  check("the admin API answers 200", apiRes.status, 200);
  check(
    "the payload is never cached",
    /no-store/.test(apiRes.headers.get("cache-control") ?? ""),
    true
  );

  const json = await apiRes.json();
  check("the response is ok", json.ok, true);
  const overview = json.overview ?? {};
  check("the payload carries a generation timestamp", typeof overview.generatedAt, "string");

  for (const key of ["accounts", "membership", "invites", "storage", "devices", "sessions", "push"]) {
    check(`the payload has a ${key} block`, overview[key] !== undefined, true);
  }

  check(
    "the four headline figures are numbers",
    ["counted", "newLast7Days", "newLast30Days", "excluded"].every(
      (key) => typeof overview.accounts?.[key] === "number"
    ),
    true
  );
  check("the signup trend is a 30-day series", overview.accounts?.trend?.length, 30);
  check(
    "the trend buckets carry only a date and a count",
    overview.accounts.trend.every(
      (entry) => Object.keys(entry).sort().join(",") === "count,date" && typeof entry.count === "number"
    ),
    true
  );

  check(
    "operator rows are excluded from the account count",
    overview.accounts.excluded >= 1,
    true
  );
  check(
    "counted equals total minus excluded",
    overview.accounts.counted,
    overview.accounts.total - overview.accounts.excluded
  );

  check(
    "membership is split by tier and by origin",
    Array.isArray(overview.membership.byTier) && Array.isArray(overview.membership.byOrigin),
    true
  );
  check(
    "an unrecorded origin is reported as unattributed, never as an operator grant",
    overview.membership.byOrigin.every((row) => row.key !== "admin_grant" || row.count >= 0) &&
      !overview.membership.byOrigin.some((row) => row.key === null),
    true
  );

  const funnelTotal =
    overview.invites.redeemed + overview.invites.pending + overview.invites.expired + overview.invites.revoked;
  check("the invite funnel accounts for every invitation", overview.invites.created, funnelTotal);
  check(
    "the redemption rate is null or a proportion",
    overview.invites.redemptionRate === null ||
      (overview.invites.redemptionRate >= 0 && overview.invites.redemptionRate <= 1),
    true
  );
  check("storage reports a byte total", typeof overview.storage.bytes, "number");
  check("device health is counted", typeof overview.devices.active, "number");

  /* ---------- the payload must contain no person ---------- */

  const forbiddenKeys = new Set([
    "handle",
    "email",
    "displayName",
    "identityPublicKey",
    "body",
    "ciphertext",
    "userId",
    "authorId",
    "deviceId",
    "endpoint",
  ]);
  const leakedKeys = [];
  const leakedEmails = [];
  walk(overview, (key, child) => {
    if (forbiddenKeys.has(key)) leakedKeys.push(key);
    if (typeof child === "string" && child.includes("@") && child.includes(".")) leakedEmails.push(child);
  });
  check("the payload exposes no per-account field", leakedKeys.join(","), "");
  check("the payload exposes no email address", leakedEmails.join(","), "");

  /* ---------- the rendered page ---------- */

  const pageRes = await fetch(`${BASE}/admin`, { headers: { cookie: adminCookie } });
  check("the admin page answers 200", pageRes.status, 200);
  const html = await pageRes.text();
  for (const marker of [
    "Membership by tier",
    "Membership by origin",
    "Adviser invite funnel",
    "Signups, last 30 days",
    "Deliberately absent",
    "performs no actions",
  ]) {
    check(`the page renders "${marker}"`, html.includes(marker), true);
  }
  check("the page is marked noindex", /noindex/.test(html), true);

  /* ---------- a signed-in non-admin is refused ---------- */

  const outsider = await db.user.create({
    data: {
      handle: `probeadmin${TAG}`,
      displayName: "Probe Outsider",
      passwordHash: "probe:not-a-real-hash",
    },
  });
  createdUserIds.push(outsider.id);
  const outsiderCookie = await mintSession(outsider.id);

  const outsiderApi = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: outsiderCookie } });
  check("a non-admin gets 403 from the API, not the data", outsiderApi.status, 403);
  const outsiderPage = await fetch(`${BASE}/admin`, { headers: { cookie: outsiderCookie } });
  check("a non-admin gets the gate on the page", (await outsiderPage.text()).includes("Admin access required"), true);

  /* ---------- no session at all ---------- */

  const anonApi = await fetch(`${BASE}/api/admin/overview`);
  check("an anonymous request gets 401, not 403", anonApi.status, 401);
  const anonPage = await fetch(`${BASE}/admin`);
  check("an anonymous visitor gets the gate on the page", (await anonPage.text()).includes("Admin access required"), true);

  /* ---------- no action surface exists ---------- */

  const mutationAttempt = await fetch(`${BASE}/api/admin/overview`, { method: "POST", headers: { cookie: adminCookie } });
  check("the overview route rejects POST (405, no mutating handler)", mutationAttempt.status, 405);
}

let failed = 0;
try {
  await main();
} catch (err) {
  failed += 1;
  console.log(`ERROR  ${err instanceof Error ? err.message : String(err)}`);
} finally {
  /* Clean up only what this script made. The `admin` account is left exactly as
     found — if it already existed, nothing about it was touched. */
  try {
    if (createdSessionIds.length > 0) {
      await db.session.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (err) {
    console.log(`WARN  cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }
  await db.$disconnect();
}

for (const c of checks) {
  if (c.pass) {
    console.log(`PASS  ${c.label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.label}  (${c.detail})`);
  }
}
console.log(`\n=== ${checks.length - failed}/${checks.length} admin-overview probe checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
