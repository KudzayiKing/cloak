"use client";

/*
 * E2EE orchestrator — ties the WebCrypto core (e2ee.ts) to Cloak's server
 * key directory and the device-local key material.
 *
 * Device-local storage (same trust level as the persisted session cookie):
 *   cloak-identity-<userId>  -> { publicKeyB64, privateJwk }
 *   cloak-convkeys-<userId>  -> { [conversationId]: { [version]: rawB64 } }
 *
 * Server (untrusted directory):
 *   GET/PUT /api/identity/keys            public key + passphrase backup
 *   GET/POST /api/conversations/:id/keys  wrap distribution + rotation
 *
 * Guarantees:
 *   - The private identity key and every conversation key are generated on
 *     device; the server only ever sees wrapped blobs and ciphertext.
 *   - Self-heal: any current-key holder wraps the current version for
 *     active co-members whose publicKey exists but who hold no wrap yet
 *     (covers members provisioning at different times).
 *   - Rotation: member removed/leave (actor rotates, CAS via expectVersion)
 *     and restricted-history adds (newcomer must not read old ciphertext).
 */

import {
  generateConversationKeyRaw,
  generateIdentityKeyPair,
  identityFingerprint,
  unwrapConversationKeyFrom,
  unwrapIdentityWithPassphrase,
  wrapConversationKeyFor,
  wrapIdentityWithPassphrase,
  type IdentityBackupBlob,
  type WrappedKeyBlob,
} from "./e2ee";

export type IdentityStatus =
  | "ready"
  | "needs-passphrase" // server has (or needs) a backup; passphrase required
  | "unavailable"; // crypto unavailable / hard failure

export interface IdentityInfo {
  publicKeyB64: string;
  fingerprint: string;
}

interface LocalIdentity {
  publicKeyB64: string;
  privateJwk: JsonWebKey;
}

interface KeysResponse {
  ok: true;
  keyVersion: number;
  keyVersionAt: number;
  members: { userId: string; publicKey: string | null; hasKey: boolean }[];
  myWraps: {
    version: number;
    nonce: string;
    wrapped: string;
    wrappedBy: string;
    createdAt: number;
  }[];
}

/* ---------- module state ---------- */

let identity: (LocalIdentity & { userId: string }) | null = null;
let convKeys: { userId: string; byConv: Record<string, Record<string, string>> } | null = null;
let convKeysMeta: {
  userId: string;
  byConv: Record<string, Record<string, number>>;
} | null = null;
let currentVersions: Record<string, number> = {};
const keyVersionAtCache: Record<string, number> = {};
/* Server-truth age of each key version (my newest wrap's createdAt per
 * version, from the keys GET) — lets the FS pass retire versions this
 * device never even unwrapped (fresh device + too-old wraps). */
const wrapAges: Record<string, Record<string, number>> = {};
const inflight = new Map<string, Promise<unknown>>();
const healCooldown = new Map<string, number>();
const rotateCheckCooldown = new Map<string, number>();

/* Forward-secrecy window (ms) — null = off. When set, key versions older
 * than the window are unwrapped-only-once-then-forgotten: their local
 * seeds are deleted AND their server-side wraps retired, so ciphertext
 * under them can never be decrypted again by ANYONE (true forward
 * secrecy against later device/server/passphrase compromise). */
let fsWindowMs: number | null = null;

/** Set by the store when the user changes the Security setting. */
export function setForwardSecrecyWindow(ms: number | null) {
  fsWindowMs = ms;
}

/**
 * Dagger (codex §6/§32): destroy the in-memory keyring. The localStorage
 * seeds (cloak-identity-*, cloak-convkeys-*) are removed by the dagger
 * cleanup coordinator; this wipes the module state so no key survives in
 * RAM either. After this call the device can no longer encrypt or decrypt
 * anything — re-enrollment generates a genuinely new identity.
 */
export function wipeKeyringMemory() {
  identity = null;
  convKeys = null;
  convKeysMeta = null;
  currentVersions = {};
  for (const k of Object.keys(keyVersionAtCache)) delete keyVersionAtCache[k];
  for (const k of Object.keys(wrapAges)) delete wrapAges[k];
  inflight.clear();
  healCooldown.clear();
  rotateCheckCooldown.clear();
}

const LS_IDENTITY = (userId: string) => `cloak-identity-${userId}`;
const LS_CONVKEYS = (userId: string) => `cloak-convkeys-${userId}`;
/* Per-version first-seen timestamps (ms) — drives FS aging for seeds whose
 * server wrap is unknown (e.g. restored devices). Kept separately so the
 * raw-key cache format never changes. */
const LS_CONVKEYS_META = (userId: string) => `cloak-convkeys-meta-${userId}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/blocked — keys stay memory-only for the session */
  }
}

/* ---------- public keyring access (used by the message store) ---------- */

export function hasLocalIdentity(userId: string): boolean {
  return !!readJson<LocalIdentity>(LS_IDENTITY(userId));
}

export function isIdentityReady(userId: string): boolean {
  return identity?.userId === userId;
}

export async function myIdentityInfo(userId: string): Promise<IdentityInfo | null> {
  const local =
    identity?.userId === userId
      ? identity
      : readJson<LocalIdentity>(LS_IDENTITY(userId));
  if (!local) return null;
  return {
    publicKeyB64: local.publicKeyB64,
    fingerprint: await identityFingerprint(local.publicKeyB64),
  };
}

export function currentKeyVersion(conversationId: string): number {
  return currentVersions[conversationId] ?? 0;
}

export function getConversationKeyRaw(conversationId: string, version?: number): string | null {
  if (!convKeys) return null;
  const versions = convKeys.byConv[conversationId];
  if (!versions) return null;
  const v = version ?? Math.max(...Object.keys(versions).map(Number), 0);
  return versions[String(v)] ?? null;
}

/** Oldest version this device still holds for a conversation (0 = none).
 *  Envelopes below this were likely retired by the FS window. */
export function oldestHeldVersion(conversationId: string): number {
  const versions = convKeys?.byConv[conversationId];
  if (!versions) return 0;
  const nums = Object.keys(versions).map(Number);
  return nums.length ? Math.min(...nums) : 0;
}

/** Resolve the newest key I hold for a conversation (not necessarily the
 *  server's current version while wraps are still syncing). */
function newestHeldVersion(conversationId: string): number {
  const versions = convKeys?.byConv[conversationId];
  if (!versions) return 0;
  return Math.max(...Object.keys(versions).map(Number), 0);
}

/** Wait until a conversation key is available (provisioning/heal runs
 *  asynchronously after a conversation opens). */
export async function waitForConversationKey(
  conversationId: string,
  timeoutMs = 8000
): Promise<{ raw: string; version: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const version = newestHeldVersion(conversationId);
    const raw = getConversationKeyRaw(conversationId, version || undefined);
    if (raw && version > 0) return { raw, version };
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/* ---------- identity lifecycle ---------- */

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) return null;
    return json as T;
  } catch {
    return null;
  }
}

/**
 * Bootstrap the identity for a user. `passphrase` is only available right
 * after an explicit sign-in; a refresh reuses the device-local identity.
 */
export async function ensureIdentity(
  userId: string,
  passphrase?: string
): Promise<IdentityStatus> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return "unavailable";

  const local = readJson<LocalIdentity>(LS_IDENTITY(userId));
  if (local?.publicKeyB64 && local.privateJwk) {
    identity = { ...local, userId };
    loadConvKeys(userId);
    return "ready";
  }

  const server = await api<{ publicKey: string | null; backup: string | null }>(
    "/api/identity/keys"
  );
  if (!server) return "unavailable";

  /* New device: restore from the passphrase-wrapped server backup. */
  if (server.backup && passphrase) {
    try {
      const blob = JSON.parse(server.backup) as IdentityBackupBlob;
      const privateJwk = await unwrapIdentityWithPassphrase(blob, passphrase);
      identity = await persistIdentity(userId, { publicKeyB64: server.publicKey!, privateJwk });
      return "ready";
    } catch {
      return "needs-passphrase"; // wrong passphrase
    }
  }

  /* First-ever provision (explicit sign-in supplies the passphrase so the
     backup can be written). */
  if (!server.backup && !server.publicKey && passphrase) {
    const pair = await generateIdentityKeyPair();
    const backup = await wrapIdentityWithPassphrase(pair.privateKeyJwk, passphrase);
    const ok = await api("/api/identity/keys", {
      method: "PUT",
      body: JSON.stringify({
        publicKey: pair.publicKeyB64,
        backup: JSON.stringify(backup),
      }),
    });
    if (!ok) return "unavailable";
    identity = await persistIdentity(userId, {
      publicKeyB64: pair.publicKeyB64,
      privateJwk: pair.privateKeyJwk,
    });
    return "ready";
  }

  return "needs-passphrase";
}

/** Explicit restore from the restore-keys prompt (has the passphrase). */
export async function restoreIdentity(
  userId: string,
  passphrase: string
): Promise<IdentityStatus> {
  return ensureIdentity(userId, passphrase);
}

async function persistIdentity(userId: string, pair: LocalIdentity) {
  writeJson(LS_IDENTITY(userId), pair);
  loadConvKeys(userId);
  return { ...pair, userId };
}

function loadConvKeys(userId: string) {
  if (convKeys?.userId === userId) return;
  const stored = readJson<Record<string, Record<string, string>>>(
    LS_CONVKEYS(userId)
  );
  convKeys = { userId, byConv: stored ?? {} };
  const meta = readJson<Record<string, Record<string, number>>>(
    LS_CONVKEYS_META(userId)
  );
  convKeysMeta = { userId, byConv: meta ?? {} };
}

function saveConvKeys() {
  if (convKeys) writeJson(LS_CONVKEYS(convKeys.userId), convKeys.byConv);
  if (convKeysMeta) writeJson(LS_CONVKEYS_META(convKeysMeta.userId), convKeysMeta.byConv);
}

/** First-seen timestamp for a held version — server wrap age when known,
 *  else local wall clock. Only the FIRST stamp wins (age must never grow). */
function stampConvKey(conversationId: string, version: number, at?: number) {
  if (!convKeysMeta) return;
  const versions = (convKeysMeta.byConv[conversationId] ??= {});
  const key = String(version);
  if (versions[key] === undefined) {
    versions[key] = at && at > 0 ? at : Date.now();
    saveConvKeys();
  }
}

function dropConvKey(conversationId: string, version: number) {
  if (!convKeys || !convKeysMeta) return;
  const versions = convKeys.byConv[conversationId];
  if (versions) {
    delete versions[String(version)];
    saveConvKeys();
  }
  const meta = convKeysMeta.byConv[conversationId];
  if (meta) {
    delete meta[String(version)];
    saveConvKeys();
  }
}

function storeConvKey(conversationId: string, version: number, raw: string) {
  if (!convKeys) return;
  const versions = (convKeys.byConv[conversationId] ??= {});
  const isNew = versions[String(version)] === undefined;
  versions[String(version)] = raw;
  saveConvKeys();
  if (isNew) stampConvKey(conversationId, version);
}

/* ---------- conversation key sync: provision / unwrap / heal ---------- */

export type ConvKeyStatus = "ready" | "waiting" | "no-identity" | "error";

/**
 * Full key-maintenance pass for one conversation:
 *  - unwrap every wrap addressed to me (all versions),
 *  - provision v1 when nobody has (keyVersion 0),
 *  - heal: wrap the current version for active members missing it.
 * Safe to call often (per-conversation inflight guard + heal cooldown).
 */
export async function syncConversationKeys(
  conversationId: string,
  myUserId: string,
  options: { heal?: boolean } = {}
): Promise<ConvKeyStatus> {
  if (!identity || identity.userId !== myUserId || !convKeys) return "no-identity";

  const existing = inflight.get(conversationId);
  if (existing) return (await existing.catch(() => "error")) as ConvKeyStatus;

  const task = (async (): Promise<ConvKeyStatus> => {
    const state = await api<KeysResponse>(`/api/conversations/${conversationId}/keys`);
    if (!state) return "error";

    keyVersionAtCache[conversationId] = state.keyVersionAt;
    const cutoff = fsWindowMs ? Date.now() - fsWindowMs : null;

    /* Server wrap ages in epoch ms — defensive Date.parse in case a value
       ever arrives as an ISO string (string < number coerces to NaN and
       silently disables every staleness check below). */
    const wrapAge = new Map<number, number>(
      state.myWraps.map((w) => [
        w.version,
        typeof w.createdAt === "number" ? w.createdAt : Date.parse(String(w.createdAt)),
      ])
    );

    /* 1. Unwrap everything addressed to me that I do not hold yet.
     *    With an active FS window, wraps older than the cutoff are skipped
     *    on purpose — they are about to be retired, so their plaintext
     *    key never touches this device. */
    const memberPub = new Map(state.members.map((m) => [m.userId, m.publicKey]));
    for (const wrap of state.myWraps) {
      const versions = convKeys!.byConv[conversationId] ?? {};
      if (versions[String(wrap.version)]) continue;
      if (cutoff !== null && wrapAge.get(wrap.version)! < cutoff) continue; // FS: too old
      const senderPub = memberPub.get(wrap.wrappedBy);
      if (!senderPub) continue; // wrapper has no public key on record (legacy)
      try {
        const raw = await unwrapConversationKeyFrom(
          identity!.privateJwk,
          senderPub,
          conversationId,
          wrap.version,
          { nonce: wrap.nonce, wrapped: wrap.wrapped } satisfies WrappedKeyBlob
        );
        storeConvKey(conversationId, wrap.version, raw);
        stampConvKey(conversationId, wrap.version, wrapAge.get(wrap.version));
      } catch {
        /* corrupt/foreign wrap — ignore */
      }
    }
    /* Record ages for versions I already hold (server truth when available).
     * A held version with NO wrap on record means its server wraps are
     * already gone (retired by another device's FS pass) — stamp 0 so the
     * local seed ages out too instead of lingering readable forever. */
    for (const wrap of state.myWraps) {
      (wrapAges[conversationId] ??= {})[String(wrap.version)] = wrapAge.get(
        wrap.version
      )!;
      if (convKeys!.byConv[conversationId]?.[String(wrap.version)]) {
        stampConvKey(conversationId, wrap.version, wrapAge.get(wrap.version));
      }
    }
    if (cutoff !== null) {
      const heldVersions = convKeys!.byConv[conversationId] ?? {};
      for (const vStr of Object.keys(heldVersions)) {
        if (wrapAge.has(Number(vStr))) continue;
        stampConvKey(conversationId, Number(vStr), 0);
      }
    }
    currentVersions[conversationId] = state.keyVersion;

    /* 1.5. All-stale deadlock guard: with an active FS window, a device
     * that holds NOTHING and sees only over-window wraps can never unlock
     * (rotation requires holding the current key). Provision a FRESH
     * version instead — old versions stay dead (that is the policy), but
     * the conversation becomes usable again. CAS via expectVersion. */
    if (
      cutoff !== null &&
      state.keyVersion > 0 &&
      newestHeldVersion(conversationId) === 0 &&
      state.myWraps.length > 0 &&
      state.myWraps.every((w) => wrapAge.get(w.version)! < cutoff)
    ) {
      const recipients = state.members.filter(
        (m): m is { userId: string; publicKey: string; hasKey: boolean } => !!m.publicKey
      );
      if (recipients.length > 0) {
        const newVersion = state.keyVersion + 1;
        const raw = await generateConversationKeyRaw();
        const wraps = await buildWraps(conversationId, newVersion, raw, recipients);
        if (wraps.length > 0) {
          const posted = await api<{ keyVersion: number }>(
            `/api/conversations/${conversationId}/keys`,
            {
              method: "POST",
              body: JSON.stringify({
                version: newVersion,
                expectVersion: state.keyVersion,
                wraps,
              }),
            }
          );
          if (posted) {
            storeConvKey(conversationId, newVersion, raw);
            currentVersions[conversationId] = posted.keyVersion;
            return "ready";
          }
        }
      }
      return "waiting"; // CAS race lost / no usable recipients — retry next sync
    }

    /* 2. Provision the first key when the conversation has none. */
    if (state.keyVersion === 0) {
      const recipients = state.members.filter(
        (m): m is { userId: string; publicKey: string; hasKey: boolean } => !!m.publicKey
      );
      if (recipients.length === 0) return "waiting"; // nobody has provisioned an identity yet
      const raw = await generateConversationKeyRaw();
      const wraps = await buildWraps(conversationId, 1, raw, recipients);
      if (wraps.length === 0) return "waiting";
      const posted = await api<{ keyVersion: number }>(
        `/api/conversations/${conversationId}/keys`,
        { method: "POST", body: JSON.stringify({ version: 1, wraps }) }
      );
      if (!posted) return "error";
      storeConvKey(conversationId, 1, raw);
      currentVersions[conversationId] = Math.max(posted.keyVersion, 1);
      return "ready";
    }

    /* 3. I hold the current version -> heal members missing it. */
    if (newestHeldVersion(conversationId) >= state.keyVersion) {
      if (options.heal !== false) await healWraps(conversationId, state, myUserId);
      return "ready";
    }

    /* 4. Current version exists but I do not hold it yet — a holder will
          heal-wrap for me now that my public key is on the server. */
    return "waiting";
  })();

  inflight.set(conversationId, task);
  try {
    return await task;
  } finally {
    inflight.delete(conversationId);
  }
}

async function buildWraps(
  conversationId: string,
  version: number,
  raw: string,
  recipients: { userId: string; publicKey: string }[]
): Promise<({ userId: string } & WrappedKeyBlob)[]> {
  const wraps: ({ userId: string } & WrappedKeyBlob)[] = [];
  for (const recipient of recipients) {
    try {
      const blob = await wrapConversationKeyFor(
        identity!.privateJwk,
        recipient.publicKey,
        conversationId,
        version,
        raw
      );
      wraps.push({ userId: recipient.userId, ...blob });
    } catch {
      /* skip unusable recipient key */
    }
  }
  return wraps;
}

/** Wrap the current version for every active member whose publicKey exists
 *  and who holds no wrap for it yet (server-reported). */
async function healWraps(
  conversationId: string,
  state: KeysResponse,
  _myUserId: string
) {
  const now = Date.now();
  const last = healCooldown.get(conversationId) ?? 0;
  if (now - last < 5_000) return;
  healCooldown.set(conversationId, now);

  const missing = state.members.filter((m) => m.publicKey && !m.hasKey);
  if (missing.length === 0) return;
  const raw = getConversationKeyRaw(conversationId, state.keyVersion);
  if (!raw) return;

  const wraps: ({ userId: string } & WrappedKeyBlob)[] = [];
  for (const member of missing) {
    try {
      const blob = await wrapConversationKeyFor(
        identity!.privateJwk,
        member.publicKey!,
        conversationId,
        state.keyVersion,
        raw
      );
      wraps.push({ userId: member.userId, ...blob });
    } catch {
      /* skip */
    }
  }
  if (wraps.length === 0) return;
  await api(`/api/conversations/${conversationId}/keys`, {
    method: "POST",
    body: JSON.stringify({ version: state.keyVersion, wraps }),
  });
}

/* ---------- forward secrecy: retire old versions ---------- */

/**
 * FS pass — runs on the sync tick with the user's window. For every
 * conversation, key versions strictly older than the current one whose
 * first-seen stamp is past the cutoff are RETIRED:
 *   1. their wraps are deleted SERVER-side (all recipients — nobody can
 *      re-derive the key from the directory any more),
 *   2. only after that succeeded, the local seed is deleted.
 * Ciphertext under retired versions becomes permanently unreadable —
 * that is the point. Server-first ordering means a failed server call
 * never leaves a half-deleted state that we cannot retry (the local
 * seed + stamp survive until the server confirms).
 */
export async function applyForwardSecrecy(myUserId: string): Promise<void> {
  if (!identity || identity.userId !== myUserId || !convKeys || !fsWindowMs) return;
  const cutoff = Date.now() - fsWindowMs;

  for (const [conversationId, versions] of Object.entries(convKeys.byConv)) {
    const current = currentVersions[conversationId] ?? newestHeldVersion(conversationId);
    if (current === 0) continue;
    /* Versions this device holds OR knows the server still has wraps for.
       A fresh device never unwrapped over-window versions (skipped on
       purpose during sync) — it must still be able to retire them. */
    const known = new Set<number>([
      ...Object.keys(versions).map(Number),
      ...Object.keys(wrapAges[conversationId] ?? {}).map(Number),
    ]);
    const stale = [...known]
      .filter((v) => v < current)
      .filter((v) => {
        const age =
          wrapAges[conversationId]?.[String(v)] ??
          convKeysMeta?.byConv[conversationId]?.[String(v)];
        return age !== undefined && age < cutoff;
      });
    if (stale.length === 0) continue;

    const res = await fetch(`/api/conversations/${conversationId}/keys`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versions: stale }),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) continue; // retry next tick — local seed retained
    for (const v of stale) dropConvKey(conversationId, v);
    const ages = wrapAges[conversationId];
    if (ages) for (const v of stale) delete ages[String(v)];
  }
}

/* ---------- age-based rotation (keeps FS versions flowing) ---------- */

/**
 * Rotate the conversation key when the current version is older than
 * `maxAgeMs`. Without this, a long-quiet conversation would keep one
 * version forever and the FS deletion pass would never have an older
 * version to retire. Called on send (before encrypting); CAS handles
 * concurrent rotators — a 409 loser simply sends under the held key.
 */
export async function maybeRotateForAge(
  conversationId: string,
  myUserId: string,
  maxAgeMs: number
): Promise<void> {
  if (!identity || identity.userId !== myUserId) return;
  const version = currentVersions[conversationId] ?? 0;
  if (version === 0) return;
  const at = keyVersionAtCache[conversationId];
  if (!at || Date.now() - at < maxAgeMs) return;

  const now = Date.now();
  const last = rotateCheckCooldown.get(conversationId) ?? 0;
  if (now - last < 30_000) return;
  rotateCheckCooldown.set(conversationId, now);
  await rotateConversationKey(conversationId, [], myUserId).catch(() => undefined);
}

/* ---------- rotation (member removal / leave / restricted add) ---------- */

/**
 * Rotate the conversation key: new version, wrapped for every active
 * member with a public key EXCEPT `excludeUserIds` (the removed member,
 * the leaver themselves, or — with an empty exclusion list — everyone,
 * e.g. after a restricted-history add). CAS via expectVersion — on a race
 * the caller retries after a re-sync.
 */
export async function rotateConversationKey(
  conversationId: string,
  excludeUserIds: string[],
  myUserId: string
): Promise<boolean> {
  if (!identity || identity.userId !== myUserId || !convKeys) return false;

  const state = await api<KeysResponse>(`/api/conversations/${conversationId}/keys`);
  if (!state || state.keyVersion === 0) return false;
  const currentRaw = getConversationKeyRaw(conversationId, state.keyVersion);
  if (!currentRaw) return false; // I cannot rotate a key I do not hold

  const recipients = state.members.filter(
    (m): m is { userId: string; publicKey: string; hasKey: boolean } =>
      !!m.publicKey && !excludeUserIds.includes(m.userId)
  );
  if (recipients.length === 0) return false;

  const newVersion = state.keyVersion + 1;
  const raw = await generateConversationKeyRaw();
  const wraps = await buildWraps(conversationId, newVersion, raw, recipients);
  if (wraps.length === 0) return false;

  const posted = await api<{ keyVersion: number }>(
    `/api/conversations/${conversationId}/keys`,
    {
      method: "POST",
      body: JSON.stringify({
        version: newVersion,
        expectVersion: state.keyVersion,
        wraps,
      }),
    }
  );
  if (!posted) return false;
  storeConvKey(conversationId, newVersion, raw);
  currentVersions[conversationId] = newVersion;
  return true;
}

/** Re-wrap EVERY version I hold for specific users (groups with history
 *  policy "all" — newcomers may read retained history). */
export async function shareAllVersionsWith(
  conversationId: string,
  userIds: string[],
  myUserId: string
): Promise<boolean> {
  if (!identity || identity.userId !== myUserId || !convKeys) return false;
  const versions = convKeys.byConv[conversationId];
  if (!versions) return false;
  const newest = newestHeldVersion(conversationId);
  if (newest === 0) return false;

  const state = await api<KeysResponse>(`/api/conversations/${conversationId}/keys`);
  if (!state) return false;
  const recipients = state.members.filter(
    (m): m is { userId: string; publicKey: string; hasKey: boolean } =>
      !!m.publicKey && userIds.includes(m.userId)
  );
  if (recipients.length === 0) return false;

  const wraps: ({ userId: string } & WrappedKeyBlob)[] = [];
  for (const recipient of recipients) {
    for (const [versionStr, raw] of Object.entries(versions)) {
      try {
        const blob = await wrapConversationKeyFor(
          identity.privateJwk,
          recipient.publicKey,
          conversationId,
          Number(versionStr),
          raw
        );
        wraps.push({ userId: recipient.userId, ...blob });
      } catch {
        /* skip */
      }
    }
  }
  if (wraps.length === 0) return false;
  const posted = await api<{ keyVersion: number }>(
    `/api/conversations/${conversationId}/keys`,
    {
      method: "POST",
      body: JSON.stringify({ version: newest, wraps }),
    }
  );
  return !!posted;
}

/* ---------- message body crypto (used by the store) ---------- */

export interface BodyCryptoResult {
  ok: boolean;
  text?: string;
  locked?: boolean;
  /** Why decryption failed — drives the honest bubble copy:
   *  "missing" = key not on this device (yet), "expired" = key retired
   *  by the forward-secrecy window and gone for everyone. */
  reason?: "missing" | "expired";
}

export async function encryptBody(
  conversationId: string,
  plaintext: string,
  kind: string,
  authorId: string
): Promise<string | null> {
  const version = newestHeldVersion(conversationId);
  const raw = getConversationKeyRaw(conversationId, version || undefined);
  if (!raw || version === 0) return null;
  const { encryptMessageBody } = await import("./e2ee");
  return encryptMessageBody(raw, version, plaintext, conversationId, kind, authorId);
}

export async function decryptBody(
  conversationId: string,
  body: string,
  kind: string,
  authorIdMapped: string,
  myUserId: string
): Promise<BodyCryptoResult> {
  const { parseEnvelope, decryptMessageBody } = await import("./e2ee");
  const envelope = parseEnvelope(body);
  if (!envelope) return { ok: true, text: body }; // legacy plaintext or system notice
  const raw = getConversationKeyRaw(conversationId, envelope.v);
  if (!raw) {
    /* Distinguish "not synced yet" from "retired by the FS window": an
       envelope version BELOW the oldest version this device holds can no
       longer be fetched by anyone — it expired by policy. */
    const oldest = oldestHeldVersion(conversationId);
    const expired = oldest > 0 && envelope.v < oldest;
    return { ok: false, locked: true, reason: expired ? "expired" : "missing" };
  }
  try {
    /* The AAD binds the REAL author id; the server maps mine to "me". */
    const authorId = authorIdMapped === "me" ? myUserId : authorIdMapped;
    const text = await decryptMessageBody(raw, envelope, conversationId, kind, authorId);
    return { ok: true, text };
  } catch {
    return { ok: false, locked: true, reason: "missing" };
  }
}
