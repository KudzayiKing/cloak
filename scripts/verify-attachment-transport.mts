/*
 * Guards the attachment transport.
 *
 * The defect this exists to prevent shipped and was reported by the owner:
 * a voice note played on the sender's device but reached the recipient as a
 * grey, silent bubble, because attachment bytes lived ONLY in the recording
 * device's IndexedDB and just metadata travelled. Every check in
 * `verify-voice-notes.mts` passed while that was true — the feature was wired,
 * the waveform was themed, the clock was shared. What was missing was a way for
 * the bytes to leave the device.
 *
 * Five contracts, each of which can regress independently:
 *
 *  1. The payload is ENCRYPTED, in its own HKDF domain, bound to the attachment
 *     id — so the server holds ciphertext and a blob cannot be replayed as
 *     another blob's, nor opened with a body key.
 *  2. The server stores CIPHERTEXT ONLY. No route, column, or log may hold
 *     plaintext; the size check must be on bytes, not on a decoded string.
 *  3. Authorization is MEMBERSHIP, folded into the query so a non-member cannot
 *     even learn whether an id exists.
 *  4. Send order is UPLOAD THEN BODY, because the body carries the crypto
 *     envelope the recipient needs; the reverse would ship an unopenable note.
 *  5. Playback resolves LOCAL FIRST then remote, and never re-fetches on a poll.
 *
 * Run: node_modules/.bin/tsx scripts/verify-attachment-transport.mts
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
   defects being asserted against — a comment quoting `microphone=()` or
   `store.put(record)` would otherwise satisfy a check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schema = stripComments(read("prisma/schema.prisma"));
const e2ee = stripComments(read("src/lib/crypto/e2ee.ts"));
const remote = stripComments(read("src/lib/cloak/attachment-remote.ts"));
const storage = stripComments(read("src/lib/cloak/attachment-storage.ts"));
const store = stripComments(read("src/stores/cloak-store.ts"));
const bubble = stripComments(read("src/components/cloak/messaging/message-bubble.tsx"));
const composer = stripComments(read("src/components/cloak/messaging/message-composer.tsx"));
const limits = stripComments(read("src/lib/cloak/attachments.ts"));
const uploadRoute = stripComments(
  read("src/app/api/conversations/[id]/attachments/route.ts")
);
const downloadRoute = stripComments(read("src/app/api/attachments/[id]/route.ts"));

/* ------------------- 1. encryption, in its own domain ------------------- */

check(
  "blobs get a distinct HKDF domain from message bodies",
  /HKDF_BLOB_INFO_PREFIX\s*=\s*"cloak\/blob\/"/.test(e2ee),
  true
);
check(
  "the blob AAD binds the conversation AND the attachment id",
  /function blobAad[\s\S]{0,200}?\$\{conversationId\}\|blob\|\$\{attachmentId\}/.test(e2ee),
  true
);
check("encryptBlob is implemented", /export async function encryptBlob/.test(e2ee), true);
check("decryptBlob is implemented", /export async function decryptBlob/.test(e2ee), true);
check(
  "a blob key is derived per blob, not the root used directly",
  /deriveBlobKeyRaw/.test(e2ee),
  true
);
check(
  "a malformed blob envelope is rejected rather than half-honoured",
  /export function parseBlobEnvelope/.test(e2ee),
  true
);

/* ------------------- 2. the server stores ciphertext only ---------------- */

check(
  "the schema has an AttachmentBlob model",
  /model AttachmentBlob \{/.test(schema),
  true
);
check(
  "the payload column is Bytes, i.e. ciphertext",
  /ciphertext\s+Bytes/.test(schema),
  true
);
check(
  "there is no plaintext column on the blob model",
  /\b(plaintext|payload|data|content)\s+Bytes/.test(schema),
  false
);
check(
  "blobs cascade with their conversation",
  /model AttachmentBlob \{[\s\S]{0,400}?onDelete: Cascade/.test(schema),
  true
);
check(
  "the upload stores the bytes it received",
  /ciphertext:\s*Buffer\.from\(bytes\)/.test(uploadRoute),
  true
);
check(
  "the size cap is measured on real bytes",
  /bytes\.byteLength > MAX_ATTACHMENT_BYTES/.test(uploadRoute),
  true
);
check(
  "an oversized payload is refused with 413",
  /"too_large"[^}]*\}\s*,\s*\{\s*status:\s*413\s*\}/.test(uploadRoute),
  true
);
check(
  "the upload never upserts (a guessed id cannot overwrite a blob)",
  /\.upsert\(/.test(uploadRoute),
  false
);
check(
  "an id collision is a conflict, not an overwrite",
  /P2002[\s\S]{0,200}?"duplicate_attachment"[\s\S]{0,80}?409/.test(uploadRoute),
  true
);

/* ---------------------- 3. authorization is membership ------------------- */

check(
  "the upload requires active participation",
  /participations:\s*\{\s*some:\s*\{\s*userId:\s*user\.id,\s*removedAt:\s*null/.test(uploadRoute),
  true
);
check(
  "the download authorizes inside the query, not after it",
  /findFirst\(\{[\s\S]{0,300}?conversation:\s*\{\s*participations:\s*\{\s*some:/.test(
    downloadRoute
  ),
  true
);
check(
  "an unauthorized caller gets 404, not 403 (no existence oracle)",
  /"not_found"[\s\S]{0,60}?status:\s*404/.test(downloadRoute),
  true
);
check(
  "the download is never cached",
  /"Cache-Control":\s*"private, no-store"/.test(downloadRoute),
  true
);
check(
  "expired blobs are treated as absent",
  /expiresAt:\s*\{\s*gt:\s*new Date\(\)/.test(downloadRoute),
  true
);
check(
  "a lazy purge keeps the table from growing without bound",
  /purgeExpiredAttachments/.test(limits) && /deleteMany/.test(limits),
  true
);

/* --------------------- 4. send order: upload, then body ------------------ */

check(
  "the store uploads the payload before encrypting the body",
  /uploadAttachmentBlob\([\s\S]{0,600}?encryptBody\(/.test(store),
  true
);
check(
  "the travelling envelope gains the crypto envelope on success",
  /withBlobEnvelope\(saved\.envelope, upload\.blobEnvelope\)/.test(store),
  true
);
check(
  "a failed upload degrades to metadata-only instead of losing the message",
  /transferFailed\s*=\s*true/.test(store),
  true
);
check(
  "the confirmed message's blob wins over the pre-upload optimistic one",
  /attachmentBlob:\s*confirmed\.attachmentBlob/.test(store),
  true
);
check(
  "the sender is told when the transfer failed",
  /attachmentTransferFailed/.test(store) && /attachmentTransferFailed/.test(bubble),
  true
);

/* --------------------- 5. playback: local first, then remote ------------- */

check(
  "playback tries the local cache before the network",
  /getLocalAttachment\(attachmentId, message\.conversationId\)[\s\S]{0,400}?fetchAttachmentBlob/.test(
    bubble
  ),
  true
);
check(
  "one resolver serves both the voice player and the file/image bubble",
  (bubble.match(/resolveAttachmentBlob\(/g) ?? []).length >= 3,
  true
);
check(
  "downloaded blobs are cached so a poll does not re-download",
  /attachmentBlobCache\.set\(/.test(bubble),
  true
);
check(
  "the cache is bounded",
  /attachmentBlobCache\.size > 40/.test(bubble),
  true
);
check(
  "the player effect is keyed on primitives, not on the rebuilt message object",
  /\[message\.attachmentId, message\.conversationId, message\.attachmentBlob\?\.k\]/.test(bubble),
  true
);
check(
  "the recipient is no longer told the audio lives on the sender's device",
  /Stored on sender device/.test(bubble),
  false
);
check(
  "the player still reports an unavailable payload honestly",
  /Audio isn't available/.test(bubble),
  true
);

/* -------------------- the local store is not an open door ---------------- */

check(
  "getLocalAttachment requires a conversation id",
  /export async function getLocalAttachment\(\s*id: string,\s*conversationId: string/.test(storage),
  true
);
check(
  "a record from another conversation is refused",
  /record\.conversationId !== conversationId/.test(storage),
  true
);
check(
  "the envelope round-trips the crypto envelope",
  /parseBlobEnvelope\(parsed\.blob\)/.test(storage),
  true
);

/* -------------------- size: the cap must be affordable ------------------- */

check(
  "recording bitrate is pinned so a long note fits the cap",
  /audioBitsPerSecond:\s*VOICE_BITS_PER_SECOND/.test(composer),
  true
);
check(
  "the bitrate is 32 kbps, transparent for speech",
  /VOICE_BITS_PER_SECOND\s*=\s*32_000/.test(composer),
  true
);

/* ------------------------------- report --------------------------------- */

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.label}${c.pass ? "" : `  (${c.detail})`}`);
}
console.log(`\n=== ${checks.length - failed}/${checks.length} attachment-transport checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
