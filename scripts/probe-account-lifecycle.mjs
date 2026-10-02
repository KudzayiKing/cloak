/*
 * TEMPORARY live probe — prove account erasure works against the REAL
 * database and the REAL route, not just against source text.
 *
 * Why this exists. `verify-account-lifecycle.mts` proves the shape of the
 * code; it cannot prove that Postgres actually accepts the delete. The whole
 * point of the ordered cleanup is that a naive `user.delete()` fails with a
 * foreign-key violation, so the only honest test seeds the relations that
 * cause that failure and then deletes the account for real.
 *
 * Seeded on the throwaway account (every one of these would BLOCK a bare
 * `user.delete()`):
 *   - Device               (required relation -> Restrict)
 *   - DeviceRevocation     (required relation -> Restrict)
 *   - DaggerCommand        (required relation -> Restrict)
 *   - AdviserInvitation    (explicit onDelete: Restrict, as the issuer)
 * Plus the things that must survive or move rather than vanish:
 *   - a Session (must go), an authored message (must SURVIVE, author nulled),
 *   - a group it OWNS with another member (ownership must transfer),
 *   - a Circle it OWNS with another member (ownership must transfer),
 *   - an active GroupInvite it minted (must be revoked),
 *   - a 1:1 conversation (must survive for the other participant).
 *
 * Then it drives `DELETE /api/account` over HTTP to cover the route's own
 * guards (session, handle typed back, password re-verified, cookie expired)
 * and `GET /api/account/export` for the portability half.
 *
 * Run with the dev server reachable:
 *   node scripts/probe-account-lifecycle.mjs
 * (the script waits for the server to finish compiling)
 */
import { randomBytes, createHash, scrypt } from "node:crypto";
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
const PW = "probe-erase-pass-123";
const TAG = randomBytes(4).toString("hex");
const HANDLE_A = `probeerase${TAG}`;
const HANDLE_B = `probeerasepeer${TAG}`;

const results = [];
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(pass);
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`
  );
};

const hashPassword = async (p) => {
  const salt = randomBytes(16);
  const d = await scryptAsync(p.normalize("NFKC"), salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${d.toString("hex")}`;
};

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", body: "{}" });
      if (r.status !== 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("dev server did not become ready");
}

/*
 * Prime the two NEW routes before asserting on them.
 *
 * `next dev` compiles a route on first request, and a route file added while
 * the server is already up can answer its very first request with the dev
 * 404 while the route manifest catches up. That is a harness race, not a
 * product bug — so it is absorbed here (retry until we get JSON back) rather
 * than allowed to masquerade as a failing assertion.
 */
async function primeRoutes() {
  const targets = [
    ["GET", `${BASE}/api/account/export`],
    ["DELETE", `${BASE}/api/account`],
  ];
  for (const [method, url] of targets) {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "DELETE" ? { body: "{}" } : {}),
      });
      const ctype = r.headers.get("content-type") ?? "";
      if (ctype.includes("application/json")) break;
      await new Promise((res) => setTimeout(res, 500));
    }
  }
}

const created = { userIds: [], conversationIds: [], circleIds: [], invitationIds: [] };

async function cleanup() {
  /* Best-effort teardown of anything this probe created. Runs whether the
     probe passed or failed, so the production database is left as found. */
  try {
    for (const id of created.invitationIds) {
      await db.adviserInvitation.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of created.circleIds) {
      await db.circle.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of created.conversationIds) {
      await db.conversation.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of created.userIds) {
      await db.daggerCommand.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.deviceRevocation.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.device.deleteMany({ where: { userId: id } }).catch(() => {});
      await db.user.deleteMany({ where: { id } }).catch(() => {});
    }
  } catch (err) {
    console.log(`cleanup warning: ${err.message}`);
  }
}

async function main() {
  await waitForServer();
  await primeRoutes();

  const passwordHash = await hashPassword(PW);

  /* ---------------- seed ---------------- */

  const userA = await db.user.create({
    data: { handle: HANDLE_A, displayName: "Probe Erase", passwordHash },
  });
  const userB = await db.user.create({
    data: { handle: HANDLE_B, displayName: "Probe Peer", passwordHash },
  });
  created.userIds.push(userA.id, userB.id);

  /* The four blockers. */
  const deviceId = `probe-device-${TAG}`;
  await db.device.create({
    data: {
      id: deviceId,
      userId: userA.id,
      name: "Probe install",
      tokenHash: createHash("sha256").update(`tok-${TAG}`).digest("hex"),
    },
  });
  await db.deviceRevocation.create({
    data: { userId: userA.id, deviceId: `probe-revoked-${TAG}`, reason: "manual" },
  });
  await db.daggerCommand.create({
    data: { userId: userA.id, deviceId, nonce: `nonce-${TAG}` },
  });
  const invitation = await db.adviserInvitation.create({
    data: {
      recipientName: "Probe Invitee",
      recipientEmail: `probe-${TAG}@example.com`,
      tokenHash: createHash("sha256").update(`invite-${TAG}`).digest("hex"),
      createdByAdminId: userA.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });
  created.invitationIds.push(invitation.id);

  /* A live session for A, addressed by a token we hold. `deviceId: null`
     keeps it a legacy session so the seeded DeviceRevocation cannot kill it
     before we get to the route. */
  const sessionToken = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId: userA.id,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  const cookie = `cloak_session=${sessionToken}`;

  /* A 1:1 with a message A authored — the message must SURVIVE, author nulled. */
  const dm = await db.conversation.create({ data: { isGroup: false } });
  created.conversationIds.push(dm.id);
  await db.participation.create({ data: { conversationId: dm.id, userId: userA.id } });
  await db.participation.create({ data: { conversationId: dm.id, userId: userB.id } });
  const authored = await db.message.create({
    data: { conversationId: dm.id, authorId: userA.id, body: "probe envelope", kind: "text" },
  });

  /* A group A OWNS with B as a plain member — ownership must move to B. */
  const group = await db.conversation.create({
    data: { isGroup: true, title: `Probe group ${TAG}`, ownerId: userA.id },
  });
  created.conversationIds.push(group.id);
  await db.participation.create({
    data: { conversationId: group.id, userId: userA.id, role: "owner" },
  });
  const peerPart = await db.participation.create({
    data: { conversationId: group.id, userId: userB.id, role: "member" },
  });
  const groupInvite = await db.groupInvite.create({
    data: {
      conversationId: group.id,
      createdByUserId: userA.id,
      tokenHash: createHash("sha256").update(`ginv-${TAG}`).digest("hex"),
      status: "active",
    },
  });

  /* A Circle A owns with B as a plain member — ownership must move to B. */
  const circle = await db.circle.create({
    data: { name: `Probe circle ${TAG}`, ownerUserId: userA.id },
  });
  created.circleIds.push(circle.id);
  await db.circleMember.create({ data: { circleId: circle.id, userId: userA.id, role: "owner" } });
  await db.circleMember.create({ data: { circleId: circle.id, userId: userB.id, role: "member" } });

  /* ---------------- export (before the erase) ---------------- */

  const exportRes = await fetch(`${BASE}/api/account/export`, { headers: { cookie } });
  const exportText = await exportRes.text();
  check("the export returns 200", exportRes.status, 200);
  check(
    "the export is delivered as a download",
    /attachment;\s*filename="cloak-/.test(exportRes.headers.get("content-disposition") ?? ""),
    true
  );
  check("the export is never cached", /no-store/.test(exportRes.headers.get("cache-control") ?? ""), true);
  let exported = null;
  try {
    exported = JSON.parse(exportText);
  } catch {
    /* leave null — the next check fails loudly */
  }
  check("the export parses as JSON", !!exported, true);
  check("the export is versioned", exported?.format, "cloak-account-export/1");
  check("the export names the account", exported?.account?.handle, HANDLE_A);
  check("the export lists the authored message", exported?.messagesAuthored?.length, 1);
  check("the export states what it omits", Array.isArray(exported?.omissions) && exported.omissions.length > 0, true);
  check(
    "the export carries NO password hash",
    /passwordHash/.test(exportText),
    false
  );
  check(
    "the export carries NO wrapped private key backup",
    /identityKeyBackup/.test(exportText),
    false
  );
  check("the export carries NO token hash", /tokenHash/.test(exportText), false);

  /* ---------------- the route's guards ---------------- */

  const noCookie = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PW, confirmHandle: HANDLE_A }),
  });
  check("an unauthenticated delete is refused", noCookie.status, 401);

  const wrongHandle = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ password: PW, confirmHandle: `${HANDLE_A}-nope` }),
  });
  check("a mistyped handle is refused", wrongHandle.status, 400);
  check("the mistyped handle names the failure", (await wrongHandle.json()).error, "handle_mismatch");

  const wrongPassword = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ password: "not-the-password", confirmHandle: HANDLE_A }),
  });
  check("a wrong password is refused", wrongPassword.status, 403);
  check("the wrong password names the failure", (await wrongPassword.json()).error, "bad_password");

  /* The account must still exist after three refusals. */
  check(
    "the account survives every refused attempt",
    !!(await db.user.findUnique({ where: { id: userA.id } })),
    true
  );

  /* ---------------- the real erase (handle sent with the "@") ---------------- */

  const eraseRes = await fetch(`${BASE}/api/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ password: PW, confirmHandle: `@${HANDLE_A}` }),
  });
  const eraseBody = await eraseRes.json().catch(() => ({}));
  check("the erase succeeds", eraseRes.status, 200);
  check("the erase reports ok", eraseBody.ok, true);
  check(
    "the erase summary reports the blockers it cleared",
    [
      eraseBody.summary?.devices,
      eraseBody.summary?.deviceRevocations,
      eraseBody.summary?.daggerCommands,
      eraseBody.summary?.adviserInvitationsDeleted,
    ],
    [1, 1, 1, 1]
  );
  const setCookie = eraseRes.headers.get("set-cookie") ?? "";
  check("the response expires the session cookie", /cloak_session=;/.test(setCookie), true);
  check("the expired cookie has Max-Age 0", /max-age=0/i.test(setCookie), true);

  /* ---------------- post-state ---------------- */

  check("the account row is gone", await db.user.findUnique({ where: { id: userA.id } }), null);
  check("its devices are gone", await db.device.count({ where: { userId: userA.id } }), 0);
  check("its device revocations are gone", await db.deviceRevocation.count({ where: { userId: userA.id } }), 0);
  check("its dagger commands are gone", await db.daggerCommand.count({ where: { userId: userA.id } }), 0);
  check(
    "the invitation it issued is gone",
    await db.adviserInvitation.count({ where: { createdByAdminId: userA.id } }),
    0
  );
  check("its sessions are gone", await db.session.count({ where: { userId: userA.id } }), 0);
  check("its participations are gone", await db.participation.count({ where: { userId: userA.id } }), 0);

  const survived = await db.message.findUnique({ where: { id: authored.id } });
  check("the authored message SURVIVES", !!survived, true);
  check("the surviving message is anonymised", survived?.authorId ?? null, null);
  check("the surviving message keeps its body", survived?.body, "probe envelope");

  const movedGroup = await db.conversation.findUnique({ where: { id: group.id } });
  check("the group survives", !!movedGroup, true);
  check("group ownership moved to the remaining member", movedGroup?.ownerId, userB.id);
  const movedPart = await db.participation.findUnique({ where: { id: peerPart.id } });
  check("the successor is promoted to owner", movedPart?.role, "owner");

  const movedCircle = await db.circle.findUnique({ where: { id: circle.id } });
  check("the circle survives", !!movedCircle, true);
  check("circle ownership moved to the remaining member", movedCircle?.ownerUserId, userB.id);

  const revokedInvite = await db.groupInvite.findUnique({ where: { id: groupInvite.id } });
  check("the invite it minted is revoked", revokedInvite?.status, "revoked");
  check("the revoked invite is stamped", !!revokedInvite?.revokedAt, true);

  const dmAfter = await db.conversation.findUnique({ where: { id: dm.id } });
  check("the 1:1 conversation survives for the other participant", !!dmAfter, true);

  /* The dead cookie must not authenticate anything. */
  const afterErase = await fetch(`${BASE}/api/account/export`, { headers: { cookie } });
  check("the erased account's cookie no longer authenticates", afterErase.status, 401);

  /* The peer must be untouched — erasing A must not touch B. */
  check("the peer account is untouched", !!(await db.user.findUnique({ where: { id: userB.id } })), true);

  /* ---------------- cleanup ---------------- */
  created.userIds = created.userIds.filter((id) => id !== userA.id); // already gone
  await cleanup();

  const failed = results.filter((r) => !r).length;
  console.log(`\n=== ${results.length - failed}/${results.length} account-erasure probe checks passed ===`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  await db.$disconnect();
  process.exit(1);
});
