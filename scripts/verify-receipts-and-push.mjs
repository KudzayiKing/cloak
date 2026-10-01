/*
 * Verify the three-state tick and the new-message push, end-to-end against
 * the running server (round 23).
 *
 * The reported bug: "when I send a message the other user gets it, I see one
 * check mark". The tick renderer was already right (1 = sent, 2 = delivered,
 * 2 gold = read) and the server already derived the status from the peer's
 * participation markers — but only the conversation-detail GET advanced
 * `lastDeliveredAt`, and that runs only while a chat is open. A recipient
 * sitting on the chat list therefore never marked anything delivered, so the
 * sender sat on one tick indefinitely. This suite reproduces that exact
 * journey: send -> control poll -> RECIPIENT'S LIST POLL -> assert 2 ticks.
 *
 * Section B asserts the push side: a new message must not write an in-app
 * notification row (the structural inbox must stay structural), and a dead
 * push subscription must never break the send.
 *
 * Section C is a source scan for what cannot be observed over HTTP — the
 * service worker's collapse/deep-link rules and the version bump.
 *
 * Self-cleaning: probe users, their sessions, conversations and any push
 * subscriptions are removed on the way in; the push subscription is removed
 * on the way out. Safe to re-run. Needs the dev server up.
 *
 * Run: node scripts/verify-receipts-and-push.mjs
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
const INSTALL = "probe-receipts-install-0001";
const TOKEN = "probe-receipts-token-abcdefghij";

const results = [];
const check = (label, actual, expected) => {
  const pass = actual === expected;
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${actual}, want ${expected})`);
};

const hashPassword = async (p) => {
  const salt = randomBytes(16);
  const d = await scryptAsync(p.normalize("NFKC"), salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${d.toString("hex")}`;
};

/* ---------------------------- fixtures ---------------------------------- */

const HANDLES = ["probe_r_a", "probe_r_b"];
const passwordHash = await hashPassword(PW);
for (const handle of HANDLES) {
  await db.user.upsert({
    where: { handle },
    update: { passwordHash },
    create: {
      handle,
      displayName: handle,
      passwordHash,
      membershipTier: "reserve",
      membershipOrigin: "admin_grant",
    },
  });
}
const users = await db.user.findMany({ where: { handle: { in: HANDLES } } });
const userIds = users.map((u) => u.id);
const idOf = (handle) => users.find((u) => u.handle === handle).id;

/* Deterministic start: no sessions, no prior thread, no stale push rows, so
   the assertions measure THIS run. Messages cascade with the conversation. */
await db.session.deleteMany({ where: { userId: { in: userIds } } });
await db.conversation.deleteMany({ where: { participations: { some: { userId: { in: userIds } } } } });
await db.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
await db.userNotification.deleteMany({ where: { userId: { in: userIds } } });
await db.deviceRevocation.deleteMany({ where: { deviceId: INSTALL } });

async function login(handle) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      password: PW,
      deviceId: INSTALL,
      deviceName: "Cloak receipts probe",
      deviceToken: TOKEN,
    }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json: await res.json().catch(() => ({})), cookie };
}

/** A syntactically valid E2EE envelope — the send route rejects plaintext. */
const envelope = (tag) =>
  JSON.stringify({ v: 1, n: "AAAAAAAAAAAA", c: Buffer.from(tag).toString("base64") });

const get = async (path, cookie) =>
  (await fetch(`${BASE}${path}`, { headers: { cookie }, cache: "no-store" })).json();
const post = async (path, cookie, body) =>
  (
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json();

/** A's view of one message's tick state, via the list poll. */
const tickFor = async (cookie, conversationId, messageId) => {
  const list = await get("/api/conversations", cookie);
  const conv = (list.conversations ?? []).find((c) => c.id === conversationId);
  const msg = (conv?.messages ?? []).find((m) => m.id === messageId);
  return { status: msg?.status, unread: conv?.unreadCount };
};

/* ------------------------------ run ------------------------------------- */

const a = await login("probe_r_a");
const b = await login("probe_r_b");
check("probe sender signs in", a.status, 200);
check("probe recipient signs in", b.status, 200);

if (a.status !== 200 || b.status !== 200) {
  console.log("\n=== cannot continue without two sessions ===");
  await db.$disconnect();
  process.exit(1);
}

/* A opens the DM. POST returns the existing thread if one survived. */
const opened = await post("/api/conversations", a.cookie, { handle: "probe_r_b" });
const convId = opened.conversation?.id;
check("sender opens a 1:1 thread", typeof convId === "string", true);
check("a fresh thread starts with no history", opened.conversation?.messages?.length ?? 0, 0);

/* ---- A. the tick advances sent -> delivered -> read -------------------- */

const sent = await post(`/api/conversations/${convId}/messages`, a.cookie, {
  body: envelope("hello"),
  kind: "text",
});
const msgId = sent.message?.id;
check("message send succeeds", sent.ok, true);
check("a just-sent message reports ONE tick", sent.message?.status, "sent");

/* Control: the sender's own poll must not invent delivery. Without this the
   next assertion could pass for the wrong reason (e.g. always "delivered"). */
const beforePeerSync = await tickFor(a.cookie, convId, msgId);
check("  ... and still one tick on the sender's own list poll", beforePeerSync.status, "sent");

/* THE FIX. The recipient is on the chat list — the app's landing screen and
   the state the report was taken in — so this is a LIST poll, not a detail
   fetch. Before round 23 this was a no-op for delivery. */
const bList = await get("/api/conversations", b.cookie);
const bConv = (bList.conversations ?? []).find((c) => c.id === convId);
check("the recipient sees no tick on an incoming message", bConv?.messages?.[0]?.status, undefined);

const afterPeerSync = await tickFor(a.cookie, convId, msgId);
check("the sender now sees TWO ticks (delivered)", afterPeerSync.status, "delivered");

/* Delivery must not double as reading. This reads the RECIPIENT's own list:
   the sender's unread count is 0 by construction, so asserting on that
   would pass no matter what delivery did. */
check("  ... and delivery is NOT read", bConv?.unreadCount, 1);

/* The recipient opens the thread and marks it read. */
await post(`/api/conversations/${convId}/read`, b.cookie);
const afterRead = await tickFor(a.cookie, convId, msgId);
check("the recipient reading the thread turns the ticks gold", afterRead.status, "read");

/* ---- B. push: fan-out discipline and failure posture ------------------- */

const inboxBefore = await db.userNotification.count({ where: { userId: idOf("probe_r_b") } });
await post(`/api/conversations/${convId}/messages`, a.cookie, {
  body: envelope("second"),
  kind: "text",
});
await new Promise((r) => setTimeout(r, 1500)); // let `after()` run
const inboxAfter = await db.userNotification.count({ where: { userId: idOf("probe_r_b") } });
check("a message push writes NO in-app notification row", inboxAfter, inboxBefore);

/* A dead subscription must not take the send down with it: the push is
   scheduled after the response and absorbs its own failures. */
await db.pushSubscription.create({
  data: {
    userId: idOf("probe_r_b"),
    endpoint: "https://127.0.0.1:9/dead-endpoint",
    p256dh: "B".repeat(87),
    auth: "C".repeat(22),
  },
});
const withDeadPush = await post(`/api/conversations/${convId}/messages`, a.cookie, {
  body: envelope("third"),
  kind: "text",
});
check("a dead push subscription does not break the send", withDeadPush.ok, true);
await new Promise((r) => setTimeout(r, 1500));

/* VAPID must actually be configured, or every push silently no-ops. */
const pushKey = await get("/api/push", a.cookie);
check("the server exposes a VAPID public key", pushKey.ok, true);
check("  ... and it is the configured one", pushKey.publicKey === process.env.VAPID_PUBLIC_KEY, true);

/* ---- C. source scan: what HTTP cannot show ----------------------------- */

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const convo = stripComments(read("src/lib/cloak/server/conversations.ts"));
check(
  "the list poll writes the delivery marker",
  /db\.participation\.updateMany\(\{[\s\S]{0,160}lastDeliveredAt/.test(convo),
  true
);
check(
  "  ... using the pre-query clock, so it cannot claim undelivered mail",
  /lastDeliveredAt:\s*now\b/.test(convo),
  true
);
check(
  "  ... and skips the caller's own messages",
  /newest\.authorId === userId/.test(convo),
  true
);

const sendRoute = stripComments(read("src/app/api/conversations/[id]/messages/route.ts"));
check("the send route schedules the push", /\bafter\(/.test(sendRoute), true);
check("  ... through notifyNewMessage", /notifyNewMessage\(/.test(sendRoute), true);
check("  ... for every participant except the sender", /p\.userId !== user\.id/.test(sendRoute), true);

const notify = stripComments(read("src/lib/cloak/server/notify.ts"));
const notifyNewMessage = notify.slice(notify.indexOf("export async function notifyNewMessage"));
check(
  "notifyNewMessage is push-only (no in-app row)",
  /userNotification\.create/.test(notifyNewMessage),
  false
);
check(
  "  ... and its copy carries no content or sender name",
  /body:\s*"Open Cloak Dagger to read it"/.test(notifyNewMessage),
  true
);

const sw = read("public/sw.js");
check("the service worker handles push", /addEventListener\("push"/.test(sw), true);
check("  ... and notification clicks", /addEventListener\("notificationclick"/.test(sw), true);
check("  ... deep-linking a chat to the message list", /data\.conversationId\)[\s\S]{0,8}return "\/#\/app\/messages"/.test(sw), true);
check("  ... collapsing notifications per conversation", /return "cloak-chat-" \+ data\.conversationId/.test(sw), true);
check("  ... and keeping the structural fallback off message pushes", /isMessage \? "" : "Security or membership event"/.test(sw), true);
const version = Number((sw.match(/const VERSION = "cloak-shell-v(\d+)"/) ?? [])[1]);
check("the shell cache version was bumped for this bundle", version >= 34, true);

/* ---------------------------- teardown ---------------------------------- */

await db.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
await db.$disconnect();

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} receipt & push checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
