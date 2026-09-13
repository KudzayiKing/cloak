"use client";

/*
 * Cloak E2EE core (WebCrypto only — no dependencies, no plaintext to the
 * server).
 *
 * Identity      : per-user ECDH P-256 keypair. The private key never
 *                 leaves the device (localStorage, device-scoped); the
 *                 public key is uploaded so co-members can wrap for us.
 *                 A passphrase-wrapped backup (PBKDF2-SHA256 600k ->
 *                 AES-GCM) lives server-side so a NEW device can restore.
 * Conv keys     : random AES-256-GCM-256 key per conversation, versioned.
 *                 Distributed as per-recipient wraps:
 *                   shared = ECDH(myPriv, theirPub)
 *                   wrapKey = HKDF-SHA256(shared, salt = conversationId,
 *                                          info = "cloak/conv-key/v<N>")
 *                   blob   = AES-GCM(wrapKey, raw conversation key)
 * Messages      : body = {"v":<version>,"k":<b64 key id>,"n":<b64 iv>,
 *                 "c":<b64 ct>}. The message key is RATCHETED per message:
 *                   msgKey = HKDF-SHA256(root, salt = "<convId>|v<N>",
 *                                        info = "cloak/msg/<k>")
 *                 where <k> is a fresh random 128-bit id per message. The
 *                 root key itself never encrypts a body, so a leaked
 *                 message key (or a leaked ciphertext+iv pair) cannot
 *                 decrypt any other message, and deleting a version root
 *                 (forward-secrecy window) kills every message under it.
 *                 Envelopes without "k" are legacy and decrypt directly
 *                 with the root.
 *                 AES-GCM with additionalData = "<convId>|<kind>|<authorId>"
 *                 so ciphertexts cannot be transplanted between
 *                 conversations, authors, or kinds.
 *
 * System notices stay plaintext server-side (membership facts only).
 * Legacy pre-E2EE rows have non-envelope bodies and render via fallback.
 */

const EC_PARAMS = { name: "ECDH", namedCurve: "P-256" } as const;
const PBKDF2_ITERATIONS = 600_000;
const HKDF_INFO_PREFIX = "cloak/conv-key/v";

/* ---------- base64 helpers ---------- */

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

/* ---------- identity keys ---------- */

export interface IdentityKeyPair {
  publicKeyB64: string;
  privateKeyJwk: JsonWebKey;
}

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKeyB64 = toB64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKeyB64, privateKeyJwk };
}

export async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(publicKeyB64), EC_PARAMS, true, []);
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, EC_PARAMS, true, ["deriveBits"]);
}

/** Short human-comparable fingerprint of an identity public key
 *  (SHA-256, first 8 bytes, grouped hex — e.g. "3F2A 91BC 04DD 7E10"). */
export async function identityFingerprint(publicKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromB64(publicKeyB64));
  const hex = [...new Uint8Array(digest).subarray(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return (hex.match(/.{1,4}/g) ?? []).join(" ");
}

/* ---------- passphrase backup (private key at rest, server-side) ---------- */

export interface IdentityBackupBlob {
  v: 1;
  kdf: { alg: "PBKDF2-SHA256"; iterations: number; salt: string };
  iv: string;
  ct: string;
}

async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    utf8(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapIdentityWithPassphrase(
  privateKeyJwk: JsonWebKey,
  passphrase: string
): Promise<IdentityBackupBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePassphraseKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    utf8(JSON.stringify(privateKeyJwk))
  );
  return {
    v: 1,
    kdf: { alg: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

export async function unwrapIdentityWithPassphrase(
  blob: IdentityBackupBlob,
  passphrase: string
): Promise<JsonWebKey> {
  const key = await derivePassphraseKey(passphrase, fromB64(blob.kdf.salt));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(blob.iv) as unknown as BufferSource },
    key,
    fromB64(blob.ct) as unknown as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
}

/* ---------- conversation keys ---------- */

const AES_PARAMS: AesKeyGenParams = { name: "AES-GCM", length: 256 };

export interface WrappedKeyBlob {
  nonce: string; // b64
  wrapped: string; // b64
}

export async function generateConversationKeyRaw(): Promise<string> {
  const key = await crypto.subtle.generateKey(AES_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);
  return toB64(await crypto.subtle.exportKey("raw", key));
}

async function conversationWrapKey(
  myPrivate: CryptoKey,
  theirPublicB64: string,
  conversationId: string,
  version: number,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const theirPublic = await importPublicKey(theirPublicB64);
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublic },
    myPrivate,
    256
  );
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8(conversationId) as unknown as BufferSource,
      info: utf8(`${HKDF_INFO_PREFIX}${version}`) as unknown as BufferSource,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

/** Wrap a raw conversation key for one recipient (ECDH + HKDF + AES-GCM). */
export async function wrapConversationKeyFor(
  myPrivateJwk: JsonWebKey,
  recipientPublicKeyB64: string,
  conversationId: string,
  version: number,
  conversationKeyRawB64: string
): Promise<WrappedKeyBlob> {
  const myPrivate = await importPrivateKey(myPrivateJwk);
  const wrapKey = await conversationWrapKey(
    myPrivate,
    recipientPublicKeyB64,
    conversationId,
    version,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    fromB64(conversationKeyRawB64) as unknown as BufferSource
  );
  return { nonce: toB64(iv), wrapped: toB64(ct) };
}

/** Unwrap a conversation-key blob addressed to me. */
export async function unwrapConversationKeyFrom(
  myPrivateJwk: JsonWebKey,
  senderPublicKeyB64: string,
  conversationId: string,
  version: number,
  blob: WrappedKeyBlob
): Promise<string> {
  const myPrivate = await importPrivateKey(myPrivateJwk);
  const wrapKey = await conversationWrapKey(
    myPrivate,
    senderPublicKeyB64,
    conversationId,
    version,
    ["decrypt"]
  );
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(blob.nonce) as unknown as BufferSource },
    wrapKey,
    fromB64(blob.wrapped) as unknown as BufferSource
  );
  return toB64(raw);
}

/* ---------- message envelopes ---------- */

export interface MessageEnvelope {
  v: number; // conversation key version
  k?: string; // b64 per-message key id (ratcheted keys)
  n: string; // b64 iv
  c: string; // b64 ciphertext
}

export function envelopeAad(
  conversationId: string,
  kind: string,
  authorId: string
): Uint8Array {
  return utf8(`${conversationId}|${kind}|${authorId}`);
}

const HKDF_MSG_INFO_PREFIX = "cloak/msg/";

/** Fresh random per-message key id (128-bit, b64) — unique per message so
 *  every body is encrypted under its own HKDF-derived key. */
export function generateMessageKeyId(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Derive the per-message AES key from the conversation root key.
 *  salt binds (conversation, version); info binds the random key id —
 *  both sides derive the identical key from the envelope's "k" field. */
export async function deriveMessageKeyRaw(
  rootRawB64: string,
  conversationId: string,
  version: number,
  keyIdB64: string
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    fromB64(rootRawB64),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8(`${conversationId}|v${version}`) as unknown as BufferSource,
      info: utf8(`${HKDF_MSG_INFO_PREFIX}${keyIdB64}`) as unknown as BufferSource,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessageBody(
  rootRawB64: string,
  version: number,
  plaintext: string,
  conversationId: string,
  kind: string,
  authorId: string
): Promise<string> {
  const keyId = generateMessageKeyId();
  const key = await deriveMessageKeyRaw(rootRawB64, conversationId, version, keyId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: envelopeAad(conversationId, kind, authorId) as unknown as BufferSource,
    },
    key,
    utf8(plaintext) as unknown as BufferSource
  );
  const envelope: MessageEnvelope = { v: version, k: keyId, n: toB64(iv), c: toB64(ct) };
  return JSON.stringify(envelope);
}

export async function decryptMessageBody(
  rootRawB64: string,
  envelope: MessageEnvelope,
  conversationId: string,
  kind: string,
  authorId: string
): Promise<string> {
  /* Ratcheted envelope: derive the per-message key from the root + key id.
     Legacy envelopes (no "k") decrypt directly with the root. */
  const key = envelope.k
    ? await deriveMessageKeyRaw(rootRawB64, conversationId, envelope.v, envelope.k)
    : await crypto.subtle.importKey(
        "raw",
        fromB64(rootRawB64),
        "AES-GCM",
        false,
        ["decrypt"]
      );
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromB64(envelope.n) as unknown as BufferSource,
      additionalData: envelopeAad(conversationId, kind, authorId) as unknown as BufferSource,
    },
    key,
    fromB64(envelope.c) as unknown as BufferSource
  );
  return new TextDecoder().decode(plain);
}

export function parseEnvelope(body: string): MessageEnvelope | null {
  if (!body.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (
      typeof parsed.v === "number" &&
      typeof parsed.n === "string" &&
      typeof parsed.c === "string"
    ) {
      return {
        v: parsed.v,
        ...(typeof parsed.k === "string" ? { k: parsed.k } : {}),
        n: parsed.n,
        c: parsed.c,
      };
    }
  } catch {
    /* not an envelope */
  }
  return null;
}
