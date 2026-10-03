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
 *  6. An attachment is VISIBLE outside its own bubble: the chat list names the
 *     kind instead of rendering a blank row, and a tap on the card opens or
 *     saves with confirmation rather than doing something silent.
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
const nextConfig = read("next.config.ts");

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
/* Round 40 unified the text AND attachment send paths into postOutgoingMessage,
   so the upload / encrypt / decrypt invariants now live there (and settleOutgoing
   paints the confirmed row). The guards below point at that shared path. */

const postStart = store.indexOf("async function postOutgoingMessage");
const postEnd = store.indexOf("function toClientMessage");
const postBlock = postStart >= 0 && postEnd > postStart ? store.slice(postStart, postEnd) : "";

check(
  "the shared send path uploads the payload before encrypting the body",
  store.indexOf("uploadAttachmentBlob(") >= 0 &&
    store.indexOf("encryptBody(") > store.indexOf("uploadAttachmentBlob("),
  true
);
check(
  "the travelling envelope gains the crypto envelope on success",
  /withBlobEnvelope\(envelope, upload\.blobEnvelope\)/.test(postBlock),
  true
);
check(
  "a failed upload degrades to metadata-only instead of losing the message",
  /transferFailed\s*=\s*true/.test(store),
  true
);
check(
  "the confirmed (decrypted) message replaces the optimistic bubble",
  /replaceMessage\(\s*conversationId\s*,\s*id\s*,\s*outcome\.transferFailed/.test(store),
  true
);
/* Regression guard. `confirmed` must come from the DECRYPTION pass, not the
   synchronous toClientMessage(): the POST response body is still ciphertext,
   so parsing it yields no envelope at all — and since the confirmed blob is
   written over the optimistic one, that silently WIPES the sender's envelope
   the moment the send is confirmed. This shipped once; the probe caught it
   only because it asserted on the settled message rather than the optimistic
   one. Now in the shared send path rather than the attachment action. */
check(
  "the confirmation is decrypted, not parsed as plaintext",
  /const \[confirmed\] = await decryptServerMessages\(/.test(postBlock),
  true
);
check(
  "the shared send path never hydrates the raw ciphertext body",
  !/toClientMessage\(res\.data\.message\)/.test(postBlock),
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
  /* Order-based, not distance-based: the local lookup must simply appear
     BEFORE the remote fetch in the resolver. A character-window version of
     this broke the moment the local branch grew a decryption step, which is
     a false alarm about the very behaviour being guarded. */
  (() => {
    const localAt = bubble.indexOf("getLocalAttachment(attachmentId, message.conversationId)");
    const remoteAt = bubble.indexOf("fetchAttachmentBlob(");
    return localAt >= 0 && remoteAt >= 0 && localAt < remoteAt;
  })(),
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

/* ---------- 6. what an attachment looks like outside the thread ----------- */
/*
 * Two owner reports, both about an attachment being invisible rather than
 * broken.
 *
 * 1. The chat LIST showed a blank preview for documents and photos while voice
 *    notes read correctly. A voice note had its own `case`; everything else
 *    fell through to `last.body`, and an attachment message has no body — its
 *    metadata rides the encrypted envelope — so the row rendered empty.
 * 2. Tapping a file forced a download and said nothing, so a tap produced no
 *    feedback whether it worked or not.
 *
 * Both are asserted because both are the kind of defect that passes every
 * transport check above: the bytes move perfectly and the user still sees
 * nothing.
 */

const sidebar = stripComments(read("src/components/cloak/messaging/chat-sidebar.tsx"));

check(
  "the chat list names a document instead of rendering a blank row",
  /case "file":[\s\S]{0,200}?"Document"/.test(sidebar),
  true
);
check(
  "the chat list names a photo",
  /case "image":[\s\S]{0,200}?"Photo"/.test(sidebar),
  true
);
check(
  "the chat list still names a voice note",
  /case "voice":[\s\S]{0,200}?"Voice note"/.test(sidebar),
  true
);
check(
  "the chat list names a view-once payload",
  /case "view-once":[\s\S]{0,200}?"View-once media"/.test(sidebar),
  true
);
check(
  "the kind glyph is not drawn in Cloak Mode, where it would leak the kind",
  (() => {
    const cloakBranch = sidebar.match(/cloakMode \? \(([\s\S]{0,400}?)\) : \(/)?.[1] ?? "";
    return cloakBranch.length > 0 && !/previewIcon/.test(cloakBranch);
  })(),
  true
);

check(
  "a download confirms itself — the owner's report was that nothing did",
  /toast\(\{ title: "Download started", description: name \}\)/.test(bubble),
  true
);
check(
  "the in-chat viewer opens for anything we can render, not just photos",
  /if \(rendersInChat\) \{\s*setViewerOpen\(true\);/.test(bubble) && /role="dialog"/.test(bubble),
  true
);
check(
  "the viewer draws an image as an image and text as text",
  /kind === "image" \? \(/.test(bubble) && /<pre[\s\S]{0,400}?\{inlineText\}/.test(bubble),
  true
);
check(
  "the viewer is portalled, so a scrolling ancestor cannot capture it",
  /createPortal\(/.test(bubble),
  true
);
/*
 * The trap this guard exists for.
 *
 * The obvious way to preview a PDF is an `<iframe src={blobUrl}>`. It CANNOT
 * work here: next.config.ts sets `frame-src 'none'` and `object-src 'none'`, so
 * the browser refuses to load the frame and renders "This content is blocked"
 * instead — for a same-origin blob URL exactly as much as for a remote page.
 * That is deliberate hardening on a privacy product, so the answer is to render
 * what we can ourselves and hand the rest to the browser's own viewer, never to
 * loosen the policy for a preview.
 */
check(
  "the CSP still forbids framing anything",
  /"frame-src 'none'"/.test(nextConfig) && /"object-src 'none'"/.test(nextConfig),
  true
);
check(
  "so the attachment viewer does not pretend an iframe can render a file",
  /<iframe/.test(bubble),
  false
);
check(
  "a text payload is read out of its blob, not framed",
  /fetch\(url\)[\s\S]{0,120}?\.text\(\)/.test(bubble) && /MAX_INLINE_TEXT_BYTES/.test(bubble),
  true
);
check(
  "a PDF goes to the browser's own viewer in a tab",
  /if \(opensInBrowser\) \{\s*openInBrowserTab\(\)/.test(bubble) &&
    /ExternalLinkIcon/.test(bubble),
  true
);
check(
  "a blocked pop-up is reported rather than swallowed",
  /if \(!window\.open\(url, "_blank", "noopener,noreferrer"\)\)/.test(bubble) &&
    /"Pop-up blocked"/.test(bubble),
  true
);
check(
  "only payloads a browser can actually render are offered as openable",
  /canPreviewHere\(name, message\.attachmentMime\)/.test(bubble),
  true
);
check(
  "the card itself is the open target, not just the small icon",
  /`Open \$\{name\}`/.test(bubble) &&
    /className="flex min-w-0 flex-1 items-center gap-3 text-left/.test(bubble),
  true
);
check(
  "a payload with no in-browser viewer is offered as Save, not Open",
  /`Save \$\{name\} to this device`/.test(bubble),
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
