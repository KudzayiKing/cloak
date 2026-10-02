/*
 * TEMPORARY live browser probe — prove the offline outbox works end to end:
 *
 *  1. Sign in both peers (publishes E2EE identities, so A can encrypt to B).
 *  2. Make the message POST unreachable (the probe aborts it at the network
 *     layer; the app shell still loads). A writes a message. It must QUEUE
 *     (status "queued"), not drop and not reach the server.
 *  3. RELOAD the tab. The queued message must be re-painted from IndexedDB
 *     (it never reached the server, so the server cache cannot supply it).
 *  4. Make the POST reachable again. The queue flushes. The message lands
 *     EXACTLY ONCE — the duplicate-safety the HTTP probe proved server-side.
 *
 * Drives the real store via a temporary dev harness route. Run with the dev
 * server up: node scripts/probe-outbox-browser.mjs
 */
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireProject = createRequire(import.meta.url);
const requireVscode = createRequire("/Users/kudzayi/vscode/node_modules/");
const { PrismaClient } = requireProject("@prisma/client");
const { chromium } = requireVscode("playwright");

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

const HANDLES = ["probe_outbox_a", "probe_outbox_b"];
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
const prior = (await db.conversation.findMany({ where: { isGroup: false, participations: { every: { userId: { in: Object.values(ids) } } } }, select: { id: true } })).map((c) => c.id);
await db.message.deleteMany({ where: { conversationId: { in: prior } } });
await db.conversation.deleteMany({ where: { id: { in: prior } } });
const conv = (await db.conversation.create({ data: { isGroup: false, participations: { create: HANDLES.map((h) => ({ userId: ids[h] })) } }, select: { id: true } })).id;
console.log(`conversation ${conv}\n`);

const before = await db.message.count({ where: { conversationId: conv } });
check("the conversation starts empty on the server", before, 0);

const browser = await chromium.launch({ channel: "chrome", args: ["--no-proxy-server"] });
const url = (handle, task) => `${BASE}/dev-outbox-harness?${new URLSearchParams({ as: handle, pw: PW, conv, task })}`;
const waitState = (page) => page.waitForFunction(() => window.__outbox && window.__outbox.ok !== undefined, null, { timeout: 90000 });

try {
  // Publish both identities (real sign-in uploads the public key).
  const bPage = await (await browser.newContext()).newPage();
  await bPage.goto(url("probe_outbox_b", "init"), { waitUntil: "domcontentloaded" });
  await waitState(bPage);
  check("B signs in (publishes identity)", (await bPage.evaluate(() => window.__outbox)).ok, true);
  await bPage.context().close();

  // One context for A so IndexedDB (the outbox) persists across the reload.
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctxA.newPage();
  await page.goto(url("probe_outbox_a", "init"), { waitUntil: "domcontentloaded" });
  await waitState(page);
  check("A signs in", (await page.evaluate(() => window.__outbox)).ok, true);

  // Make the message POST unreachable, but leave the app shell + GETs working.
  let blockPosts = true;
  await page.route("**/api/conversations/*/messages", (route) => {
    const blocked = blockPosts && route.request().method() === "POST";
    if (blocked) return route.abort();
    return route.continue();
  });

  // Offline send.
  await page.evaluate(() => window.__outboxApi.send());
  await waitState(page);
  const sentState = await page.evaluate(() => window.__outbox);
  check("offline send is held, not dropped", sentState.ok, true);
  check("offline send is queued (status=queued)", sentState.status, "queued");
  check("offline send is in the outbox store", sentState.outboxCount, 1);

  const midServer = await db.message.count({ where: { conversationId: conv } });
  check("the server has NOT received the message while offline", midServer, 0);

  // Reload — the queue must re-paint from IndexedDB. GETs still work, so the
  // page reloads and bootstrap re-runs hydrateLocalCache; the POST is still
  // blocked so nothing flushes during the reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitState(page); // init finished
  await page.evaluate(() => window.__outboxApi.reloadState());
  await page.waitForFunction(() => window.__outbox && window.__outbox.queuedCount !== undefined, null, { timeout: 30000 });
  const reloaded = await page.evaluate(() => window.__outbox);
  check("after reload the queued message is re-painted", reloaded.queuedCount, 1);
  check("after reload the outbox still holds the message", reloaded.outboxCount, 1);

  // Back online: unblock the POST, then flush.
  blockPosts = false;
  await page.evaluate(() => window.__outboxApi.flush());
  await waitState(page);
  const flushed = await page.evaluate(() => window.__outbox);
  check("the flushed message is marked sent", flushed.sentCount, 1);
  check("the outbox is now empty", flushed.outboxCount, 0);

  const after = await db.message.count({ where: { conversationId: conv } });
  check("the message landed on the server EXACTLY ONCE", after, 1);
} finally {
  await browser.close();
  await db.conversation.delete({ where: { id: conv } }).catch(() => {});
  await db.$disconnect();
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} outbox browser probe checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
