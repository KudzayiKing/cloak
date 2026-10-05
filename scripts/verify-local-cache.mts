/*
 * Guards the local-first cache.
 *
 * What this exists to prevent:
 *
 *  1. A cache that ROTS. Conversation keys are versioned and, under forward
 *     secrecy, deliberately destroyed — so anything cached in conversation-key
 *     form becomes permanently unopenable. Everything must be sealed under a
 *     device vault key that never rotates.
 *  2. A cache that LEAKS ACROSS ACCOUNTS. The database is keyed by origin while
 *     one install may serve several accounts, so every row must carry its owner
 *     and every read must filter on it.
 *  3. A cache that BREAKS DAGGER. `clearIndexedDB()` only removes databases
 *     named `cloak-*`, and `destroyCryptoKeys()` only removes known key
 *     prefixes — miss either and a panic wipe leaves the whole history behind.
 *  4. A cache that DEFEATS DISAPPEARING MESSAGES by keeping rows the server
 *     purged, or that stores the body in the clear.
 *  5. A cache that takes the messages down with it: an unbounded media store
 *     eventually trips the origin quota, which is evicted all-or-nothing.
 *
 * Run: node_modules/.bin/tsx scripts/verify-local-cache.mts
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
   defects being asserted against — a comment quoting `body: message.body`
   would otherwise satisfy a check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const vault = stripComments(read("src/lib/crypto/local-vault.ts"));
const db = stripComments(read("src/lib/cloak/local-db.ts"));
const msgCache = stripComments(read("src/lib/cloak/message-cache.ts"));
const convCache = stripComments(read("src/lib/cloak/conversation-cache.ts"));
const attachments = stripComments(read("src/lib/cloak/attachment-storage.ts"));
const constants = stripComments(read("src/lib/cloak/attachment-constants.ts"));
const limits = stripComments(read("src/lib/cloak/attachments.ts"));
const store = stripComments(read("src/stores/cloak-store.ts"));
const bubble = stripComments(read("src/components/cloak/messaging/message-bubble.tsx"));
const dagger = stripComments(read("src/lib/cloak/dagger.ts"));
const settings = stripComments(read("src/components/cloak/settings/settings-page.tsx"));
const sw = stripComments(read("public/sw.js"));

/* ------------- 1. the vault key: never rotates, per account -------------- */

check(
  "the vault key is scoped per account",
  /cloak-vault-\$\{userId\}/.test(vault),
  true
);
check(
  "the vault key carries no version, so it cannot rotate away",
  /cloak-vault-v/.test(vault),
  false
);
check(
  "the vault AAD binds both the account and the record",
  /\$\{vaultUserId \?\? ""\}\|\$\{scope\}/.test(vault),
  true
);
check(
  "sealing is AES-GCM with the AAD attached",
  /name: "AES-GCM"[\s\S]{0,200}?additionalData: aad\(scope\)/.test(vault),
  true
);
check(
  "the vault key is imported non-extractable",
  /importKey\(\s*"raw",[\s\S]{0,120}?false,/.test(vault),
  true
);
check(
  "a key that could not be persisted is refused, not handed out",
  /localStorage\.setItem\(LS_VAULT\(userId\), rawB64\)[\s\S]{0,200}?return null;/.test(vault),
  true
);
check(
  "a failed decrypt returns null rather than falling back to plaintext",
  /decrypt\([\s\S]{0,400}?catch \{[\s\S]{0,200}?return null;/.test(vault),
  true
);
check("the store publishes the signed-in account", /setVaultUser/.test(store), true);
check(
  "the vault key follows every auth transition, not one path",
  /useCloakStore\.subscribe/.test(store),
  true
);

/* --------------- 2. the database, and Dagger's reach into it -------------- */

check(
  "the cache database keeps the cloak- prefix so Dagger covers it",
  /DB_NAME = "cloak-/.test(db),
  true
);
check("the schema is at version 3", /DB_VERSION = 3/.test(db), true);
check(
  "the upgrade creates attachments, messages and conversations",
  ["STORE_ATTACHMENTS", "STORE_MESSAGES", "STORE_CONVERSATIONS"].every((name) =>
    new RegExp(`createObjectStore\\(${name}`).test(db)
  ),
  true
);
check(
  "a held connection releases on versionchange so a future upgrade cannot hang",
  /onversionchange/.test(db),
  true
);
check(
  "clearing local data clears every store",
  /clearLocalCache[\s\S]{0,400}?clearStore\(STORE_CONVERSATIONS\)/.test(db),
  true
);
check(
  "persistent storage is requested, so the origin is less likely to be evicted",
  /navigator\.storage\?\.persist/.test(db),
  true
);
check(
  "Dagger destroys the vault key",
  /cloak-vault-/.test(dagger),
  true
);
check(
  "Dagger also drops the in-memory vault key",
  /wipeVaultMemory\(\)/.test(dagger),
  true
);

/* -------------------- 3. account scoping (no cross-account) --------------- */

check(
  "cached messages carry the owning account",
  /const row: CachedMessageRow = \{[\s\S]{0,300}?ownerUserId/.test(msgCache),
  true
);
check(
  "cached conversations carry the owning account",
  /const row: CachedConversationRow = \{[\s\S]{0,300}?ownerUserId/.test(convCache),
  true
);
check(
  "message reads filter by the owning account",
  /row\.ownerUserId === ownerUserId/.test(msgCache),
  true
);
check(
  "conversation reads filter by the owning account",
  /row\.ownerUserId === ownerUserId/.test(convCache),
  true
);
check(
  "attachment reads reject another account's row",
  /record\.ownerUserId !== ownerUserId/.test(attachments),
  true
);
check(
  "a write with no account published is refused, not stored unattributed",
  /if \(!ownerUserId\) return;/.test(msgCache),
  true
);

/* ------------------ 4. bodies are sealed, never stored raw ---------------- */

check(
  "message bodies are sealed before storage",
  /sealLocalText\(message\.body, vaultScope\.message\(message\.id\)\)/.test(msgCache),
  true
);
check(
  "the stored row never carries a plaintext body",
  /body: message\.body/.test(msgCache),
  false
);
check(
  "an unopenable body surfaces as locked rather than blank",
  /bodyLocked: true,[\s\S]{0,80}?bodyLockedReason/.test(msgCache),
  true
);
check(
  "attachment bytes are sealed under the vault key",
  /sealLocal\(bytes, vaultScope\.attachment\(id\)\)/.test(attachments),
  true
);
check(
  "a legacy plaintext row is still readable, so old notes do not break",
  /if \(record\.blob\) return record\.blob;/.test(attachments),
  true
);

/* --------------- 5. disappearing messages are honoured locally ------------ */

check(
  "expired ghost rows are deleted, not merely filtered out of the view",
  /expired\.push\(row\.id\)[\s\S]{0,400}?deleteFromStore\(STORE_MESSAGES, id\)/.test(msgCache),
  true
);
check(
  "a sweep purges expired rows at boot",
  /purgeExpiredCachedMessages/.test(msgCache),
  true
);

/* ------------- 6. the media budget, so messages survive quota ------------- */

check(
  "the media cache has a byte budget",
  /ATTACHMENT_CACHE_BUDGET_BYTES = /.test(attachments),
  true
);
check(
  "eviction takes server-servable rows first, protecting the unrecoverable",
  /refetchablePass of \[true, false\]/.test(attachments),
  true
);
check(
  "eviction is least-recently-used",
  /lastUsedAt \?\? r\.createdAt/.test(attachments),
  true
);
check(
  "reads record usage so eviction can tell hot from cold",
  /touchLocalAttachment/.test(attachments),
  true
);

/* ------------------------ 7. the client-side paths ------------------------ */

check(
  "received media is cached for offline playback",
  /cacheReceivedAttachment\(/.test(bubble),
  true
);
check(
  "the local copy is opened through the vault, not read as a raw blob",
  /openLocalAttachment\(local\)/.test(bubble),
  true
);
check(
  "messages are cached BEFORE hydration blanks the attachment envelope",
  /cacheable\.push\(decrypted\)[\s\S]{0,80}?hydrateAttachmentMessage\(decrypted\)/.test(store),
  true
);
check(
  "the server window merges over cached history instead of replacing it",
  /existingById/.test(store),
  true
);
check(
  "cached conversations are written back",
  /cacheConversations\(/.test(store),
  true
);
check(
  "saved history paints before the server answers",
  /hydrateLocalCache/.test(store),
  true
);
check(
  "sign-out drops the cached write state",
  /forgetCachedSignatures\(\)/.test(store),
  true
);

/* --------------------------- 8. the off switch ---------------------------- */

check(
  "settings can clear saved data",
  /clearLocalCache\(\)/.test(settings),
  true
);
check(
  "clearing also drops the write-dedupe state, so data is not silently restored",
  /clearLocalCache\(\)[\s\S]{0,300}?forgetCachedSignatures\(\)/.test(settings),
  true
);
check(
  "the placeholder storage figures are gone",
  /4\.2 MB|12\.8 MB/.test(settings),
  false
);

/* ---------------------- 9. the dependency boundary ------------------------ */

check(
  "the shared limits module pulls in no database client",
  /prisma|@\/lib\/db/.test(constants),
  false
);
check(
  "the server limits module still re-exports them for existing imports",
  /export \{[\s\S]{0,200}?MAX_ATTACHMENT_BYTES/.test(limits),
  true
);

/* ---------------------------- 10. shell version --------------------------- */

check(
  "the service worker version was bumped for the new client bundle",
  /cloak-shell-v49/.test(sw),
  true
);

/* -------------------------------- report ---------------------------------- */

let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`PASS  ${c.label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.label}  (${c.detail})`);
  }
}
console.log(`\n=== ${checks.length - failed}/${checks.length} local-cache checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
