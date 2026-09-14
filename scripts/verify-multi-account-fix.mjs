/*
 * Verify the multi-account fix end-to-end against the running server.
 * Mirrors the real journey: phone install -> account A -> sign out ->
 * account B -> reload (bootstrap bind). Also proves the anti-hijack guard.
 */
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
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
const scryptAsync = promisify(scrypt);
const BASE = "http://localhost:3000";
const PW = "probe-pass-123";
const INSTALL = "probe-phone-install-0001";
const TOKEN = "probe-device-token-abcdefghijklmnop";

const hashPassword = async (p) => {
  const salt = randomBytes(16);
  const d = await scryptAsync(p.normalize("NFKC"), salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${d.toString("hex")}`;
};
for (const handle of ["probe_a", "probe_b"]) {
  await db.user.upsert({
    where: { handle },
    update: { passwordHash: await hashPassword(PW) },
    create: { handle, displayName: handle, passwordHash: await hashPassword(PW), membershipTier: "reserve", membershipOrigin: "admin_grant" },
  });
}
await db.user.upsert({
  where: { handle: "probe_c" },
  update: { passwordHash: await hashPassword(PW) },
  create: { handle: "probe_c", displayName: "probe_c", passwordHash: await hashPassword(PW), membershipTier: "reserve", membershipOrigin: "admin_grant" },
});
await db.deviceRevocation.deleteMany({ where: { deviceId: INSTALL } });
/* Clear sessions left by earlier probe runs so the assertions measure THIS
   run, not historical state. */
const probeIds = (
  await db.user.findMany({
    where: { handle: { in: ["probe_a", "probe_b", "probe_c"] } },
    select: { id: true },
  })
).map((u) => u.id);
await db.session.deleteMany({ where: { userId: { in: probeIds } } });

const results = [];
const check = (label, actual, expected) => {
  const pass = actual === expected;
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${actual}, want ${expected})`);
};

async function login(handle, { deviceId = INSTALL, deviceToken = TOKEN } = {}) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, password: PW, deviceId, deviceName: "Cloak on Android", deviceToken }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json: await res.json().catch(() => ({})), cookie };
}

async function bootstrapBind(cookie) {
  const res = await fetch(`${BASE}/api/security/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ deviceId: INSTALL, deviceName: "Cloak on Android", deviceToken: TOKEN }),
  });
  return res.status;
}

async function devices(cookie) {
  const res = await fetch(`${BASE}/api/security/devices`, { headers: { cookie } });
  return (await res.json()).devices ?? [];
}

console.log("\n=== JOURNEY: two accounts on ONE phone install ===\n");

console.log("1) install signs in as probe_a");
const a = await login("probe_a");
check("login probe_a", a.status, 200);
check("bootstrap bind probe_a", await bootstrapBind(a.cookie), 200);

console.log("\n2) sign out");
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie: a.cookie } });
check("session dead after logout", (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: a.cookie } })).status, 401);

console.log("\n3) SAME install signs in as probe_b  <-- the reported failure");
const b = await login("probe_b");
check("login probe_b", b.status, 200);
check("me probe_b", (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: b.cookie } })).status, 200);
check("bootstrap bind probe_b", await bootstrapBind(b.cookie), 200);
const bDevices = await devices(b.cookie);
const realDevice = bDevices.find((d) => d.deviceId === INSTALL);
check("device listed for probe_b", !!realDevice, true);
check("device flagged current", realDevice?.current, true);
check("no 'Unrecognized device' row", bDevices.some((d) => d.name === "Unrecognized device"), false);

console.log("\n4) back to probe_a on the same install (switching back must also work)");
const a2 = await login("probe_a");
check("login probe_a again", a2.status, 200);
check("bootstrap bind probe_a again", await bootstrapBind(a2.cookie), 200);
check("device still listed", (await devices(a2.cookie)).some((d) => d.deviceId === INSTALL), true);

console.log("\n5) SECURITY: a THIRD account replaying the deviceId WITHOUT the token");
const impostor = await login("probe_c", { deviceId: INSTALL, deviceToken: "attacker-token-not-the-real-one-xx" });
check("impostor login still succeeds (own account)", impostor.status, 200);
const row = await db.device.findUnique({ where: { id: INSTALL }, select: { userId: true } });
const probeA = await db.user.findUnique({ where: { handle: "probe_a" }, select: { id: true } });
check("impostor did NOT steal the device row", row?.userId === probeA?.id, true);
const impostorDevices = await devices(impostor.cookie);
check("impostor sees no bound install", impostorDevices.some((d) => d.deviceId === INSTALL), false);
const impostorSessions = await db.session.findMany({
  where: { user: { handle: "probe_c" } },
  select: { deviceId: true },
});
check("impostor session is unbound", impostorSessions.every((s) => s.deviceId === null), true);

console.log("\n6) revoked install stays revoked (Dagger wins over account switching)");
await db.deviceRevocation.create({ data: { userId: probeA.id, deviceId: INSTALL, reason: "manual" } });
const revokedLogin = await login("probe_a");
check("login still allowed after revoke", revokedLogin.status, 200);
const revokedRow = await db.device.findUnique({ where: { id: INSTALL }, select: { userId: true } });
check("revoked device not re-enrolled", revokedRow?.userId === probeA.id, true);
await db.deviceRevocation.deleteMany({ where: { deviceId: INSTALL } });

console.log("\n7) legacy (pre-registry) sessions: one row, and revocable");
{
  const idOf = async (handle) =>
    (await db.user.findUnique({ where: { handle }, select: { id: true } })).id;
  const probeCId = await idOf("probe_c");
  const probeAId = await idOf("probe_a");

  const c = await login("probe_c");
  /* Simulate a session created before the device registry existed. */
  await db.session.create({
    data: {
      userId: probeCId,
      tokenHash: `legacy-probe-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      deviceId: null,
    },
  });

  const list = await devices(c.cookie);
  const legacyRows = list.filter((d) => d.deviceId.startsWith("legacy-"));
  check("unbound sessions collapse to one row", legacyRows.length, 1);
  check("legacy row is not flagged current", legacyRows[0]?.current, false);
  check("two unbound sessions exist", await db.session.count({ where: { userId: probeCId, deviceId: null } }), 2);

  const foreign = await fetch(
    `${BASE}/api/security/devices/${encodeURIComponent(`legacy-${probeAId}`)}/revoke`,
    { method: "POST", headers: { cookie: c.cookie } }
  );
  check("another account's legacy id is refused", foreign.status, 404);

  const own = await fetch(
    `${BASE}/api/security/devices/${encodeURIComponent(`legacy-${probeCId}`)}/revoke`,
    { method: "POST", headers: { cookie: c.cookie } }
  );
  check("own legacy row revokes", own.status, 200);
  check("all unbound sessions killed", await db.session.count({ where: { userId: probeCId, deviceId: null } }), 0);
}

console.log(`\n=== ${results.filter(Boolean).length}/${results.length} checks passed ===`);

/* Leave no trace: the probe accounts and their sessions/devices are removed
   so this script is safe to re-run against a real database. */
await db.session.deleteMany({ where: { userId: { in: probeIds } } });
await db.device.deleteMany({ where: { userId: { in: probeIds } } });
await db.user.deleteMany({ where: { handle: { in: ["probe_a", "probe_b", "probe_c"] } } });
console.log("probe accounts, sessions and devices cleaned up");

await db.$disconnect();
process.exit(results.every(Boolean) ? 0 : 1);
