/*
 * Guards account erasure and portability.
 *
 * What this exists to prevent — the ways "delete the user" goes wrong:
 *
 *  1. A BARE `user.delete()` FAILS. Four relations on `User` are REQUIRED
 *     relations with `onDelete: Restrict` (the Prisma default), so Postgres
 *     refuses the delete with a foreign-key violation: `Device.userId`,
 *     `DeviceRevocation.userId`, `DaggerCommand.userId`, and
 *     `AdviserInvitation.createdByAdminId` (which is written out
 *     explicitly). Each must be cleared FIRST, and the whole sequence must
 *     run inside ONE transaction — a partial erasure (devices gone, account
 *     still there) is worse than a failed one.
 *
 *  2. ORDER MATTERS. Postgres checks foreign keys immediately here, so
 *     every Restrict child is removed before the parent row, and every
 *     ownership handover happens while the owner row still exists. A
 *     reordered file must fail this suite, not production.
 *
 *  3. AUTHORED MESSAGES ARE ANONYMISED, NOT DESTROYED. `Message.authorId`
 *     is `SetNull` on purpose: other people's conversation history must
 *     survive. A `message.deleteMany({ where: { authorId } })` anywhere in
 *     the lifecycle is a regression.
 *
 *  4. THE OWNER CANNOT VANISH FROM A GROUP THEY OWN. A live user cannot
 *     leave a group they own (`leaveGroup` → `transfer_ownership_first`,
 *     spec §76), so an account deletion must hand ownership over rather
 *     than leave a dangling `ownerId`. Same for Circles.
 *
 *  5. INVITES MINTED BY THE ACCOUNT DIE WITH IT — the same cleanup
 *     `removeMember`/`leaveGroup` already perform, so a capability cannot
 *     outlive the account that created it.
 *
 *  6. DELETION MUST NOT BE A ONE-CLICK. The session cookie alone is not
 *     enough: same-origin, the handle typed back, and the PASSWORD
 *     re-verified. And the cookie is expired by the response, because the
 *     session row is already gone.
 *
 *  7. THE LOCAL COPY GOES TOO — BUT ONLY THIS ACCOUNT'S. One install may
 *     serve several Cloak IDs, so the device-wide Dagger helpers
 *     (`destroyCryptoKeys`, `clearSensitiveStorage`, `clearLocalCache`)
 *     would take another account's keyring and cached history with it.
 *
 *  8. AN EXPORT MUST NOT CARRY SECRETS. The password hash, the
 *     passphrase-wrapped private key backup, and every token hash are
 *     excluded by construction.
 *
 * Run: node_modules/.bin/tsx scripts/verify-account-lifecycle.mts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  checks.push({
    label,
    pass: actual === expected,
    detail: `got ${String(actual)}, want ${String(expected)}`,
  });
}

/* Comments are stripped because these files carry prose describing the very
   defects being asserted against — a comment quoting `tx.device.deleteMany`
   or `passwordHash` would otherwise satisfy a check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const lifecycle = stripComments(read("src/lib/cloak/server/account-lifecycle.ts"));
const deleteRoute = stripComments(read("src/app/api/account/route.ts"));
const exportRoute = stripComments(read("src/app/api/account/export/route.ts"));
const store = stripComments(read("src/stores/cloak-store.ts"));
const settings = stripComments(read("src/components/cloak/settings/settings-page.tsx"));
const localDb = stripComments(read("src/lib/cloak/local-db.ts"));
const orchestrator = stripComments(read("src/lib/crypto/e2ee-orchestrator.ts"));
const vault = stripComments(read("src/lib/crypto/local-vault.ts"));
const sw = read("public/sw.js");

const at = (haystack: string, needle: string): number => haystack.indexOf(needle);

/* ---------------- 1. the Restrict relations are cleared ---------------- */

check(
  "DaggerCommand is cleared explicitly (required relation, Restrict)",
  /tx\.daggerCommand\.deleteMany\(\{\s*where:\s*\{\s*userId\s*\}/.test(lifecycle),
  true
);
check(
  "DeviceRevocation is cleared explicitly (required relation, Restrict)",
  /tx\.deviceRevocation\.deleteMany\(\{\s*where:\s*\{\s*userId\s*\}/.test(lifecycle),
  true
);
check(
  "Device is cleared explicitly (required relation, Restrict)",
  /tx\.device\.deleteMany\(\{\s*where:\s*\{\s*userId\s*\}/.test(lifecycle),
  true
);
check(
  "AdviserInvitation issued by the account is cleared (explicit Restrict)",
  /tx\.adviserInvitation\.deleteMany\(\{\s*where:\s*\{\s*createdByAdminId:\s*userId\s*\}/.test(lifecycle),
  true
);

/* --------------------- 2. ordering + atomicity ------------------------- */

const userDeleteAt = at(lifecycle, "await tx.user.delete(");
check("the account row is deleted exactly once", userDeleteAt > -1, true);

/* Presence AND order: an absent call yields index -1, which would sail
   through a naive `userDeleteAt > index` comparison. */
const restrictAt = [
  at(lifecycle, "tx.daggerCommand.deleteMany("),
  at(lifecycle, "tx.deviceRevocation.deleteMany("),
  at(lifecycle, "tx.device.deleteMany("),
  at(lifecycle, "tx.adviserInvitation.deleteMany("),
];
check(
  "every Restrict child is present AND removed BEFORE the account row",
  restrictAt.every((i) => i > -1) && restrictAt.every((i) => i < userDeleteAt),
  true
);
const handoverAt = [at(lifecycle, "tx.circleMember.update("), at(lifecycle, "tx.participation.update(")];
check(
  "ownership handover is present AND happens BEFORE the account row goes",
  handoverAt.every((i) => i > -1) && handoverAt.every((i) => i < userDeleteAt),
  true
);
check(
  "the erasure runs inside one interactive transaction with a raised budget",
  /db\.\$transaction\(\s*\(tx\)\s*=>\s*deleteUserAccountInTransaction\(tx,\s*userId\)/.test(lifecycle) &&
    /timeout:\s*DELETION_TX_TIMEOUT_MS/.test(lifecycle) &&
    /DELETION_TX_TIMEOUT_MS\s*=\s*\d{2,}_?\d*/.test(lifecycle),
  true
);
check(
  "a missing account is reported, not silently ignored",
  /throw new Error\("user_not_found"\)/.test(lifecycle),
  true
);

/* ------------- 3. authored messages survive, anonymised --------------- */

check(
  "authored messages are NOT deleted (schema SetNull anonymises them)",
  /tx\.message\.deleteMany/.test(lifecycle),
  false
);
check(
  "the summary reports the anonymised message count",
  /messagesAuthoredAnonymised/.test(lifecycle) && /tx\.message\.count\(\{\s*where:\s*\{\s*authorId:\s*userId\s*\}/.test(lifecycle),
  true
);

/* ------------------- 4. ownership handover rules ----------------------- */

check(
  "a group the account owns hands ownership to a remaining member",
  /isGroup:\s*true,\s*ownerId:\s*userId/.test(lifecycle) &&
    /others\.find\(\(p\)\s*=>\s*p\.role === "admin"\)\s*\?\?\s*others\[0\]/.test(lifecycle) &&
    /data:\s*\{\s*ownerId:\s*successor\.userId\s*\}/.test(lifecycle),
  true
);
check(
  "a group with nobody left drops the dangling owner instead of keeping a ghost id",
  /data:\s*\{\s*ownerId:\s*null\s*\}/.test(lifecycle),
  true
);
check(
  "a circle the account owns hands ownership over, or is deleted when empty",
  /ownerUserId:\s*userId/.test(lifecycle) &&
    /data:\s*\{\s*ownerUserId:\s*successor\.userId\s*\}/.test(lifecycle) &&
    /tx\.circle\.delete\(/.test(lifecycle),
  true
);

/* ---------------------- 5. invites are revoked ------------------------- */

check(
  "active group invites minted by the account are revoked",
  /tx\.groupInvite\.updateMany\(\{[\s\S]{0,200}?createdByUserId:\s*userId,\s*status:\s*"active"[\s\S]{0,200}?status:\s*"revoked"/.test(
    lifecycle
  ),
  true
);
check(
  "active circle invites minted by the account are revoked",
  /tx\.circleInvite\.updateMany\(\{[\s\S]{0,200}?createdByUserId:\s*userId,\s*status:\s*"active"[\s\S]{0,200}?status:\s*"revoked"/.test(
    lifecycle
  ),
  true
);

/* ------------ 6. nullable no-FK actor columns are anonymised ----------- */

check(
  "circle audit actors are anonymised, not deleted (other people's log survives)",
  /tx\.circleAuditEvent\.updateMany\(\{[\s\S]{0,160}?actorUserId:\s*userId[\s\S]{0,120}?actorUserId:\s*null/.test(
    lifecycle
  ),
  true
);
check(
  "resolved-by pointers on join requests are nulled",
  /tx\.groupJoinRequest\.updateMany\(/.test(lifecycle) &&
    /tx\.circleJoinRequest\.updateMany\(/.test(lifecycle) &&
    /resolvedByUserId:\s*null/.test(lifecycle),
  true
);

/* ------------------------- 7. the DELETE route ------------------------- */

check(
  "the delete route requires a session",
  /getSessionUser\(req\)[\s\S]{0,200}?unauthenticated/.test(deleteRoute),
  true
);
check(
  "the delete route rejects a cross-site request",
  /requireSameOrigin\(req\)/.test(deleteRoute) && /bad_origin/.test(deleteRoute),
  true
);
check(
  "the delete route is rate limited",
  /new RateLimitBuckets\(\)/.test(deleteRoute) && /deletionAttempts\.take\(/.test(deleteRoute),
  true
);
check(
  "the handle must be typed back, and the '@' is tolerated",
  /confirmHandle[\s\S]{0,120}?replace\(\/\^@\//.test(deleteRoute) && /handle_mismatch/.test(deleteRoute),
  true
);
check(
  "the account PASSWORD is re-verified — the cookie alone is not enough",
  /verifyPassword\(body\.password,\s*record\.passwordHash\)/.test(deleteRoute) &&
    /bad_password/.test(deleteRoute),
  true
);
check(
  "the session cookie is expired by the response",
  /res\.cookies\.set\(SESSION_COOKIE,\s*""[\s\S]{0,120}?maxAge:\s*0/.test(deleteRoute),
  true
);
check(
  "the delete response is never cached",
  /no-store/.test(deleteRoute),
  true
);

/* ------------------------- 8. the export route ------------------------- */

check(
  "the export route requires a session",
  /getSessionUser\(req\)[\s\S]{0,200}?unauthenticated/.test(exportRoute),
  true
);
check(
  "the export route is rate limited per account",
  /exportAttempts\.take\(`export:\$\{user\.id\}`/.test(exportRoute),
  true
);
check(
  "the export is delivered as a download, not rendered in a tab",
  /Content-Disposition[\s\S]{0,60}?attachment;\s*filename=/.test(exportRoute),
  true
);
check(
  "the export response is never cached",
  /no-store/.test(exportRoute),
  true
);

/* --------------------- 9. the export carries no secrets ---------------- */

check(
  "the export never serialises the password hash",
  /passwordHash/.test(lifecycle),
  false
);
check(
  "the export never serialises the wrapped private key backup",
  /identityKeyBackup/.test(lifecycle),
  false
);
check(
  "the export never serialises a token hash",
  /tokenHash/.test(lifecycle),
  false
);
check(
  "the export states what it omits, so it is never mistaken for complete",
  /EXPORT_OMISSIONS/.test(lifecycle) && /omissions:\s*EXPORT_OMISSIONS/.test(lifecycle),
  true
);
check(
  "the export is versioned and capped",
  /"cloak-account-export\/1"/.test(lifecycle) &&
    /EXPORT_MESSAGE_CAP\s*=\s*\d{3,}/.test(lifecycle) &&
    /messagesTruncated/.test(lifecycle),
  true
);

/* ------------- 10. the client purges ONLY this account ----------------- */

check(
  "the store purges the account's own cache rows, not the whole origin",
  /clearLocalCacheForOwner\(user\.id\)/.test(store),
  true
);
check(
  "the store does NOT use the device-wide Dagger wipe for account deletion",
  /destroyCryptoKeys\(\)/.test(store) || /clearSensitiveStorage\(\)/.test(store),
  false
);
check(
  "the store forgets only this account's identity keys",
  /forgetLocalIdentity\(user\.id\)/.test(store) && /export function forgetLocalIdentity/.test(orchestrator),
  true
);
check(
  "the store forgets only this account's vault key",
  /forgetVaultKey\(user\.id\)/.test(store) && /export function forgetVaultKey/.test(vault),
  true
);
check(
  "a failed local purge cannot block the exit after the server erasure",
  /try\s*\{[\s\S]{0,220}?clearLocalCacheForOwner\(user\.id\)[\s\S]{0,220}?\}\s*catch/.test(store),
  true
);
check(
  "the account-scoped purge filters on ownerUserId across every store",
  /row\.ownerUserId === ownerUserId/.test(localDb) &&
    /STORE_OUTBOX/.test(localDb.slice(at(localDb, "clearLocalCacheForOwner"))),
  true
);
check(
  "the account-scoped purge does NOT reuse the whole-store clear",
  /clearStore\(storeName\)/.test(localDb.slice(at(localDb, "clearLocalCacheForOwner"))),
  false
);

/* --------------------------- 11. the UI -------------------------------- */

check(
  "the account section wires both lifecycle actions",
  /exportAccountData\)/.test(settings) && /s\.deleteAccount\)/.test(settings),
  true
);
check(
  "the delete dialog requires the handle to match before it can submit",
  /const matches = handle\.length > 0 && typed === handle\.toLowerCase\(\)/.test(settings) &&
    /const canSubmit = matches && password\.length > 0/.test(settings),
  true
);
check(
  "the delete dialog asks for the password as well as the handle",
  /autoComplete="current-password"/.test(settings) && /Type[\s\S]{0,80}?to confirm/.test(settings),
  true
);
check(
  "the destructive control is styled as destructive and says it is permanent",
  /Delete forever/.test(settings) && /cloak-danger/.test(settings),
  true
);

/* --------------------------- 12. cache busting ------------------------- */

check("the service worker version was bumped for the new client bundle", /cloak-shell-v50/.test(sw), true);

/* ------------------------------- report ----------------------------- */

let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`PASS  ${c.label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.label}  (${c.detail})`);
  }
}
console.log(`\n=== ${checks.length - failed}/${checks.length} account-lifecycle checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
