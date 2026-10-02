/*
 * TEMPORARY live probe — prove the outbox's core safety claim over real HTTP:
 *
 *   A retry of a send whose outcome was never learned (the TIMEOUT case) must
 *   NOT duplicate the message. The client mints a clientKey once; a repeat POST
 *   carrying the same key must return the ORIGINAL message, not a second one.
 *
 * And the two corollaries that keep an idempotency key from becoming a secret
 * oracle:
 *   - the same key in a DIFFERENT conversation is a 409, never a replay;
 *   - the same key under a DIFFERENT author is a 409, never a replay.
 *
 * This is pure server behaviour, so it needs no browser/IndexedDB: it drives
 * the real dev server and inspects Postgres directly. The queue/flush/offline
 * half is covered by the structural guards in verify-outbox.mts and the
 * round-39 cache probe (which already exercises the live send path).
 *
 * Run with the dev server reachable: node scripts/probe-outbox.mjs
 * (the script also waits for the server to finish compiling).
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
const PW = "probe-outbox-pass-123";

const results = [];
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
};

const hashPassword = async (p) => {
  const salt = randomBytes(16);
  const d = await scryptAsync(p.normalize("NFKC"), salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${d.toString("hex")}`;
};

/* A body the SEND SCHEMA accepts (envelope shape, not a real ciphertext — the
   server stores it as-is; decryption is client-side). */
const fakeEnvelope = () => JSON.stringify({ v: 1, n: "AAAAAAAAAAAA", c: "AQIDBAUG" });

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", body: "{}" });
      if (r.status !== 404) return true; // 400 bad_request means the route compiled
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("dev server did not become ready");
}

/* POST a message, retrying through dev-server route compilation (transient 500). */
async function postMessage(convId, clientKey, cookie, body = fakeEnvelope()) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ body, kind: "text", clientKey }),
    });
    if (r.status === 500 || r.status === 503) {
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  }
  return { status: 0, data: null };
}

async function login(handle) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, password: PW }),
  });
  const data = await r.json().catch(() => null);
  const cookies = r.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  return { ok: r.ok && data?.ok === true, cookie, userId: data?.user?.id };
}

/* ---------- fixtures ---------- */
const HANDLES = ["probe_outbox_a", "probe_outbox_b", "probe_outbox_c"];
const pwHash = await hashPassword(PW);
for (const handle of HANDLES) {
  await db.user.upsert({
    where: { handle },
    update: { passwordHash: pwHash },
    create: { handle, displayName: handle, passwordHash: pwHash, membershipTier: "reserve", membershipOrigin: "admin_grant" },
  });
}
const ids = Object.fromEntries(
  (await db.user.findMany({ where: { handle: { in: HANDLES } }, select: { id: true, handle: true } })).map((u) => [u.handle, u.id])
);
await db.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
await db.conversation.deleteMany({
  where: { isGroup: false, participations: { every: { userId: { in: Object.values(ids) } } } },
});
const mkConv = async (...hs) =>
  (await db.conversation.create({ data: { isGroup: false, participations: { create: hs.map((h) => ({ userId: ids[h] })) } }, select: { id: true } })).id;
const conv1 = await mkConv("probe_outbox_a", "probe_outbox_b");
const conv2 = await mkConv("probe_outbox_a", "probe_outbox_c");

console.log(`conversations: conv1=${conv1} conv2=${conv2}\n`);

await waitForServer();

/* ---------- 1. login ---------- */
const a = await login("probe_outbox_a");
check("A logs in", a.ok, true);
const b = await login("probe_outbox_b");
check("B logs in", b.ok, true);

const KEY = "dup-probe-key-0001";

/* ---------- 2. the headline claim: retry without learning the outcome ---------- */
const first = await postMessage(conv1, KEY, a.cookie);
check("first send succeeds", first.status, 200);
check("first send reports ok", first.data?.ok, true);
const firstId = first.data?.message?.id;

const second = await postMessage(conv1, KEY, a.cookie);
check("retry of an unknown-outcome send succeeds (no 409/500)", second.status, 200);
check("retry reports ok", second.data?.ok, true);
check("retry returns the SAME message id, not a new one", second.data?.message?.id, firstId);
check("retry is flagged as a replay", second.data?.replayed, true);

const dbCount = await db.message.count({ where: { clientKey: KEY } });
check("exactly ONE message row exists for the key", dbCount, 1);

/* The id the server generated must itself be stable: it equals both responses. */
check("the stored message id matches the first response", (await db.message.findUnique({ where: { clientKey: KEY }, select: { id: true } }))?.id, firstId);

/* ---------- 3. a NEW key still sends (no false idempotency) ---------- */
const newKey = "dup-probe-key-0002";
const third = await postMessage(conv1, newKey, a.cookie);
check("a genuinely new message sends", third.status, 200);
check("a new key is NOT reported as a replay", third.data?.replayed ?? false, false);

/* ---------- 4. the key is not a secret oracle ---------- */
const crossConv = await postMessage(conv2, KEY, a.cookie);
check("same key in a different conversation is rejected", crossConv.status, 409);
check("cross-conversation rejection names client_key_conflict", crossConv.data?.error, "client_key_conflict");

const crossAuthor = await postMessage(conv1, KEY, b.cookie);
check("same key under a different author is rejected", crossAuthor.status, 409);
check("cross-author rejection names client_key_conflict", crossAuthor.data?.error, "client_key_conflict");

/* ---------- cleanup ---------- */
await db.conversation.deleteMany({ where: { id: { in: [conv1, conv2] } } }).catch(() => {});
await db.$disconnect();

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} outbox duplicate-safety probe checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
