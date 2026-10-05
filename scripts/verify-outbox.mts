/*
 * Guards the offline outbox.
 *
 * What this exists to prevent — the failure modes of "just retry the send":
 *
 *  1. DUPLICATE SENDS. A send that TIMES OUT is the dangerous case: the request
 *     may have committed on the server and we simply never saw the response. A
 *     blind retry duplicates the message. The fix is an idempotency key the
 *     client mints once and the route honours on replay — so a repeat returns
 *     the ORIGINAL message instead of creating a second. This is the whole
 *     reason the outbox gets its own round.
 *
 *  2. A KEY IS NOT A SECRET. A guessed clientKey must never hand back another
 *     conversation's or another author's message, so the replay verifies the row
 *     it finds belongs to the same conversation AND author, and a mismatch is a
 *     409 — not a successful replay.
 *
 *  3. ENCRYPT AT FLUSH, NOT AT ENQUEUE. A conversation-key version can be
 *     retired by forward secrecy while a message waits in the queue, and a body
 *     encrypted under a retired version is unopenable by anyone. So the queue
 *     holds vault-sealed plaintext and the conversation key is applied only at
 *     send time. The outbox must use its OWN vault scope, distinct from the
 *     cache's message scope, or a stale cache write and a pending send collide.
 *
 *  4. THE OUTBOX IS NOT A CACHE. Cached content has a server copy; an outbox row
 *     exists nowhere else. "Clear saved data" must therefore NOT drop it, or the
 *     user's unwritten words vanish. (Dagger's panic wipe still takes it.)
 *
 *  5. FIFO PER CONVERSATION, HEAD-OF-LINE BLOCKING. The server stamps createdAt
 *     at insert; skipping ahead would invert send order. A blocked message
 *     stalls only its own conversation.
 *
 *  6. QUEUED IS A DISTINCT, NON-ERROR STATE with a real retry behind it; not the
 *     old "failed — tap to retry" lie that did nothing.
 *
 *  7. SOMETHING DRAINS THE QUEUE: the `online` event, the `visibilitychange`
 *     event, and a successful sync tick. A queue nothing drains is just a leak.
 *
 *  8. QUEUED MESSAGES SURVIVE A RELOAD: they are re-painted from the outbox on
 *     bootstrap, keyed by clientKey so they are never doubled.
 *
 * Run: node_modules/.bin/tsx scripts/verify-outbox.mts
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
   defects being asserted against — a comment quoting `break` or
   `clearStore(STORE_OUTBOX)` would otherwise satisfy a check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const route = stripComments(read("src/app/api/conversations/[id]/messages/route.ts"));
const outbox = stripComments(read("src/lib/cloak/outbox.ts"));
const vault = stripComments(read("src/lib/crypto/local-vault.ts"));
const db = stripComments(read("src/lib/cloak/local-db.ts"));
const types = stripComments(read("src/lib/cloak/types.ts"));
const store = stripComments(read("src/stores/cloak-store.ts"));
const bubble = stripComments(read("src/components/cloak/messaging/message-bubble.tsx"));
const sync = stripComments(read("src/hooks/use-server-sync.ts"));
const dagger = stripComments(read("src/lib/cloak/dagger.ts"));
const schema = stripComments(read("prisma/schema.prisma"));
const migration = read("prisma/migrations/20261002160200_outbox_client_key/migration.sql");

/* ------------ 1. the idempotency key: bounded + replayed --------------- */

check(
  "the idempotency key is bounded and character-restricted",
  /clientKey:\s*z[\s\S]{0,120}?\.string\(\)[\s\S]{0,120}?\.min\(8\)[\s\S]{0,160}?\.max\(64\)[\s\S]{0,160}?\.regex\(\/\^\[A-Za-z0-9_-\]\+\$\/\)[\s\S]{0,120}?\.optional\(\)/.test(
    route
  ),
  true
);
check(
  "the route looks up an existing send by key BEFORE creating",
  /findUnique\(\{\s*where:\s*\{\s*clientKey\s*\}/.test(route),
  true
);
check(
  "a replay returns the original message, not a duplicate",
  /replayed:\s*true/.test(route) && /mapMessage\(\s*existing/.test(route),
  true
);
check(
  "a lost create race (P2002 on the key) is caught and replayed",
  /isClientKeyCollision\(error\)/.test(route) &&
    /if \(!isClientKeyCollision\(error\)\) throw error;/.test(route),
  true
);
check(
  "the unique index lives on the model",
  /clientKey\s+String\?\s+@unique/.test(schema),
  true
);
check(
  "the migration adds the unique index",
  /CREATE UNIQUE INDEX "Message_clientKey_key" ON "Message"\("clientKey"\)/.test(migration),
  true
);

/* ----- 2. a key is not a secret: scope + mismatch rejection --------- */

check(
  "a key reused in another conversation or by another author is a 409",
  /client_key_conflict"[\s\S]{0,90}?status:\s*409/.test(route),
  true
);
check(
  "the replay verifies the row belongs to this conversation",
  /existing\.conversationId !== conversationId/.test(route),
  true
);
check(
  "the replay verifies the row belongs to this author",
  /existing\.authorId !== user\.id/.test(route),
  true
);

/* -------- 3. encrypt at flush, not at enqueue; own vault scope ------- */

check(
  "the outbox seals plaintext under the VAULT key, not the conversation key",
  /sealLocalText\(input\.plaintext,\s*vaultScope\.outbox\(input\.id\)\)/.test(outbox),
  true
);
check(
  "the outbox never seals with the cache's message scope",
  !/vaultScope\.message\(/.test(outbox),
  true
);
check(
  "the outbox vault scope is distinct from the message scope",
  /outbox:\s*\(clientKey: string\) => `out\|\$\{clientKey\}`/.test(vault) &&
    /message:\s*\(messageId: string\) => `msg\|\$\{messageId\}`/.test(vault),
  true
);
check(
  "the shared send path encrypts with the conversation key at SEND time",
  /encryptBody\(conversationId,\s*plaintext,\s*kind,\s*myUserId\)/.test(store),
  true
);
check(
  "the payload is POSTed carrying the idempotency key",
  /JSON\.stringify\(\{\s*body:\s*encrypted,\s*kind,\s*clientKey\s*\}\)/.test(store),
  true
);
check(
  "the client key doubles as the optimistic message id",
  /const id = newClientKey\(\);/.test(store) && /clientKey:\s*id/.test(store),
  true
);

/* -------- 4. the outbox is NOT cleared by "clear saved data" -------- */

const localCacheBlock = db.slice(db.indexOf("clearLocalCache"), db.indexOf("clearOutbox"));
check(
  "clearing saved data clears the three cache stores",
  /clearStore\(STORE_MESSAGES\)/.test(localCacheBlock) &&
    /clearStore\(STORE_ATTACHMENTS\)/.test(localCacheBlock) &&
    /clearStore\(STORE_CONVERSATIONS\)/.test(localCacheBlock),
  true
);
check(
  "clearing saved data does NOT drop the outbox (the only copy of unwritten words)",
  !/STORE_OUTBOX/.test(localCacheBlock),
  true
);
check("a separate outbox clear exists for Dagger/panic wipe", /export async function clearOutbox/.test(db), true);
check(
  "the outbox lives in the cloak- database so Dagger's panic wipe removes it",
  /DB_NAME = "cloak-/.test(db) && /name\.startsWith\("cloak-"\)/.test(dagger),
  true
);
check("the database is at version 3 (outbox added v2 -> v3)", /DB_VERSION = 3/.test(db), true);
check(
  "the upgrade creates the outbox store",
  /createObjectStore\(STORE_OUTBOX/.test(db),
  true
);

/* ---------- 5. FIFO per conversation, head-of-line blocking --------- */

const flushBlock = store.slice(
  store.indexOf("export async function flushOutbox"),
  store.indexOf('if (typeof window !== "undefined")')
);
check(
  "the flush reads the queue and groups it by conversation",
  /const entries = await listOutbox\(\)/.test(flushBlock) &&
    /byConversation/.test(flushBlock),
  true
);
check(
  "a retryable send blocks the rest of its conversation (head-of-line)",
  /* The retryable branch must break the inner per-conversation loop, so a
     later message cannot land before the one the user typed first. */
  /bumpOutboxAttempt\(entry\.id\);[\s\S]{0,120}?break;/.test(flushBlock),
  true
);
check(
  "the queue is ordered FIFO by enqueue time",
  /sort\(\(a, b\) => a\.queuedAt - b\.queuedAt/.test(outbox),
  true
);
check(
  "a sent entry leaves the queue",
  /await deleteOutboxEntry\(entry\.id\)/.test(flushBlock),
  true
);

/* --------------- 6. queued is a distinct, non-error state ----------- */

check(
  "the message status type includes 'queued'",
  /MessageStatus = "sending" \| "queued" \| "sent"/.test(types),
  true
);
check(
  "a retryable outcome is held as 'queued', not dropped as 'failed'",
  /setMessageStatus\(conversationId,\s*id,\s*"queued"\)/.test(store),
  true
);
check(
  "the bubble renders 'queued' as a non-error affordance",
  /status === "queued"/.test(bubble) && /"queued"/.test(bubble),
  true
);
check(
  "the bubble offers a real retry on 'failed'",
  /status === "failed"/.test(bubble) && /failed — tap to retry/.test(bubble),
  true
);
check(
  "the retry button drives the store's retryMessage",
  /retryMessage\(message\.conversationId,\s*message\.id\)/.test(bubble),
  true
);
check(
  "retryMessage exists and re-uses the same clientKey",
  /retryMessage:\s*async \(conversationId, messageId\)/.test(store) &&
    /clientKey:\s*messageId/.test(store),
  true
);

/* --------------------- 7. something drains it ---------------------- */

check(
  "the connection-restore event drains the queue",
  /window\.addEventListener\("online",\s*\(\) => void flushOutbox\(\)\)/.test(store),
  true
);
check(
  "returning to a foregrounded tab drains the queue",
  /visibilitychange'[\s\S]{0,200}?void flushOutbox\(\)/.test(store) ||
    /document\.addEventListener\("visibilitychange"[\s\S]{0,200}?void flushOutbox\(\)/.test(store),
  true
);
check(
  "a successful sync tick drains the queue",
  (sync.match(/if \(tickOk\) void flushOutbox\(\);/g) ?? []).length >= 1,
  true
);

/* ----------- 8. queued messages survive a reload ------------------- */

const hydrateBlock = store.slice(
  store.indexOf("hydrateLocalCache: async"),
  store.indexOf("mergeConversationList: async")
);
check(
  "bootstrap re-paints pending sends from the outbox",
  /const pending = await listOutbox\(\);/.test(hydrateBlock),
  true
);
check(
  "re-painted sends retain queued or Nearby-delivered state",
  /status:\s*entry\.nearbyDelivered\s*\?\s*"delivered" as MessageStatus\s*:\s*"queued" as MessageStatus/.test(hydrateBlock),
  true
);
check(
  "re-painted sends are keyed by clientKey so they are not doubled",
  /known\.has\(m\.id\)/.test(hydrateBlock),
  true
);

/* ---------------- 9. a timeout is retried, an error is not --------- */

check(
  "a timeout/network/5xx is classified retryable (safe only because of the key)",
  /if \(status === 0\) return "retryable"[\s\S]{0,200}?return "retryable";/.test(store) &&
    /return "permanent";/.test(store),
  true
);

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
console.log(`\n=== ${checks.length - failed}/${checks.length} outbox checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
