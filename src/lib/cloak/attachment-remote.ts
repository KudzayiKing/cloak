"use client";

/*
 * Remote attachment transport.
 *
 * Attachment bytes used to live only in the recording device's IndexedDB, so a
 * recipient could be told a note's duration and nothing else. This module is the
 * missing half: it seals the blob under the conversation key and moves the
 * CIPHERTEXT through the API, so the server relays a payload it cannot read.
 *
 * The key is derived on the client (see `encryptBlob`); nothing here sends key
 * material, and the server has no column that could hold plaintext.
 *
 * The attachment id is minted BEFORE encryption because the AAD binds it — the
 * id has to exist before the ciphertext does, which is why the upload route
 * takes it as a header rather than assigning it.
 */

import { decryptBlob, encryptBlob, type BlobEnvelope } from "@/lib/crypto/e2ee";
import { currentKeyVersion, getConversationKeyRaw } from "@/lib/crypto/e2ee-orchestrator";

export type UploadResult =
  | { ok: true; blobEnvelope: BlobEnvelope }
  | { ok: false; error: string };

/**
 * Seal `file` under the conversation key and store the ciphertext.
 *
 * Returns the crypto envelope (version + key id + iv) that the recipient needs
 * alongside the id — those three fields ride inside the encrypted message body,
 * so they never travel in the clear.
 */
export async function uploadAttachmentBlob(params: {
  conversationId: string;
  attachmentId: string;
  file: Blob;
}): Promise<UploadResult> {
  const { conversationId, attachmentId, file } = params;

  /* The key must already be in memory: the caller syncs/wait-for-keys first,
     because a silent re-derivation here would race the message body's key. */
  const rootRaw = getConversationKeyRaw(conversationId);
  if (!rootRaw) return { ok: false, error: "no_conversation_key" };

  const version = currentKeyVersion(conversationId);
  let sealed: { envelope: BlobEnvelope; ciphertext: Uint8Array<ArrayBuffer> };
  try {
    sealed = await encryptBlob(rootRaw, version, await file.arrayBuffer(), conversationId, attachmentId);
  } catch {
    return { ok: false, error: "encrypt_failed" };
  }

  let res: Response;
  try {
    res = await fetch(`/api/conversations/${conversationId}/attachments`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-cloak-attachment-id": attachmentId,
        "x-cloak-key-version": String(version),
      },
      body: sealed.ciphertext,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (!res.ok) return { ok: false, error: `upload_${res.status}` };
  const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!data?.ok) return { ok: false, error: "upload_rejected" };

  return { ok: true, blobEnvelope: sealed.envelope };
}

export type DownloadResult = { ok: true; blob: Blob } | { ok: false; error: string };

/**
 * Fetch the ciphertext for `attachmentId` and open it with the conversation key
 * at the version the sender sealed it under (not necessarily the current one —
 * a note sent before a key rotation must still open).
 */
export async function downloadAttachmentBlob(params: {
  conversationId: string;
  attachmentId: string;
  blobEnvelope: BlobEnvelope;
  mime: string;
}): Promise<DownloadResult> {
  const { conversationId, attachmentId, blobEnvelope, mime } = params;

  const rootRaw = getConversationKeyRaw(conversationId, blobEnvelope.v);
  if (!rootRaw) return { ok: false, error: "no_conversation_key" };

  let res: Response;
  try {
    res = await fetch(`/api/attachments/${attachmentId}`, { cache: "no-store" });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok) return { ok: false, error: `download_${res.status}` };

  let plain: ArrayBuffer;
  try {
    const ciphertext = new Uint8Array(await res.arrayBuffer());
    plain = await decryptBlob(rootRaw, blobEnvelope, ciphertext, conversationId, attachmentId);
  } catch {
    /* A GCM failure here means tampering, a wrong key, or a mismatched
       attachment id — never silently fall back to playing garbage. */
    return { ok: false, error: "decrypt_failed" };
  }

  return { ok: true, blob: new Blob([plain], { type: mime || "application/octet-stream" }) };
}
