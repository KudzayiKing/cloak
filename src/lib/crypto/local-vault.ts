"use client";

/*
 * Device vault key — the at-rest key for the LOCAL CACHE.
 *
 * WHY THIS EXISTS AT ALL. Conversation keys are versioned, and when forward
 * secrecy is on, versions older than the window are DESTROYED: the local seed is
 * deleted and the server-side wrap is retired, deliberately, "so ciphertext
 * under them can never be decrypted again by ANYONE" (see `fsWindowMs` in
 * e2ee-orchestrator.ts). A cache that stored conversation-key ciphertext would
 * therefore ROT — the bytes would survive on disk but never open again, which is
 * exactly the opposite of the point.
 *
 * So nothing is written to the local cache in conversation-key form. Received
 * content is decrypted once, while the key still exists, and immediately
 * re-sealed under THIS key, which never rotates. The cache then stays readable
 * for as long as the device holds it, independently of key rotation.
 *
 * TRUST LEVEL — deliberately the same as the rest of the keyring, not stronger.
 * `cloak-identity-<userId>` already holds the identity private key and
 * `cloak-convkeys-<userId>` the raw conversation keys, both in the clear in
 * localStorage ("same trust level as the persisted session cookie", per the
 * orchestrator's own module comment). This key is stored the same way on
 * purpose. Wrapping ONLY the cache with a passphrase while the keyring beside it
 * stays readable would be security theatre: an attacker with the browser profile
 * still walks away with the conversation keys. Either accept this posture or
 * protect the whole keyring as one coherent change.
 *
 * What the separate key does buy, concretely:
 *   1. Cached content survives conversation-key retirement (above).
 *   2. The cache is OPAQUE AT REST — an IndexedDB dump yields no message text
 *      without key material.
 *   3. Because it is ONE key, wrapping it with the user's passphrase later
 *      protects the entire existing cache with no re-encryption of anything.
 *
 * The AAD binds every sealed box to the account and the record that owns it, so
 * ciphertext cannot be transplanted between messages, attachments, or accounts.
 */

import { fromB64, toB64 } from "./e2ee";

const LS_VAULT = (userId: string) => `cloak-vault-${userId}`;

export interface SealedBox {
  v: 1;
  /** base64, 12 bytes */
  iv: string;
  /** AES-256-GCM ciphertext with its 16-byte tag appended */
  ct: ArrayBuffer;
}

/* Module state mirrors the orchestrator: the signed-in account is published
 * once by the store, so no call site has to thread a userId through. A sealed
 * box opened while a DIFFERENT account is active fails on both the key and the
 * AAD, which is the intended cross-account behaviour. */
let vaultUserId: string | null = null;
let vaultKeyPromise: Promise<CryptoKey | null> | null = null;

/** Publish the signed-in account. Call on auth resolve and with null on
 *  sign-out. Deliberately does NOT delete the persisted key: local content is
 *  retained per account across sign-out, so the key must outlive the session. */
export function setVaultUser(userId: string | null): void {
  if (vaultUserId === userId) return;
  vaultUserId = userId;
  vaultKeyPromise = null;
}

/** Drop the in-memory key (Dagger). The persisted seed is removed separately by
 *  the cleanup coordinator, alongside the rest of the keyring. */
export function wipeVaultMemory(): void {
  vaultUserId = null;
  vaultKeyPromise = null;
}

export function currentVaultUserId(): string | null {
  return vaultUserId;
}

async function loadOrCreateVaultKey(userId: string): Promise<CryptoKey | null> {
  let rawB64: string | null = null;
  try {
    rawB64 = localStorage.getItem(LS_VAULT(userId));
  } catch {
    return null;
  }

  if (!rawB64) {
    rawB64 = toB64(crypto.getRandomValues(new Uint8Array(32)));
    try {
      localStorage.setItem(LS_VAULT(userId), rawB64);
    } catch {
      /* Storage blocked or full. Do NOT hand back a key we failed to persist:
         the next session would mint a different one and every byte we cached
         this session would be permanently unopenable. Refusing here means the
         cache simply stays off, which is recoverable. */
      return null;
    }
  }

  try {
    return await crypto.subtle.importKey(
      "raw",
      fromB64(rawB64),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } catch {
    return null;
  }
}

async function getVaultKey(): Promise<CryptoKey | null> {
  const userId = vaultUserId;
  if (!userId) return null;
  if (!vaultKeyPromise) vaultKeyPromise = loadOrCreateVaultKey(userId);
  const key = await vaultKeyPromise;
  /* A null result is not memoised — a later call (after sign-in, or once
     storage frees up) should be free to try again. */
  if (!key) vaultKeyPromise = null;
  return key;
}

/** `scope` names the record, e.g. `msg|<messageId>` or `att|<attachmentId>`.
 *  The account is prepended here so callers cannot forget it. */
function aad(scope: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${vaultUserId ?? ""}|${scope}`) as Uint8Array<ArrayBuffer>;
}

export async function sealLocal(
  plaintext: ArrayBuffer | Uint8Array,
  scope: string
): Promise<SealedBox | null> {
  const key = await getVaultKey();
  if (!key) return null;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: aad(scope) as unknown as BufferSource,
      },
      key,
      plaintext as unknown as BufferSource
    );
    return { v: 1, iv: toB64(iv), ct };
  } catch {
    return null;
  }
}

export async function openLocal(box: SealedBox, scope: string): Promise<ArrayBuffer | null> {
  const key = await getVaultKey();
  if (!key) return null;
  try {
    return await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64(box.iv) as unknown as BufferSource,
        additionalData: aad(scope) as unknown as BufferSource,
      },
      key,
      box.ct
    );
  } catch {
    /* GCM failure means a wrong key, a tampered box, or a mismatched scope.
       Never fall back to showing garbage. */
    return null;
  }
}

export async function sealLocalText(text: string, scope: string): Promise<SealedBox | null> {
  return sealLocal(new TextEncoder().encode(text), scope);
}

export async function openLocalText(box: SealedBox, scope: string): Promise<string | null> {
  const buf = await openLocal(box, scope);
  if (!buf) return null;
  try {
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

/** Validate a box that came out of IndexedDB before using it. */
export function parseSealedBox(value: unknown): SealedBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Partial<SealedBox>;
  if (box.v !== 1 || typeof box.iv !== "string" || !box.iv) return null;
  if (!(box.ct instanceof ArrayBuffer)) return null;
  return { v: 1, iv: box.iv, ct: box.ct };
}

export const vaultScope = {
  message: (messageId: string) => `msg|${messageId}`,
  attachment: (attachmentId: string) => `att|${attachmentId}`,
};
