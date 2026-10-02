"use client";

/*
 * Cloak client state.
 *
 * - Cloak Mode is a global privacy control (spec §23) with a reusable
 *   useCloakMode() hook built on this store.
 * - Demo conversations live in memory; settings and Cloak Mode persist
 *   locally. When the real encrypted backend lands, conversations move to
 *   app-controlled encrypted storage without changing component contracts.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AIProcessingPreference,
  CircleDetail,
  CircleJoinRequestEntry,
  CircleSummary,
  Contact,
  Conversation,
  DisappearingTimer,
  MemoryScope,
  Message,
  MessageStatus,
  MessageReactionSummary,
  MembershipEntitlement,
  MessageKind,
  PreviewVisibility,
  ReserveGuestPass,
} from "@/lib/cloak/types";
import type { IssueGuestPassInput } from "@/lib/cloak/membership";
import { membershipService, type PassAllocationView, type PassInviteRecord } from "@/lib/cloak/membership-service";
import { syncPushAfterAuth } from "@/lib/cloak/push-client";
import { setVaultUser, forgetVaultKey } from "@/lib/crypto/local-vault";
import { clearLocalCacheForOwner, ensurePersistentStorage } from "@/lib/cloak/local-db";
import {
  cachedRowToMessage,
  cacheMessages,
  forgetCachedSignatures,
  loadCachedMessages,
  purgeExpiredCachedMessages,
} from "@/lib/cloak/message-cache";
import {
  cacheConversations,
  loadCachedConversations,
} from "@/lib/cloak/conversation-cache";
import {
  DAGGER_DEFAULTS,
  checkPendingDaggerCommand,
  consumePendingRevocation,
  daggerCurrentDevice,
  deviceIdentity,
  type DaggerConfiguration,
} from "@/lib/cloak/dagger";
import { MODEL_MANIFEST } from "@/lib/cloak/config";
import { DEFAULT_CLOAK_THEME, applyCloakTheme, type CloakTheme } from "@/lib/cloak/theme";
import {
  parseAttachmentEnvelope,
  getLocalAttachment,
  openLocalAttachment,
  saveLocalAttachment,
  withBlobEnvelope,
  type AttachmentEnvelope,
} from "@/lib/cloak/attachment-storage";
import {
  bumpOutboxAttempt,
  deleteOutboxEntry,
  enqueueOutbox,
  listOutbox,
  updateOutboxBody,
  type OutboxEntry,
} from "@/lib/cloak/outbox";
import { downloadAttachmentBlob, uploadAttachmentBlob } from "@/lib/cloak/attachment-remote";
import {
  applyForwardSecrecy,
  decryptBody,
  encryptBody,
  ensureIdentity,
  forgetLocalIdentity,
  getConversationKeyRaw,
  maybeRotateForAge,
  restoreIdentity,
  rotateConversationKey,
  setForwardSecrecyWindow,
  shareAllVersionsWith,
  syncConversationKeys,
  waitForConversationKey,
  type IdentityStatus,
} from "@/lib/crypto/e2ee-orchestrator";

/** Forward-secrecy window options (Security centre) -> milliseconds. */
export const FS_WINDOW_MS: Record<string, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
};
export type ForwardSecrecyWindow = keyof typeof FS_WINDOW_MS | "off";

export interface PrivacySettings {
  readReceipts: boolean;
  typingIndicator: boolean;
  onlineStatus: boolean;
  messagePreviews: boolean;
  linkPreviews: boolean;
  mediaSaving: boolean;
  blockedCount: number;
}

export interface AISettings {
  enabled: boolean;
  processing: AIProcessingPreference;
  memoryScope: MemoryScope;
  translation: boolean;
  persistentMemory: boolean;
}

export interface NotificationSettings {
  previews: PreviewVisibility;
  sounds: boolean;
  ghostChatNotifications: boolean;
}

/* In-app notification row (groups & circles spec §62). Structural events
   only — never message content. Server-backed, fetch-mirror. */
export interface ServerNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  circleId?: string;
  groupId?: string;
  actorName?: string;
  read: boolean;
  createdAt: number;
}

/* Blocked users (spec §75) — the blocker's own list. */
export interface BlockedUserEntry {
  userId: string;
  name: string;
  cloakId: string;
  blockedAt: number;
}

/* Groups & Circles privacy settings (spec §74) — server-backed so the
   enforcement happens where the decision is made (§80). */
export interface ServerPrivacySettings {
  groupInvitePolicy: "trusted" | "valid_invite" | "nobody";
  circleInvitePolicy: "trusted" | "valid_invite" | "nobody";
  defaultAiAccess: "disabled" | "current_request" | "allowed";
}

export interface CloakDevice {
  id: string;
  name: string;
  platform: string;
  addedAt: string;
  lastActive: string;
  trusted: boolean;
  current?: boolean;
}

/* User-created chat list filter (user feedback: custom filter tabs). */
export interface ChatFilter {
  id: string;
  label: string;
  /** Conversations included in this filter. */
  conversationIds: string[];
}

/* ---------- Auth + server sync ---------- */

export interface AuthUser {
  id: string;
  handle: string;
  email?: string | null;
  emailVerifiedAt?: string | null;
  displayName: string;
}

/** Payload shapes returned by /api/auth/* and /api/conversations*. */
export interface ServerMessage {
  id: string;
  conversationId: string;
  authorId: string;
  kind: string;
  body: string;
  createdAt: number;
  status?: "sent" | "delivered" | "read";
  authorName?: string;
  /** Ghost chats: epoch ms purge time; null when not ghost-timed. */
  expiresAt?: number | null;
  reactions?: MessageReactionSummary[];
}

export interface ServerConversation {
  id: string;
  contactId: string;
  isGroup: boolean;
  groupName?: string;
  groupDescription?: string;
  memberCount?: number;
  myRole?: "owner" | "admin" | "member";
  /** Circle association (circles spec §53). */
  circleId?: string;
  circleName?: string;
  unreadCount: number;
  /** Ghost chat TTL seconds; null = ghost mode off. */
  ghostSeconds?: number | null;
  aiAccess: "allowed" | "blocked";
  /** Effective AI access (§39): strictest of group + circle policy. */
  aiEffective?: "allowed" | "limited" | "blocked";
  aiCircleDefault?: string;
  persistentMemory: boolean;
  /** E2EE: current conversation-key version (0 = not provisioned). */
  keyVersion?: number;
  /** Group history-sharing policy (drives key handling on member adds). */
  historyPolicy?: "none" | "all";
  messages: ServerMessage[];
}

export interface ServerContact {
  id: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  verification: "verified" | "unverified" | "pending";
  about?: string;
}

/* ---------- Groups (groups & circles spec §6-§10) ---------- */

export interface GroupMember {
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  role: "owner" | "admin" | "member";
  joinedAt: number;
  isYou: boolean;
}

export interface GroupJoinRequest {
  id: string;
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  createdAt: number;
}

export interface GroupInviteRecord {
  id: string;
  type: string;
  status: "active" | "redeemed" | "expired" | "revoked";
  maxUses: number | null;
  useCount: number;
  requiresApproval: boolean;
  expiresAt: number | null;
  createdAt: number;
}

interface ApiOk<T> { ok: true; data: T }
type ApiResult<T> = ApiOk<T> | { ok: false; status: number; error?: string };

/* Every request is bounded. A phone on a flaky mobile network (or a server
 * mid-restart) must fail loudly in seconds, never leave a button spinning
 * until the OS-level TCP timeout. */
const API_TIMEOUT_MS = 20_000;

/** Ceiling on E2EE identity provisioning during sign-in. Generous enough for
 *  600k-iteration PBKDF2 on a slow phone, short enough that a stall cannot
 *  read as "sign-in is broken". */
const IDENTITY_PROVISION_TIMEOUT_MS = 12_000;

/** AbortSignal.timeout is missing on iOS Safari < 16 — never let its absence
 *  break a request. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(ms)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve to `undefined` instead of hanging when `promise` overruns `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = window.setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
      signal: init?.signal ?? timeoutSignal(API_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return { ok: false, status: 0, error: timedOut ? "timeout" : "network" };
  }
}

/* Ghost chat timer <-> seconds mapping (server stores seconds). */
const GHOST_TIMER_SECONDS: Record<string, number> = {
  "30s": 30,
  "5m": 300,
  "1h": 3600,
  "1d": 86400,
  "7d": 604800,
};

function secondsToTimer(s: number | null | undefined): DisappearingTimer {
  if (!s || s <= 0) return "off";
  for (const [t, sec] of Object.entries(GHOST_TIMER_SECONDS)) {
    if (sec === s) return t as DisappearingTimer;
  }
  return "custom";
}

/* Compact "last active" label for the trusted-devices list (§18 shows
   "Last seen 8 minutes ago"). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

/* ---------- the outbox's single send path ---------- */

/**
 * A fresh idempotency key. It doubles as the optimistic message's id, so the
 * queued row, the rendered bubble and every retry all name the same value.
 */
function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

type SendOutcome =
  | {
      kind: "sent";
      message: Message;
      /** The message landed but its payload did not, so only this device can
       *  play it. Surfaced to the sender rather than hidden. */
      transferFailed?: boolean;
    }
  | { kind: "retryable"; reason: string }
  | { kind: "permanent"; reason: string };

/**
 * Is a failed POST worth retrying?
 *
 * This distinction is the entire reason the outbox can exist. A 404 means the
 * message can never land (not a member any more) and must be surfaced as
 * failed. A timeout means we do NOT KNOW whether it landed, so it must be
 * retried — which is only safe because the retry carries the same clientKey and
 * the route replays instead of duplicating.
 */
function classifySendFailure(status: number): "retryable" | "permanent" {
  if (status === 0) return "retryable"; // network error or timeout
  if (status === 401 || status === 408 || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  return "permanent";
}

/**
 * Seal (and upload, for media) then POST. ONE implementation, shared by the
 * immediate send and the outbox flush, so the two can never drift — a queue
 * that encrypts differently from the live path would be a silent data-loss bug.
 *
 * ENCRYPTION HAPPENS HERE, AT SEND TIME. Never at enqueue time: a conversation
 * key version can be retired by forward secrecy while a message waits in the
 * queue, and a body encrypted under a retired version is unopenable by anyone,
 * including the sender. That is why the queue holds vault-sealed plaintext.
 */
async function postOutgoingMessage(params: {
  conversationId: string;
  clientKey: string;
  kind: MessageKind;
  /** Plaintext for text; the metadata envelope JSON for attachments. */
  plaintext: string;
  attachmentId?: string;
  myUserId: string;
  forwardSecrecy: string;
}): Promise<SendOutcome> {
  const { conversationId, clientKey, kind, attachmentId, myUserId, forwardSecrecy } = params;
  let plaintext = params.plaintext;

  await syncConversationKeys(conversationId, myUserId);
  let readyKey = await waitForConversationKey(conversationId, 2500);
  if (!readyKey) {
    await syncConversationKeys(conversationId, myUserId);
    readyKey = await waitForConversationKey(conversationId, 1500);
  }
  /* Rotate an over-aged version BEFORE encrypting, so this message lands under
     a fresh root rather than one the window is about to retire. */
  if (forwardSecrecy !== "off") {
    const windowMs = FS_WINDOW_MS[forwardSecrecy];
    if (windowMs) await maybeRotateForAge(conversationId, myUserId, windowMs / 2);
  }

  let transferFailed = false;
  if (attachmentId) {
    const envelope = parseAttachmentEnvelope(plaintext);
    if (envelope) {
      if (envelope.blob) {
        /* An earlier attempt already uploaded the payload and recorded its
           crypto envelope here. Uploading again would get a 409 for an id the
           server already holds, and the fresh IV from that second seal is NOT
           the one the stored ciphertext was encrypted with — so the recipient
           could never open it. Reuse, never re-seal. */
      } else {
        const record = await getLocalAttachment(attachmentId, conversationId).catch(() => null);
        const bytes = record ? await openLocalAttachment(record).catch(() => null) : null;
        if (!bytes) {
          /* The payload is not on this device (cleared cache, or another
             install). Nothing to upload — send the metadata so the message is
             not lost, exactly as a failed transfer behaves. */
          transferFailed = true;
        } else {
          const upload = await uploadAttachmentBlob({
            conversationId,
            attachmentId,
            file: new Blob([bytes], { type: record?.mime || envelope.mime }),
          });
          if (upload.ok) {
            plaintext = JSON.stringify(withBlobEnvelope(envelope, upload.blobEnvelope));
            /* Record the upload before the body POST, so a timeout on the body
               cannot leave a stored blob whose envelope we have thrown away. */
            void updateOutboxBody(clientKey, plaintext);
          } else if (upload.error === "network" || /^upload_5\d\d$/.test(upload.error)) {
            /* Offline. Sending the body now would deliver a message the
               recipient cannot play, so hold the whole thing and retry. */
            return { kind: "retryable", reason: upload.error };
          } else {
            /* A real rejection (too large, rejected payload). The message still
               has value as metadata; say so rather than dropping it. */
            transferFailed = true;
          }
        }
      }
    }
  }

  const encrypted = await encryptBody(conversationId, plaintext, kind, myUserId);
  if (!encrypted) return { kind: "retryable", reason: "no_conversation_key" };

  const res = await api<{ message: ServerMessage; replayed?: boolean }>(
    `/api/conversations/${conversationId}/messages`,
    { method: "POST", body: JSON.stringify({ body: encrypted, kind, clientKey }) }
  );
  if (!res.ok) {
    return { kind: classifySendFailure(res.status), reason: res.error ?? "send_failed" };
  }

  const [confirmed] = await decryptServerMessages([res.data.message], myUserId);
  if (!confirmed) return { kind: "retryable", reason: "no_confirmation" };
  return { kind: "sent", message: confirmed, ...(transferFailed ? { transferFailed } : {}) };
}

function toClientMessage(m: ServerMessage): Message {
  return hydrateAttachmentMessage({
    id: m.id,
    conversationId: m.conversationId,
    authorId: m.authorId,
    kind: m.kind as MessageKind,
    body: m.body,
    createdAt: m.createdAt,
    status: m.status,
    authorName: m.authorName,
    expiresAt: m.expiresAt ?? undefined,
    disappearsAfter: m.expiresAt ? "custom" : undefined,
    reactions: m.reactions ?? [],
  });
}

function hydrateAttachmentMessage(message: Message): Message {
  const envelope = parseAttachmentEnvelope(message.body);
  if (!envelope) return message;
  return {
    ...message,
    body: "",
    fileName: envelope.name,
    fileSizeBytes: envelope.size,
    attachmentId: envelope.attachmentId,
    attachmentMime: envelope.mime,
    attachmentStoredLocal: message.authorId === "me",
    attachmentBlob: envelope.blob,
    voiceDurationSec: envelope.durationSec,
  };
}

function attachmentMessageFromEnvelope(
  base: Omit<Message, "body" | "fileName" | "fileSizeBytes" | "attachmentId" | "attachmentMime">,
  envelope: AttachmentEnvelope
): Message {
  return {
    ...base,
    body: "",
    fileName: envelope.name,
    fileSizeBytes: envelope.size,
    attachmentId: envelope.attachmentId,
    attachmentMime: envelope.mime,
    attachmentStoredLocal: true,
    attachmentBlob: envelope.blob,
    voiceDurationSec: envelope.durationSec,
  };
}

function toggleLocalReaction(
  reactions: MessageReactionSummary[] | undefined,
  emoji: string
): MessageReactionSummary[] {
  const next = (reactions ?? []).map((r) => ({ ...r }));
  const existing = next.find((r) => r.emoji === emoji);
  if (existing) {
    if (existing.mine) {
      existing.mine = false;
      existing.count = Math.max(0, existing.count - 1);
    } else {
      existing.mine = true;
      existing.count += 1;
    }
  } else {
    next.push({ emoji, count: 1, mine: true });
  }
  return next.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

function toClientConversation(c: ServerConversation): Conversation {
  const ghost = !!c.ghostSeconds && c.ghostSeconds > 0;
  return {
    id: c.id,
    contactId: c.contactId,
    isGroup: c.isGroup || undefined,
    groupName: c.groupName,
    groupDescription: c.groupDescription,
    memberCount: c.memberCount,
    myRole: c.myRole,
    circleId: c.circleId,
    circleName: c.circleName,
    unreadCount: c.unreadCount,
    ghost,
    ghostTimer: secondsToTimer(c.ghostSeconds),
    aiAccess: c.aiAccess,
    aiEffective: c.aiEffective,
    aiCircleDefault: c.aiCircleDefault as Conversation["aiCircleDefault"],
    persistentMemory: c.persistentMemory,
    historyPolicy: c.historyPolicy,
    messages: [],
  };
}

/* ---------- E2EE message decryption layer ----------
 * Server bodies arrive as ciphertext envelopes (or legacy plaintext from
 * before the migration, or plaintext system notices). Decrypt BEFORE
 * anything enters the store; failures render as locked bubbles. */
async function decryptServerMessages(
  messages: ServerMessage[],
  myUserId: string | undefined
): Promise<Message[]> {
  if (!myUserId) {
    const plain = messages.map(toClientMessage);
    void cacheMessages(plain);
    return plain;
  }

  /* Cached BEFORE hydration. `hydrateAttachmentMessage` blanks `body` and moves
     the attachment envelope into separate fields, but the decrypted body IS
     that envelope — caching after hydration would lose it and leave every
     cached note with no metadata to render or fetch from. */
  const cacheable: Message[] = [];

  const out = await Promise.all(
    messages.map(async (m) => {
      if (m.kind === "system" || m.authorId === "system" || m.authorId === "cloak") {
        const notice = toClientMessage(m); // service notices / local AI answers
        cacheable.push(notice);
        return notice;
      }
      const base = toClientMessage(m);
      const result = await decryptBody(
        m.conversationId,
        m.body,
        m.kind,
        m.authorId,
        myUserId
      );
      if (!result.ok) {
        const locked: Message = {
          ...base,
          body: "",
          bodyLocked: true,
          bodyLockedReason: result.reason ?? "missing",
        };
        cacheable.push(locked);
        return locked;
      }
      const decrypted: Message = { ...base, body: result.text ?? base.body };
      cacheable.push(decrypted);
      return hydrateAttachmentMessage(decrypted);
    })
  );

  void cacheMessages(cacheable);
  return out;
}

async function toClientConversationAsync(
  c: ServerConversation,
  myUserId: string | undefined
): Promise<Conversation> {
  return {
    ...toClientConversation(c),
    messages: await decryptServerMessages(c.messages, myUserId),
  };
}

/* Cloak Mode protection (user feedback round 4): turning Cloak Mode OFF can
   require a PIN or platform biometrics. Only hashes / credential IDs are
   stored — never a plain-text PIN. */
export interface CloakGuardSettings {
  /** SHA-256 hex hash of the PIN, or null when no PIN is set. */
  pinHash: string | null;
  /** Base64url WebAuthn credential id, or null when biometrics are off. */
  credentialId: string | null;
}

export interface CloakGateState {
  open: boolean;
  /** "cloak-off" — verifying to turn Cloak Mode off.
   *  "manage" — verifying to change or remove protection. */
  purpose: "cloak-off" | "manage";
}

interface CloakState {
  /* Auth (session cookie is the source of truth; this slice mirrors it) */
  auth: { user: AuthUser | null; checked: boolean };
  /** Set the mirrored auth user (guest registration on the invite screen). */
  setAuthUser: (user: AuthUser) => void;
  bootstrapAuth: () => Promise<void>;
  signIn: (
    handle: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string; status?: number }>;
  /** Create an account (optionally redeeming a Reserve guest invitation
   *  atomically) and sign in — mirrors signIn's post-auth pipeline. */
  register: (
    handle: string,
    password: string,
    displayName: string | undefined,
    inviteToken?: string,
    paymentClaimToken?: string,
    adviserInviteToken?: string,
    email?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
  /** Erase the account server-side, then take this account's local copy
   *  (keys, cache, outbox) with it. The server re-verifies the password and
   *  requires the handle typed back; this only carries the request. */
  deleteAccount: (
    password: string,
    confirmHandle: string
  ) => Promise<{ ok: true } | { ok: false; error: string; status?: number }>;
  /** Download everything the server holds about the account as JSON. */
  exportAccountData: () => Promise<{ ok: true } | { ok: false; error: string }>;

  /* Server hydration / sync */
  hydrateServerData: (contacts: ServerContact[], conversations: ServerConversation[]) => Promise<void>;
  /** Paint saved conversations + history from the local cache. Safe to call
   *  before (or instead of) the server answering. */
  hydrateLocalCache: () => Promise<void>;
  mergeConversationList: (
    activeId: string | null,
    contacts: ServerContact[],
    conversations: ServerConversation[]
  ) => Promise<void>;
  replaceServerMessages: (
    conversationId: string,
    messages: ServerMessage[],
    hasMore?: boolean
  ) => Promise<void>;
  /** Fetch one older page for a conversation (cursor = oldest held
   *  message) and merge it into state. Returns true when a page was
   *  appended. */
  loadOlderMessages: (conversationId: string) => Promise<boolean>;
  openServerConversation: (
    handle: string,
    ghostSeconds?: number
  ) => Promise<string | null>;

  /* Groups (groups & circles spec) — server is authoritative for membership */
  createServerGroup: (
    title: string,
    handles: string[],
    description?: string,
    ghostSeconds?: number
  ) => Promise<
    | { ok: true; conversationId: string; unknownHandles: string[] }
    | { ok: false; error: string }
  >;
  fetchGroupMembers: (
    conversationId: string
  ) => Promise<
    | { ok: true; members: GroupMember[]; myRole: string; pendingRequests: GroupJoinRequest[] }
    | { ok: false; error: string }
  >;
  addServerMembers: (
    conversationId: string,
    handles: string[]
  ) => Promise<
    | { ok: true; members: GroupMember[]; unknownHandles: string[] }
    | { ok: false; error: string }
  >;
  removeServerMember: (conversationId: string, userId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  leaveServerConversation: (conversationId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  setServerMemberRole: (
    conversationId: string,
    userId: string,
    role: "admin" | "member" | "owner"
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  renameServerGroup: (
    conversationId: string,
    title: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  createServerGroupInvite: (
    conversationId: string,
    opts: { maxUses?: number | null; expiresInDays?: number | null; requiresApproval?: boolean }
  ) => Promise<
    | { ok: true; token: string; inviteId: string; expiresAt: number | null; requiresApproval: boolean }
    | { ok: false; error: string }
  >;
  revokeServerGroupInvite: (
    conversationId: string,
    inviteId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  resolveServerJoinRequest: (
    conversationId: string,
    requestId: string,
    approve: boolean
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  redeemServerGroupInvite: (
    token: string
  ) => Promise<
    | { ok: true; result: "joined" | "requested"; conversationId?: string }
    | { ok: false; error: string }
  >;

  /* Cloak Circles (circles spec §23-§68) — server-authoritative mirror
     (§80); never persisted. */
  circles: CircleSummary[];
  circlesLoading: boolean;
  activeCircle: CircleDetail | null;
  circleLoading: boolean;
  fetchCircles: () => Promise<void>;
  fetchCircleDetail: (circleId: string) => Promise<{ ok: boolean }>;
  createCircle: (
    name: string,
    description?: string,
    templateId?: string
  ) => Promise<{ ok: true; circleId: string } | { ok: false; error: string }>;
  renameCircle: (
    circleId: string,
    name: string,
    description?: string | null
  ) => Promise<{ ok: boolean; error?: string }>;
  setCirclePolicy: (
    circleId: string,
    patch: { newMemberHistory?: "none" | "all"; cloudAi?: "disabled" | "current_request" | "allowed"; inviteExpiryDays?: number }
  ) => Promise<{ ok: boolean; error?: string }>;
  setCircleArchived: (circleId: string, archived: boolean) => Promise<{ ok: boolean; error?: string }>;
  deleteCircle: (circleId: string) => Promise<{ ok: boolean; error?: string }>;
  addCircleMembers: (
    circleId: string,
    handles: string[]
  ) => Promise<{ ok: true; added: number; unknownHandles: string[] } | { ok: false; error: string }>;
  removeCircleMember: (circleId: string, userId: string) => Promise<{ ok: boolean; error?: string }>;
  setCircleMemberRole: (
    circleId: string,
    userId: string,
    role: "owner" | "admin" | "member"
  ) => Promise<{ ok: boolean; error?: string }>;
  leaveCircle: (circleId: string) => Promise<{ ok: boolean; error?: string }>;
  createCircleGroup: (
    circleId: string,
    input: { title: string; description?: string; handles?: string[]; ghostSeconds?: number }
  ) => Promise<{ ok: true; conversationId: string } | { ok: false; error: string }>;
  assignMemberToCircleGroup: (
    circleId: string,
    groupId: string,
    handle: string
  ) => Promise<{ ok: boolean; error?: string }>;
  createCircleInvite: (
    circleId: string,
    groupIds: string[],
    expiresInDays?: number,
    requiresApproval?: boolean
  ) => Promise<{ ok: true; token: string; url: string } | { ok: false; error: string }>;
  revokeCircleInvite: (circleId: string, inviteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Approve or deny a pending join request (spec §41) — managers. */
  resolveCircleJoinRequest: (
    circleId: string,
    requestId: string,
    approve: boolean
  ) => Promise<{ ok: boolean; error?: string }>;

  /* In-app notifications (spec §62) — server truth, fetch-mirror.
     Named "inbox" to avoid colliding with the NotificationSettings. */
  inbox: ServerNotification[];
  unreadInbox: number;
  inboxLoading: boolean;
  fetchInbox: () => Promise<void>;
  markInboxRead: (id?: string, all?: boolean) => Promise<void>;

  /* Blocked users (spec §75). */
  blockedUsers: BlockedUserEntry[];
  fetchBlockedUsers: () => Promise<void>;
  blockUserByHandle: (handle: string) => Promise<{ ok: boolean; error?: string }>;
  unblockUserById: (userId: string) => Promise<void>;

  /* Groups & Circles privacy settings (spec §74) — server-backed. */
  serverPrivacy: ServerPrivacySettings;
  fetchPrivacySettings: () => Promise<void>;
  savePrivacySettings: (patch: Partial<ServerPrivacySettings>) => Promise<void>;

  /* Global privacy */
  cloakMode: boolean;
  /** Chat text size (user feedback): small | medium | large. */
  chatFontSize: "small" | "medium" | "large";
  /** Colour theme. Dark is the default; light uses a clean white palette.
      Carried on <html> as a class by ThemeSync — see src/lib/cloak/theme.ts. */
  theme: CloakTheme;
  /** Web nav rail collapsed to icons (user feedback round 14). */
  sidebarCollapsed: boolean;
  /** Target language for the long-press message translation (code from
      TRANSLATION_LANGUAGES, e.g. "ru"). Runs on-device. */
  translationLanguage: string;
  /** Forward-secrecy window: how long old conversation-key versions stay
   *  decryptable before their keys are destroyed (local + server wraps).
   *  "off" retains all history keys. Default "off". */
  forwardSecrecy: ForwardSecrecyWindow;
  setCloakMode: (on: boolean) => void;
  toggleCloakMode: () => void;
  setChatFontSize: (size: "small" | "medium" | "large") => void;
  setTheme: (theme: CloakTheme) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTranslationLanguage: (code: string) => void;
  setForwardSecrecy: (window: ForwardSecrecyWindow) => void;

  /* Cloak Mode protection — PIN / biometric gate for turning it off */
  cloakGuard: CloakGuardSettings;
  setCloakGuardPin: (pinHash: string | null) => void;
  setCloakGuardBiometric: (credentialId: string | null) => void;
  cloakGate: CloakGateState;
  openCloakGate: (purpose: CloakGateState["purpose"], onVerified?: (ok: boolean) => void) => void;
  closeCloakGate: (verified: boolean) => void;

  /* New-user onboarding — UI-only preference, NEVER membership/identity.
     Per-device (localStorage). Skippable, with re-surfacing guardrails. */
  onboarding: OnboardingState;
  completeOnboarding: () => void;
  completeOnboardingStep: (step: OnboardingStepId) => void;
  skipOnboardingStep: (step: OnboardingStepId) => void;
  reopenOnboarding: () => void;
  dismissOnboardingNudge: (step: OnboardingStepId) => void;

  /* Membership (server-authoritative: /api/auth, /api/payments/verify and
     /api/membership are the ONLY writers. The store is a display mirror —
     never persisted, never trusted for access decisions, settlement spec
     §85 "membership does not trust localStorage". */
  membership: MembershipEntitlement;
  setMembershipEntitlement: (entitlement: MembershipEntitlement) => void;

  /* Whether this account is on the admin allowlist (CLOAK_ADMIN_HANDLES /
     _USER_IDS). Hydrated from /api/auth/* on every session and NEVER
     persisted, so an allowlist change applies at the next hydration.
     Display-only: it decides whether Settings offers the admin entry, and is
     never consulted for access — every /api/admin/* route re-checks the same
     predicate server-side (adviser invitation spec §4). */
  isAdmin: boolean;

  /* Reserve guest passes (spec §7-§13) — server-backed registry, fetched
     per session for Reserve members. Never persisted. */
  guestPasses: ReserveGuestPass[];
  passInvites: PassInviteRecord[];
  passAllocation: PassAllocationView | null;
  passesLoading: boolean;
  fetchGuestPasses: () => Promise<void>;
  issueGuestPass: (input: IssueGuestPassInput) => Promise<
    | {
        ok: true;
        pass: ReserveGuestPass;
        invite: PassInviteRecord;
        token: string;
        link: string;
        qrDataUrl: string | null;
      }
    | { ok: false; error: string }
  >;
  revokeGuestPass: (passId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  redeemGuestPassToken: (
    token: string
  ) => Promise<
    | { ok: true; entitlement: MembershipEntitlement }
    | { ok: false; error: string }
  >;

  /* Data */
  contacts: Contact[];
  conversations: Conversation[];
  devices: CloakDevice[];
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;

  /* Chat list filters (All / Unread / Groups are built in) */
  chatFilters: ChatFilter[];
  addChatFilter: (label: string, conversationIds: string[]) => string;
  removeChatFilter: (id: string) => void;

  /* Open the conversation with a contact, creating one when needed */
  openOrCreateConversation: (contactId: string) => string | null;

  /* Messaging */
  sendMessage: (conversationId: string, body: string, kind?: Message["kind"]) => string;
  sendAttachment: (
    conversationId: string,
    file: File,
    options?: { durationSec?: number }
  ) => Promise<{ ok: true; messageId: string } | { ok: false; error: string }>;
  /**
   * Re-attempt a message that is queued or failed. Safe to call repeatedly:
   * the message keeps its clientKey, so the server replays rather than
   * duplicating however many times this runs.
   */
  retryMessage: (conversationId: string, messageId: string) => Promise<boolean>;
  /**
   * Recipient side of attachment transport: fetch the uploaded ciphertext and
   * open it with the conversation key at the version the sender sealed under.
   * Returns null when the keys are not on this device yet or the payload cannot
   * be opened — the caller renders the honest "not available" state.
   */
  fetchAttachmentBlob: (
    conversationId: string,
    attachmentId: string,
    blobEnvelope: { v: number; k: string; n: string },
    mime: string
  ) => Promise<Blob | null>;
  updateMessageStatus: (
    conversationId: string,
    messageId: string,
    status: Message["status"]
  ) => void;
  appendAIMessage: (conversationId: string, message: Message) => void;
  markConversationRead: (conversationId: string) => void;
  markViewOnceViewed: (conversationId: string, messageId: string) => void;
  toggleMessageReaction: (
    conversationId: string,
    messageId: string,
    emoji: string
  ) => Promise<void>;
  unlockConversation: (conversationId: string) => void;
  /** Server-backed group AI permission (spec §64). Groups: owner only —
   *  enforced by the route. Returns the effective (§39) state. */
  setConversationAiAccess: (
    conversationId: string,
    allowed: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  setConversationGhostTimer: (
    conversationId: string,
    timer: DisappearingTimer
  ) => Promise<void>;

  /* Security — Dagger (emergency device wipe) + trusted devices */
  fetchDevices: () => Promise<void>;
  revokeDeviceRemote: (deviceId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Remote Dagger: revoke now + queue the local wipe for reconnect (§18). */
  requestRemoteDagger: (deviceId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Execute the emergency wipe on THIS device (hold-to-confirm already
   *  happened in the dialog). Keys first, then everything else (§6). */
  runDagger: () => Promise<void>;
  daggerConfig: DaggerConfiguration;
  setDaggerConfig: (patch: Partial<DaggerConfiguration>) => void;

  /* Settings */
  privacy: PrivacySettings;
  setPrivacy: (patch: Partial<PrivacySettings>) => void;
  ai: AISettings;
  setAI: (patch: Partial<AISettings>) => void;
  notifications: NotificationSettings;
  setNotifications: (patch: Partial<NotificationSettings>) => void;

  /* E2EE (never persisted — keys live in the device-local crypto store) */
  /** "needs-passphrase" means this device lacks the identity key while a
   *  passphrase-wrapped backup exists server-side: restore to decrypt. */
  identityStatus: IdentityStatus | "unknown";
  /** Restore the identity from the server backup with the login
   *  passphrase, then re-hydrate conversations with decryption. */
  restoreIdentityKeys: (passphrase: string) => Promise<boolean>;
  /** Provision / unwrap / heal conversation keys for every conversation
   *  (cooldown-guarded; force=true skips the cooldown). */
  syncE2eeKeys: (force?: boolean) => Promise<void>;
}

let localId = 0;
export function nextLocalId(prefix: string): string {
  localId += 1;
  return `${prefix}-local-${Date.now()}-${localId}`;
}

/* Verification callback for the Cloak Mode gate — module scope so it never
   enters persisted state. */
let cloakGateCallback: ((verified: boolean) => void) | null = null;

/* ---------- Onboarding (UI-only; per-device) ----------
 * Step ids are stable so persisted progress survives refactors. `version` lets
 * us force a re-show when a genuinely new required step is introduced. */
export type OnboardingStepId =
  | "welcome"
  | "keys"
  | "cloakMode"
  | "notifications"
  | "done";

export interface OnboardingState {
  completed: boolean;
  stepsDone: OnboardingStepId[];
  stepsSkipped: OnboardingStepId[];
  dismissedNudges: OnboardingStepId[];
  version: number;
}

export const ONBOARDING_VERSION = 1;

/* Steps that carry an actual action (the ones we may re-surface later). */
export const ONBOARDING_ACTION_STEPS: OnboardingStepId[] = [
  "keys",
  "cloakMode",
  "notifications",
];

export const useCloakStore = create<CloakState>()(
  persist(
    (set, get) => ({
      /* ---------- Auth ---------- */
      auth: { user: null, checked: false },
      setAuthUser: (user) => set((s) => ({ auth: { ...s.auth, user, checked: true } })),
      bootstrapAuth: async () => {
        /* Dagger tombstone (codex §17/§28): a previous run ended here with
           the server revocation pending. The old session must NEVER
           restore — clear the flag, kill the stale cookie, and pick up a
           possibly-queued remote wipe before anything else renders. */
        if (await consumePendingRevocation()) {
          set({ auth: { user: null, checked: true }, isAdmin: false });
          await checkPendingDaggerCommand().catch(() => undefined);
          return;
        }
        const res = await api<{
          user: AuthUser;
          membership: MembershipEntitlement | null;
          isAdmin?: boolean;
        }>("/api/auth/me");
        if (res.ok) {
          const { user, membership, isAdmin } = res.data;
          /* E2EE: a refresh has no passphrase — the device-local identity
             is reused. When it is missing but a server backup exists (new
             browser with a live session), the UI offers a restore prompt. */
          const identityStatus = await ensureIdentity(user.id);
          set((s) => ({
            auth: { user, checked: true },
            membership: membership ?? s.membership,
            isAdmin: isAdmin === true,
            identityStatus,
          }));
          /* Show saved history immediately; the server merge follows. This is
             also the only path that yields an inbox at all if the conversation
             fetch below fails on a flaky connection. */
          void get().hydrateLocalCache();
          /* Dagger device registry: bind this install to the session and
             check for a queued remote wipe (codex §16/§18). */
          const identity = deviceIdentity();
          void api("/api/security/devices", {
            method: "POST",
            body: JSON.stringify({
              deviceId: identity.deviceId,
              deviceName: identity.name,
              deviceToken: identity.deviceToken,
            }),
          });
          void checkPendingDaggerCommand().catch(() => undefined);
          /* Reserve members: hydrate the pass registry for this session. */
          if (membership?.membership === "reserve") void get().fetchGuestPasses();
          const convs = await api<{
            contacts: ServerContact[];
            conversations: ServerConversation[];
          }>("/api/conversations");
          if (convs.ok) await get().hydrateServerData(convs.data.contacts, convs.data.conversations);
          /* Server-backed mirrors for this session (§62/§74/§75). */
          void get().fetchInbox();
          void get().fetchPrivacySettings();
          void get().fetchBlockedUsers();
          /* Web push: silently re-assert this device's subscription for the
             signed-in account (only if push was already granted — never prompts). */
          void syncPushAfterAuth();
        } else {
          set({ auth: { user: null, checked: true }, isAdmin: false });
          /* Signed out with a known device credential — this may be a
             Remote Dagger target reconnecting (codex §18). */
          await checkPendingDaggerCommand().catch(() => undefined);
        }
      },
      signIn: async (handle, password) => {
        const identity = deviceIdentity();
        const res = await api<{
          user: AuthUser;
          membership: MembershipEntitlement | null;
          isAdmin?: boolean;
        }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            handle,
            password,
            deviceId: identity.deviceId,
            deviceName: identity.name,
            deviceToken: identity.deviceToken,
          }),
        });
        if (!res.ok) {
          return { ok: false as const, error: res.error ?? "server_error", status: res.status };
        }
        const { user, membership, isAdmin } = res.data;
        /* Open the gate the moment the session exists. Everything after this
           point is enrichment (E2EE keys, chat hydration, push) and must
           never be able to hold a signed-in user on the sign-in screen. */
        set((s) => ({
          auth: { user, checked: true },
          membership: membership ?? s.membership,
          isAdmin: isAdmin === true,
        }));
        /* E2EE: sign-in has the passphrase — provision the identity on
           first use (uploads the public key + wrapped backup) or restore
           it from the backup on a NEW device. BOUNDED: PBKDF2 at 600k
           iterations plus a key fetch is seconds of work on a phone, and a
           stalled request must not become an infinite spinner. If it does
           not land in time the sync loop re-runs key maintenance anyway. */
        const identityStatus = await withTimeout(
          ensureIdentity(user.id, password),
          IDENTITY_PROVISION_TIMEOUT_MS
        );
        if (identityStatus) set({ identityStatus });
        /* Reserve members: hydrate the pass registry for this session. */
        if (membership?.membership === "reserve") void get().fetchGuestPasses();
        const list = await api<{
          contacts: ServerContact[];
          conversations: ServerConversation[];
        }>("/api/conversations");
        if (list.ok) {
          await get()
            .hydrateServerData(list.data.contacts, list.data.conversations)
            .catch(() => undefined);
        }
        void get().fetchInbox();
        void get().fetchPrivacySettings();
        void get().fetchBlockedUsers();
        /* Web push: re-assert this device's endpoint for the signing-in user
           (no-op unless push was previously granted on this device). */
        void syncPushAfterAuth();
        return { ok: true as const };
      },
      register: async (handle, password, displayName, inviteToken, paymentClaimToken, adviserInviteToken, email) => {
        const identity = deviceIdentity();
        const res = await api<{
          user: AuthUser;
          membership: MembershipEntitlement | null;
          isAdmin?: boolean;
        }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            handle,
            password,
            displayName,
            inviteToken: inviteToken || undefined,
            paymentClaimToken: paymentClaimToken || undefined,
            adviserInviteToken: adviserInviteToken || undefined,
            email: email || undefined,
            deviceId: identity.deviceId,
            deviceName: identity.name,
            deviceToken: identity.deviceToken,
          }),
        });
        if (!res.ok) {
          return { ok: false as const, error: res.error ?? "server_error", status: res.status };
        }
        const { user, membership, isAdmin } = res.data;
        /* Same contract as signIn: the session opens the gate immediately,
           and identity provisioning is bounded enrichment. */
        set((s) => ({
          auth: { user, checked: true },
          membership: membership ?? s.membership,
          isAdmin: isAdmin === true,
        }));
        /* Registration has the passphrase — provision the E2EE identity on
           first use (public key + wrapped backup upload). */
        const identityStatus = await withTimeout(
          ensureIdentity(user.id, password),
          IDENTITY_PROVISION_TIMEOUT_MS
        );
        if (identityStatus) set({ identityStatus });
        if (membership?.membership === "reserve") void get().fetchGuestPasses();
        const list = await api<{
          contacts: ServerContact[];
          conversations: ServerConversation[];
        }>("/api/conversations");
        if (list.ok) {
          await get()
            .hydrateServerData(list.data.contacts, list.data.conversations)
            .catch(() => undefined);
        }
        void get().fetchInbox();
        void get().fetchPrivacySettings();
        void get().fetchBlockedUsers();
        return { ok: true as const };
      },
      signOut: async () => {
        void api("/api/auth/logout", { method: "POST" });
        set({
          auth: { user: null, checked: true },
          isAdmin: false,
          contacts: [],
          conversations: [],
          activeConversationId: null,
          inbox: [],
          unreadInbox: 0,
          blockedUsers: [],
          /* Server truth resets with the session; the next sign-in
             rehydrates from /api/auth. */
          membership: {
            membership: "none",
            origin: "admin_grant",
            active: false,
            renewal: "never",
          },
          guestPasses: [],
          passInvites: [],
          passAllocation: null,
        });
      },

      /* ---------- Account lifecycle ---------- */

      deleteAccount: async (password, confirmHandle) => {
        const user = get().auth.user;
        if (!user) return { ok: false, error: "unauthenticated" };

        let status = 0;
        let error: string | undefined;
        try {
          const res = await fetch("/api/account", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password, confirmHandle }),
          });
          status = res.status;
          const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (!res.ok || json.ok !== true) error = json.error ?? "server_error";
        } catch {
          return { ok: false, error: "network_error" };
        }
        if (error) return { ok: false, error, status };

        /* The server row is gone. Remove THIS account's local copy — never
           the whole origin's. One install may serve several Cloak IDs, so
           `destroyCryptoKeys()`/`clearSensitiveStorage()` (Dagger's
           device-wide wipe) would take another account's keyring and cached
           history with it. A failure here must not block the exit: the
           erasure that matters already committed server-side. */
        try {
          forgetLocalIdentity(user.id);
          forgetVaultKey(user.id);
          await clearLocalCacheForOwner(user.id);
        } catch {
          /* ignore */
        }

        set({
          auth: { user: null, checked: true },
          isAdmin: false,
          contacts: [],
          conversations: [],
          activeConversationId: null,
          inbox: [],
          unreadInbox: 0,
          blockedUsers: [],
          membership: {
            membership: "none",
            origin: "admin_grant",
            active: false,
            renewal: "never",
          },
          guestPasses: [],
          passInvites: [],
          passAllocation: null,
          devices: [],
        });
        /* Full reload: no stale in-memory slice, and the cleared cookie is
           honoured from a clean boot. */
        window.location.assign("/");
        return { ok: true };
      },

      exportAccountData: async () => {
        try {
          const res = await fetch("/api/account/export", { method: "GET" });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            return { ok: false, error: json.error ?? "export_failed" };
          }
          /* Fetch-then-save rather than navigating at the endpoint, so a
             401/429 surfaces as copy instead of a tab full of raw JSON. */
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `cloak-${get().auth.user?.handle ?? "account"}-${new Date()
            .toISOString()
            .slice(0, 10)}.json`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          return { ok: true };
        } catch {
          return { ok: false, error: "network_error" };
        }
      },

      /* ---------- Server hydration / sync ---------- */
      hydrateServerData: async (contacts, conversations) => {
        const currentActive = get().activeConversationId;
        const myUserId = get().auth.user?.id;
        const clientConvs = await Promise.all(
          conversations.map((c) => toClientConversationAsync(c, myUserId))
        );

        /* MERGE over anything already on screen from the local cache. The server
           window is authoritative for the rows it contains, but it is capped
           (`MESSAGE_HISTORY_CAP` = 200), so cached rows beyond it must survive
           or the cache would be pointless. */
        const existingById = new Map(get().conversations.map((c) => [c.id, c]));
        const mergedConvs = clientConvs.map((client) => {
          const existing = existingById.get(client.id);
          if (!existing?.messages.length) return client;
          const byId = new Map(existing.messages.map((m) => [m.id, m]));
          for (const m of client.messages) byId.set(m.id, m);
          const messages = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
          return { ...client, messages };
        });

        set({
          contacts,
          conversations: mergedConvs,
          activeConversationId:
            currentActive && mergedConvs.some((c) => c.id === currentActive)
              ? currentActive
              : null,
        });
        void cacheConversations(mergedConvs);
        /* E2EE: provision / unwrap / heal keys for every conversation
           (inflight-guarded + cooldown inside the orchestrator). */
        void get().syncE2eeKeys();
      },
      hydrateLocalCache: async () => {
        /* Paint saved conversations and history before (or instead of) the
           server answering. On a slow or dropped connection this is what turns
           an empty inbox into the history the user already had. */
        const cached = await loadCachedConversations();
        const withHistory = await Promise.all(
          cached.map(async (c) => ({
            ...c,
            messages: (await loadCachedMessages(c.id)).map((row) =>
              cachedRowToMessage(row, hydrateAttachmentMessage)
            ),
          }))
        );

        /* Pending sends are NOT in the message cache — they never reached the
           server, so nothing ever cached them. They must be re-painted from the
           outbox, or a reload would silently swallow the words the user wrote
           while offline. */
        const pending = await listOutbox();
        if (!withHistory.length && !pending.length) return;

        const queuedByConversation = new Map<string, Message[]>();
        for (const entry of pending) {
          const envelope = parseAttachmentEnvelope(entry.body);
          const base = {
            id: entry.id,
            conversationId: entry.conversationId,
            authorId: "me",
            kind: entry.kind,
            createdAt: entry.createdAt,
            status: "queued" as MessageStatus,
          };
          const message = envelope
            ? attachmentMessageFromEnvelope(base, envelope)
            : { ...base, body: entry.body };
          const list = queuedByConversation.get(entry.conversationId) ?? [];
          list.push(message);
          queuedByConversation.set(entry.conversationId, list);
        }

        set((s) => {
          const byId = new Map(withHistory.map((c) => [c.id, c]));
          /* Anything the live session already holds wins — it is newer. */
          for (const c of s.conversations) byId.set(c.id, c);
          /* Then re-attach any pending send the live state is missing. Keyed by
             the clientKey, so a message that already went is not doubled. */
          for (const [conversationId, messages] of queuedByConversation) {
            const conversation = byId.get(conversationId);
            if (!conversation) continue;
            const known = new Set(conversation.messages.map((m) => m.id));
            const missing = messages.filter((m) => !known.has(m.id));
            if (!missing.length) continue;
            byId.set(conversationId, {
              ...conversation,
              messages: [...conversation.messages, ...missing].sort(
                (a, b) => a.createdAt - b.createdAt
              ),
            });
          }
          return { conversations: [...byId.values()] };
        });
      },
      mergeConversationList: async (activeId, contacts, conversations) => {
        const myUserId = get().auth.user?.id;
        const mapped = await Promise.all(
          conversations.map((c) => toClientConversationAsync(c, myUserId))
        );
        set((s) => {
          const next = [...s.conversations];
          for (let i = 0; i < mapped.length; i++) {
            const client = mapped[i]!;
            const server = conversations[i]!;
            const idx = next.findIndex((c) => c.id === client.id);
            const preview = client.messages;
            if (idx === -1) {
              next.push(client);
              continue;
            }
            const existing = next[idx]!;
            /* The open conversation owns its own message list (full sync);
               never show unread on the row the user is looking at. */
            const unread = existing.id === activeId ? 0 : server.unreadCount;
            if (existing.messages.length > preview.length) {
              /* Local history is richer — merge the preview in by id. */
              const merged = [...existing.messages];
              for (const pm of preview) {
                const at = merged.findIndex((m) => m.id === pm.id);
                if (at >= 0) merged[at] = pm;
                else merged.push(pm);
              }
              merged.sort((a, b) => a.createdAt - b.createdAt);
              next[idx] = {
                ...existing,
                unreadCount: unread,
                historyPolicy: client.historyPolicy ?? existing.historyPolicy,
                messages: merged,
              };
            } else {
              next[idx] = {
                ...existing,
                unreadCount: unread,
                historyPolicy: client.historyPolicy ?? existing.historyPolicy,
                messages: preview,
              };
            }
          }
          return {
            contacts,
            conversations: next,
            activeConversationId:
              s.activeConversationId && next.some((c) => c.id === s.activeConversationId)
                ? s.activeConversationId
                : null,
          };
        });
      },
      replaceServerMessages: async (conversationId, messages, hasMore) => {
        const myUserId = get().auth.user?.id;
        const client = await decryptServerMessages(messages, myUserId);
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const serverIds = new Set(client.map((m) => m.id));
            /* MERGE, not replace: the newest server window replaces its own
               rows (tick states stay fresh), but pages the user already
               loaded via "load earlier" MUST survive the 2.5s poll. Local
               extras that are gone from the window are dropped only when
               ghost-expired (server purged them); in-flight outgoing
               messages and local-only Cloak AI answers always stay. */
            const nowMs = Date.now();
            const keep = c.messages.filter((m) => {
              if (serverIds.has(m.id)) return false; // fresh copy below
              if (m.expiresAt && m.expiresAt <= nowMs) return false;
              if (m.status === "failed") return true;
              return true;
            });
            const byId = new Map(keep.map((m) => [m.id, m]));
            for (const m of client) byId.set(m.id, m);
            const merged = [...byId.values()];
            merged.sort((a, b) => a.createdAt - b.createdAt);
            return {
              ...c,
              messages: merged,
              unreadCount: 0,
              ...(hasMore !== undefined
                ? {
                    /* The poll window can only say "older rows exist beyond
                       me" — it must never resurrect a pagination-exhausted
                       false (the user already fetched everything older). */
                    historyHasMore: c.historyHasMore === false ? false : hasMore,
                  }
                : {}),
            };
          }),
        }));
      },
      loadOlderMessages: async (conversationId) => {
        const state = get();
        if (!state.auth.user) return false;
        const conv = state.conversations.find((c) => c.id === conversationId);
        if (!conv || conv.historyLoading || conv.historyHasMore === false) return false;
        const oldest = conv.messages[0];
        if (!oldest) return false; // empty conversation: nothing to page

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, historyLoading: true } : c
          ),
        }));
        try {
          const res = await fetch(
            `/api/conversations/${conversationId}/messages?before=${oldest.createdAt}&limit=50`,
            { cache: "no-store" }
          );
          const json = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            messages?: ServerMessage[];
            hasMore?: boolean;
          };
          if (!res.ok || json.ok !== true || !json.messages) {
            return false;
          }
          const myUserId = get().auth.user?.id;
          const client = await decryptServerMessages(json.messages, myUserId);
          set((s) => ({
            conversations: s.conversations.map((c) => {
              if (c.id !== conversationId) return c;
              const byId = new Map(c.messages.map((m) => [m.id, m]));
              for (const m of client) byId.set(m.id, m);
              const merged = [...byId.values()];
              merged.sort((a, b) => a.createdAt - b.createdAt);
              return {
                ...c,
                messages: merged,
                historyHasMore: json.hasMore ?? false,
              };
            }),
          }));
          return client.length > 0;
        } finally {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === conversationId ? { ...c, historyLoading: false } : c
            ),
          }));
        }
      },
      openServerConversation: async (handle, ghostSeconds) => {
        const res = await api<{
          conversation: ServerConversation;
          contact: ServerContact;
        }>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({
            handle,
            ...(ghostSeconds !== undefined ? { ghostSeconds } : {}),
          }),
        });
        if (!res.ok) return null;
        const { conversation, contact } = res.data;
        const myUserId = get().auth.user?.id;
        const client = await toClientConversationAsync(conversation, myUserId);
        set((s) => {
          const contacts = s.contacts.some((c) => c.id === contact.id)
            ? s.contacts.map((c) => (c.id === contact.id ? contact : c))
            : [...s.contacts, contact];
          const conversations = s.conversations.some((c) => c.id === conversation.id)
            ? s.conversations.map((c) => (c.id === client.id ? client : c))
            : [client, ...s.conversations];
          return { contacts, conversations, activeConversationId: conversation.id };
        });
        /* New (or newly opened) conversation: provision the key right away
           so the first message can be encrypted without waiting. */
        if (myUserId) void syncConversationKeys(conversation.id, myUserId);
        return conversation.id;
      },

      /* ---------- Groups (server-authoritative membership) ---------- */

      createServerGroup: async (title, handles, description, ghostSeconds) => {
        const res = await api<{
          conversation: ServerConversation;
          members: GroupMember[];
          unknownHandles: string[];
        }>("/api/conversations/group", {
          method: "POST",
          body: JSON.stringify({
            title,
            handles,
            description,
            ...(ghostSeconds ? { ghostSeconds } : {}),
          }),
        });
        if (!res.ok) {
          return { ok: false as const, error: res.error ?? "server_error" };
        }
        const { conversation, unknownHandles } = res.data;
        const myUserId = get().auth.user?.id;
        const client = await toClientConversationAsync(conversation, myUserId);
        set((s) => ({
          conversations: s.conversations.some((c) => c.id === client.id)
            ? s.conversations.map((c) => (c.id === client.id ? client : c))
            : [client, ...s.conversations],
          activeConversationId: client.id,
        }));
        if (myUserId) void syncConversationKeys(client.id, myUserId);
        return { ok: true as const, conversationId: client.id, unknownHandles };
      },

      fetchGroupMembers: async (conversationId) => {
        const res = await api<{
          members: GroupMember[];
          myRole: string;
          pendingRequests: GroupJoinRequest[];
        }>(`/api/conversations/${conversationId}/members`);
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        const { members, myRole, pendingRequests } = res.data;
        /* Keep the header's member count and the viewer's role fresh. */
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, memberCount: members.length, myRole: myRole as Conversation["myRole"] }
              : c
          ),
        }));
        return { ok: true as const, members, myRole, pendingRequests };
      },

      addServerMembers: async (conversationId, handles) => {
        const res = await api<{ members: GroupMember[]; unknownHandles: string[] }>(
          `/api/conversations/${conversationId}/members`,
          { method: "POST", body: JSON.stringify({ handles }) }
        );
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        const { members, unknownHandles } = res.data;
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, memberCount: members.length } : c
          ),
        }));
        /* E2EE: give the newcomers key access. History policy decides how:
           "all" re-wraps every version I hold for them; "none" rotates so
           retained history stays unreadable to them. */
        const me = get().auth.user?.id;
        const normalized = handles.map((h) => h.replace(/^@+/, "").toLowerCase());
        const addedIds = members
          .filter((m) => normalized.includes(m.cloakId.replace(/^@+/, "").toLowerCase()))
          .map((m) => m.userId);
        if (me && addedIds.length > 0) {
          const policy =
            get().conversations.find((c) => c.id === conversationId)?.historyPolicy ?? "none";
          if (policy === "all") {
            await shareAllVersionsWith(conversationId, addedIds, me);
          } else {
            await rotateConversationKey(conversationId, addedIds, me);
          }
          void get().syncE2eeKeys(true);
        }
        return { ok: true as const, members, unknownHandles };
      },

      removeServerMember: async (conversationId, userId) => {
        const res = await api(`/api/conversations/${conversationId}/members/${userId}`, {
          method: "DELETE",
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, memberCount: Math.max(0, (c.memberCount ?? 1) - 1) }
              : c
          ),
        }));
        /* E2EE: the server stripped the removed member's wraps — rotate so
           traffic from this moment is unreadable to them. I am still a
           participant, so the keys POST is authorized. */
        const me = get().auth.user?.id;
        if (me) {
          await rotateConversationKey(conversationId, [userId], me);
          void get().syncE2eeKeys(true);
        }
        return { ok: true as const };
      },

      leaveServerConversation: async (conversationId) => {
        const me = get().auth.user?.id;
        /* E2EE: rotate BEFORE leaving — once removed, the keys POST is no
           longer authorized for me. Excluding myself gives the remaining
           members a key I never receive. */
        if (me) await rotateConversationKey(conversationId, [me], me);
        const res = await api(`/api/conversations/${conversationId}/leave`, { method: "POST" });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== conversationId),
          activeConversationId:
            s.activeConversationId === conversationId ? null : s.activeConversationId,
        }));
        if (me) void get().syncE2eeKeys(true);
        return { ok: true as const };
      },

      setServerMemberRole: async (conversationId, userId, role) => {
        const res = await api(`/api/conversations/${conversationId}/role`, {
          method: "POST",
          body: JSON.stringify({ userId, role }),
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        return { ok: true as const };
      },

      renameServerGroup: async (conversationId, title) => {
        const res = await api<{ title: string }>(`/api/conversations/${conversationId}/rename`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, groupName: res.data.title } : c
          ),
        }));
        return { ok: true as const };
      },

      createServerGroupInvite: async (conversationId, opts) => {
        const res = await api<{
          invite: { id: string; token: string; expiresAt: number | null; requiresApproval: boolean };
        }>(`/api/conversations/${conversationId}/invites`, {
          method: "POST",
          body: JSON.stringify(opts),
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        const { invite } = res.data;
        return {
          ok: true as const,
          token: invite.token,
          inviteId: invite.id,
          expiresAt: invite.expiresAt,
          requiresApproval: invite.requiresApproval,
        };
      },

      revokeServerGroupInvite: async (conversationId, inviteId) => {
        const res = await api(`/api/conversations/${conversationId}/invites/${inviteId}`, {
          method: "DELETE",
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        return { ok: true as const };
      },

      resolveServerJoinRequest: async (conversationId, requestId, approve) => {
        const res = await api(`/api/conversations/${conversationId}/requests/${requestId}`, {
          method: "POST",
          body: JSON.stringify({ approve }),
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        return { ok: true as const };
      },

      redeemServerGroupInvite: async (token) => {
        const res = await api<{ result: "joined" | "requested"; conversationId?: string }>(
          `/api/group-invites/${encodeURIComponent(token)}/redeem`,
          { method: "POST" }
        );
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        /* Pull the joined group into the local list right away. */
        if (res.data.result === "joined") {
          const list = await api<{
            contacts: ServerContact[];
            conversations: ServerConversation[];
          }>("/api/conversations");
          if (list.ok) await get().hydrateServerData(list.data.contacts, list.data.conversations);
        }
        return { ok: true as const, result: res.data.result, conversationId: res.data.conversationId };
      },

      /* ---------- Cloak Circles (circles spec §23-§68) ----------
         Server-authoritative mirror (§80): every action round-trips the
         API and re-reads the affected payload; nothing here is persisted. */
      circles: [],
      circlesLoading: false,
      activeCircle: null,
      circleLoading: false,
      fetchCircles: async () => {
        set({ circlesLoading: true });
        const res = await api<{ circles: CircleSummary[] }>("/api/circles");
        if (res.ok) set({ circles: res.data.circles, circlesLoading: false });
        else set({ circlesLoading: false });
      },
      fetchCircleDetail: async (circleId) => {
        set({ circleLoading: true });
        const res = await api<{ circle: CircleDetail }>(`/api/circles/${circleId}`);
        if (res.ok) set({ activeCircle: res.data.circle, circleLoading: false });
        else set({ activeCircle: null, circleLoading: false });
        return { ok: res.ok };
      },
      createCircle: async (name, description, templateId) => {
        const res = await api<{ circleId: string }>("/api/circles", {
          method: "POST",
          body: JSON.stringify({ name, ...(description ? { description } : {}), ...(templateId ? { templateId } : {}) }),
        });
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        await get().fetchCircles();
        return { ok: true as const, circleId: res.data.circleId };
      },
      renameCircle: async (circleId, name, description) => {
        const res = await api(`/api/circles/${circleId}/rename`, {
          method: "POST",
          body: JSON.stringify({ name, ...(description !== undefined ? { description } : {}) }),
        });
        if (res.ok) await get().fetchCircleDetail(circleId);
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      setCirclePolicy: async (circleId, patch) => {
        const res = await api(`/api/circles/${circleId}/policy`, {
          method: "POST",
          body: JSON.stringify(patch),
        });
        if (res.ok) await get().fetchCircleDetail(circleId);
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      setCircleArchived: async (circleId, archived) => {
        const res = await api(`/api/circles/${circleId}/archive`, {
          method: "POST",
          body: JSON.stringify({ archived }),
        });
        if (res.ok) {
          await get().fetchCircleDetail(circleId);
          await get().fetchCircles();
        }
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      deleteCircle: async (circleId) => {
        const res = await api(`/api/circles/${circleId}`, { method: "DELETE" });
        if (res.ok) {
          set({ activeCircle: null });
          await get().fetchCircles();
          // Group conversations survive (detached) — refresh their list so
          // the sidebar drops the circle association immediately.
          const list = await api<{ contacts: ServerContact[]; conversations: ServerConversation[] }>("/api/conversations");
          if (list.ok) await get().hydrateServerData(list.data.contacts, list.data.conversations);
        }
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      addCircleMembers: async (circleId, handles) => {
        const res = await api<{ added: number; unknownHandles: string[]; circle: CircleDetail }>(
          `/api/circles/${circleId}/members/add`,
          { method: "POST", body: JSON.stringify({ handles }) }
        );
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        set({ activeCircle: res.data.circle });
        await get().fetchCircles();
        return { ok: true as const, added: res.data.added, unknownHandles: res.data.unknownHandles };
      },
      removeCircleMember: async (circleId, userId) => {
        const res = await api(`/api/circles/${circleId}/members/remove`, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          await get().fetchCircleDetail(circleId);
          await get().fetchCircles();
          // The member was stripped from circle groups too — refresh chats.
          const list = await api<{ contacts: ServerContact[]; conversations: ServerConversation[] }>("/api/conversations");
          if (list.ok) await get().hydrateServerData(list.data.contacts, list.data.conversations);
        }
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      setCircleMemberRole: async (circleId, userId, role) => {
        const res = await api(`/api/circles/${circleId}/members/role`, {
          method: "POST",
          body: JSON.stringify({ userId, role }),
        });
        if (res.ok) await get().fetchCircleDetail(circleId);
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      leaveCircle: async (circleId) => {
        const res = await api(`/api/circles/${circleId}/leave`, { method: "POST" });
        if (res.ok) {
          set({ activeCircle: null });
          await get().fetchCircles();
          const list = await api<{ contacts: ServerContact[]; conversations: ServerConversation[] }>("/api/conversations");
          if (list.ok) await get().hydrateServerData(list.data.contacts, list.data.conversations);
        }
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      createCircleGroup: async (circleId, input) => {
        const res = await api<{ conversationId: string; conversation: ServerConversation }>(
          `/api/circles/${circleId}/groups/create`,
          {
            method: "POST",
            body: JSON.stringify({
              title: input.title,
              ...(input.description ? { description: input.description } : {}),
              ...(input.handles?.length ? { handles: input.handles } : {}),
              ...(input.ghostSeconds ? { ghostSeconds: input.ghostSeconds } : {}),
            }),
          }
        );
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        const myUserId = get().auth.user?.id;
        const client = await toClientConversationAsync(res.data.conversation, myUserId);
        set((s) => ({
          conversations: s.conversations.some((c) => c.id === client.id)
            ? s.conversations.map((c) => (c.id === client.id ? client : c))
            : [client, ...s.conversations],
          activeConversationId: client.id,
        }));
        if (myUserId) void syncConversationKeys(client.id, myUserId);
        await get().fetchCircleDetail(circleId);
        await get().fetchCircles();
        return { ok: true as const, conversationId: client.id };
      },
      assignMemberToCircleGroup: async (circleId, groupId, handle) => {
        const res = await api(`/api/circles/${circleId}/groups/assign`, {
          method: "POST",
          body: JSON.stringify({ groupId, handle }),
        });
        if (res.ok) {
          await get().fetchCircleDetail(circleId);
          const list = await api<{ contacts: ServerContact[]; conversations: ServerConversation[] }>("/api/conversations");
          if (list.ok) await get().hydrateServerData(list.data.contacts, list.data.conversations);
        }
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      createCircleInvite: async (circleId, groupIds, expiresInDays, requiresApproval) => {
        const res = await api<{ invite: { token: string; url: string } }>(
          `/api/circles/${circleId}/invites`,
          {
            method: "POST",
            body: JSON.stringify({
              groupIds,
              ...(expiresInDays ? { expiresInDays } : {}),
              ...(requiresApproval ? { approvalRequired: true } : {}),
            }),
          }
        );
        if (!res.ok) return { ok: false as const, error: res.error ?? "server_error" };
        await get().fetchCircleDetail(circleId);
        return { ok: true as const, token: res.data.invite.token, url: res.data.invite.url };
      },
      resolveCircleJoinRequest: async (circleId, requestId, approve) => {
        const res = await api(`/api/circles/${circleId}/join-requests/resolve`, {
          method: "POST",
          body: JSON.stringify({ requestId, approve }),
        });
        if (res.ok) await get().fetchCircleDetail(circleId);
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },

      /* ---------- Notifications (§62) ---------- */
      inbox: [],
      unreadInbox: 0,
      inboxLoading: false,
      fetchInbox: async () => {
        set({ inboxLoading: true });
        const res = await api<{ notifications: ServerNotification[]; unread: number }>("/api/notifications");
        if (res.ok) {
          set({ inbox: res.data.notifications, unreadInbox: res.data.unread, inboxLoading: false });
        } else {
          set({ inboxLoading: false });
        }
      },
      markInboxRead: async (id, all) => {
        const res = await api<{ unread: number }>("/api/notifications", {
          method: "POST",
          body: JSON.stringify(all ? { all: true } : { id }),
        });
        if (res.ok) {
          set((s) => ({
            inbox: all
              ? s.inbox.map((n) => ({ ...n, read: true }))
              : s.inbox.map((n) => (n.id === id ? { ...n, read: true } : n)),
            unreadInbox: res.data.unread,
          }));
        }
      },

      /* ---------- Blocked users (§75) ---------- */
      blockedUsers: [],
      fetchBlockedUsers: async () => {
        const res = await api<{ blocked: BlockedUserEntry[] }>("/api/blocks");
        if (res.ok) set({ blockedUsers: res.data.blocked });
      },
      blockUserByHandle: async (handle) => {
        const res = await api<{ blocked: BlockedUserEntry[] }>("/api/blocks", {
          method: "POST",
          body: JSON.stringify({ handle }),
        });
        if (res.ok) set({ blockedUsers: res.data.blocked });
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },
      unblockUserById: async (userId) => {
        const res = await api<{ blocked: BlockedUserEntry[] }>("/api/blocks/unblock", {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        if (res.ok) set({ blockedUsers: res.data.blocked });
      },

      /* ---------- §74 privacy settings ---------- */
      serverPrivacy: {
        groupInvitePolicy: "valid_invite",
        circleInvitePolicy: "valid_invite",
        defaultAiAccess: "allowed",
      },
      fetchPrivacySettings: async () => {
        const res = await api<{ settings: ServerPrivacySettings }>("/api/settings/privacy");
        if (res.ok) set({ serverPrivacy: res.data.settings });
      },
      savePrivacySettings: async (patch) => {
        const res = await api<{ settings: ServerPrivacySettings }>("/api/settings/privacy", {
          method: "PUT",
          body: JSON.stringify(patch),
        });
        if (res.ok) set({ serverPrivacy: res.data.settings });
      },
      revokeCircleInvite: async (circleId, inviteId) => {
        const res = await api(`/api/circles/${circleId}/invites/revoke`, {
          method: "POST",
          body: JSON.stringify({ inviteId }),
        });
        if (res.ok) await get().fetchCircleDetail(circleId);
        return { ok: res.ok, error: res.ok ? undefined : res.error };
      },

      cloakMode: false,
      chatFontSize: "large",
      theme: DEFAULT_CLOAK_THEME,
      sidebarCollapsed: false,
      translationLanguage: "en",
      forwardSecrecy: "off" as ForwardSecrecyWindow,
      setCloakMode: (on) => set({ cloakMode: on }),
      toggleCloakMode: () => set((s) => ({ cloakMode: !s.cloakMode })),
      setChatFontSize: (size) => set({ chatFontSize: size }),
      /* Apply the theme to <html> synchronously, not only via the ThemeSync
         subscription. This guarantees picking Light/Dark in Settings takes
         effect on the very same tick regardless of subscription timing, and it
         is idempotent with the bootstrap script and ThemeSync's mount apply. */
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== "undefined") applyCloakTheme(theme);
      },
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setTranslationLanguage: (code) => set({ translationLanguage: code }),
      setForwardSecrecy: (window) => {
        set({ forwardSecrecy: window });
        /* The orchestrator applies the new window on the next key sync and
           enforces it on every subsequent send. Turning the window off
           stops FUTURE deletions — keys already destroyed stay destroyed. */
        setForwardSecrecyWindow(window === "off" ? null : FS_WINDOW_MS[window] ?? null);
      },

      onboarding: {
        completed: false,
        stepsDone: [],
        stepsSkipped: [],
        dismissedNudges: [],
        version: ONBOARDING_VERSION,
      },
      cloakGuard: { pinHash: null, credentialId: null },
      setCloakGuardPin: (pinHash) =>
        set((s) => ({ cloakGuard: { ...s.cloakGuard, pinHash } })),
      setCloakGuardBiometric: (credentialId) =>
        set((s) => ({ cloakGuard: { ...s.cloakGuard, credentialId } })),

      /* ---------- Onboarding ---------- */
      completeOnboarding: () =>
        set((s) => ({ onboarding: { ...s.onboarding, completed: true } })),
      completeOnboardingStep: (step) =>
        set((s) => ({
          onboarding: {
            ...s.onboarding,
            stepsDone: s.onboarding.stepsDone.includes(step)
              ? s.onboarding.stepsDone
              : [...s.onboarding.stepsDone, step],
            stepsSkipped: s.onboarding.stepsSkipped.filter((x) => x !== step),
          },
        })),
      skipOnboardingStep: (step) =>
        set((s) => ({
          onboarding: {
            ...s.onboarding,
            stepsSkipped: s.onboarding.stepsSkipped.includes(step)
              ? s.onboarding.stepsSkipped
              : [...s.onboarding.stepsSkipped, step],
          },
        })),
      reopenOnboarding: () =>
        set((s) => ({
          onboarding: {
            ...s.onboarding,
            completed: false,
            /* Drop "done" so the flow re-opens at the first un-finished step. */
            stepsSkipped: s.onboarding.stepsSkipped.filter((x) => x !== "done"),
          },
        })),
      dismissOnboardingNudge: (step) =>
        set((s) => ({
          onboarding: {
            ...s.onboarding,
            dismissedNudges: s.onboarding.dismissedNudges.includes(step)
              ? s.onboarding.dismissedNudges
              : [...s.onboarding.dismissedNudges, step],
          },
        })),
      cloakGate: { open: false, purpose: "cloak-off" },
      openCloakGate: (purpose, onVerified) => {
        cloakGateCallback = onVerified ?? null;
        set({ cloakGate: { open: true, purpose } });
      },
      closeCloakGate: (verified) => {
        set((s) => ({ cloakGate: { ...s.cloakGate, open: false } }));
        const cb = cloakGateCallback;
        cloakGateCallback = null;
        cb?.(verified);
      },

      /* Server-authoritative entitlement. The initial state is honest
         "none" — bootstrapAuth/signIn overwrite it from /api/auth. */
      membership: {
        membership: "none",
        origin: "admin_grant",
        active: false,
        renewal: "never",
      },
      setMembershipEntitlement: (entitlement) => set({ membership: entitlement }),

      /* Starts false and is only ever set from a server response — an
         unauthenticated or not-yet-hydrated session must not see the admin
         entry. */
      isAdmin: false,

      /* Reserve pass registry — the database owns statuses; the store is a
         fetch-and-display mirror (spec §7-§13, settlement spec §85). */
      guestPasses: [],
      passInvites: [],
      passAllocation: null,
      passesLoading: false,
      fetchGuestPasses: async () => {
        if (get().membership.membership !== "reserve") return;
        set({ passesLoading: true });
        try {
          const data = await membershipService.getGuestPasses();
          set({
            guestPasses: data.passes,
            passInvites: data.invites,
            passAllocation: data.allocation,
            passesLoading: false,
          });
        } catch {
          set({ passesLoading: false });
        }
      },
      issueGuestPass: async (input) => {
        const result = await membershipService.issueGuestPass(input);
        if (result.ok) await get().fetchGuestPasses();
        return result;
      },
      revokeGuestPass: async (passId) => {
        const result = await membershipService.revokePendingGuestPass(passId);
        if (result.ok) await get().fetchGuestPasses();
        return result;
      },
      redeemGuestPassToken: async (token) => {
        return membershipService.redeemGuestPass(token);
      },

      contacts: [],
      conversations: [],
      /* Trusted devices are a server registry (dagger codex §24) — no
         demo rows: an honest empty list until /api/security responds. */
      devices: [],
      activeConversationId: null,
      setActiveConversation: (id) => set({ activeConversationId: id }),

      chatFilters: [],
      addChatFilter: (label, conversationIds) => {
        const id = nextLocalId("filter");
        set((s) => ({
          chatFilters: [...s.chatFilters, { id, label, conversationIds }],
        }));
        return id;
      },
      removeChatFilter: (id) =>
        set((s) => ({
          chatFilters: s.chatFilters.filter((f) => f.id !== id),
        })),

      openOrCreateConversation: (contactId) => {
        const existing = get().conversations.find(
          (c) => c.contactId === contactId && !c.isGroup
        );
        if (existing) {
          set({ activeConversationId: existing.id });
          return existing.id;
        }
        const contact = get().contacts.find((c) => c.id === contactId);
        if (!contact) return null;
        const id = nextLocalId("c");
        const conversation: Conversation = {
          id,
          contactId,
          aiAccess: "allowed",
          persistentMemory: true,
          messages: [],
        };
        set((s) => ({
          conversations: [conversation, ...s.conversations],
          activeConversationId: id,
        }));
        return id;
      },

      sendMessage: (conversationId, body, kind = "text") => {
        /* The clientKey IS the optimistic id. One value names the queued row,
           the rendered bubble and every retry — and it is what the server uses
           to recognise a repeat instead of creating a duplicate. */
        const id = newClientKey();
        const message: Message = {
          id,
          conversationId,
          authorId: "me",
          kind,
          body,
          createdAt: Date.now(),
          status: "sending",
        };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: [...c.messages, message] }
              : c
          ),
        }));

        /* E2EE: the plaintext NEVER leaves the device — it is encrypted with
           the conversation key inside postOutgoingMessage. A send that cannot
           complete is HELD in the outbox rather than dropped. */
        void (async () => {
          const myUserId = get().auth.user?.id;
          if (!myUserId) {
            setMessageStatus(conversationId, id, "failed");
            return;
          }
          const outcome = await postOutgoingMessage({
            conversationId,
            clientKey: id,
            kind,
            plaintext: body,
            myUserId,
            forwardSecrecy: get().forwardSecrecy,
          });
          await settleOutgoing({ conversationId, id, kind, plaintext: body, outcome });
        })();
        return id;
      },

      fetchAttachmentBlob: async (conversationId, attachmentId, blobEnvelope, mime) => {
        const myUserId = get().auth.user?.id;
        if (!myUserId) return null;
        /* A fresh device may not hold the version the sender sealed under, so
           sync the keyring before concluding the payload is unopenable. */
        if (!getConversationKeyRaw(conversationId, blobEnvelope.v)) {
          await syncConversationKeys(conversationId, myUserId);
          await waitForConversationKey(conversationId, 2500);
        }
        const result = await downloadAttachmentBlob({
          conversationId,
          attachmentId,
          blobEnvelope,
          mime,
        });
        return result.ok ? result.blob : null;
      },

      sendAttachment: async (conversationId, file, options) => {
        if (!file || file.size <= 0) return { ok: false, error: "empty_file" };
        /* Audio becomes a voice note; everything else is a file, or an image
           when the browser handed us an image mime. */
        const kind: MessageKind = file.type.startsWith("audio/")
          ? "voice"
          : file.type.startsWith("image/")
            ? "image"
            : "file";
        let saved: Awaited<ReturnType<typeof saveLocalAttachment>>;
        try {
          saved = await saveLocalAttachment(file, conversationId, {
            durationSec: options?.durationSec,
          });
        } catch {
          return { ok: false, error: "storage_unavailable" };
        }

        /* Same contract as sendMessage: the clientKey is the optimistic id, so
           the queued row, the bubble and every retry name one value. */
        const id = newClientKey();
        const message = attachmentMessageFromEnvelope(
          {
            id,
            conversationId,
            authorId: "me",
            kind,
            createdAt: Date.now(),
            status: "sending",
          },
          saved.envelope
        );

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, messages: [...c.messages, message] } : c
          ),
        }));

        /* The travelling body starts as the metadata-only envelope and gains
           the crypto envelope once the payload is uploaded — all inside
           postOutgoingMessage, which re-reads the bytes from local storage so
           ONE implementation serves an immediate send and a flush days later. */
        const plaintext = JSON.stringify(saved.envelope);

        void (async () => {
          const myUserId = get().auth.user?.id;
          if (!myUserId) {
            setMessageStatus(conversationId, id, "failed");
            return;
          }
          const outcome = await postOutgoingMessage({
            conversationId,
            clientKey: id,
            kind,
            plaintext,
            attachmentId: saved.envelope.attachmentId,
            myUserId,
            forwardSecrecy: get().forwardSecrecy,
          });
          await settleOutgoing({
            conversationId,
            id,
            kind,
            plaintext,
            attachmentId: saved.envelope.attachmentId,
            outcome,
          });
        })();

        return { ok: true, messageId: id };
      },

      retryMessage: async (conversationId, messageId) => {
        const message = get()
          .conversations.find((c) => c.id === conversationId)
          ?.messages.find((m) => m.id === messageId);
        if (!message) return false;
        const myUserId = get().auth.user?.id;
        if (!myUserId) return false;

        setMessageStatus(conversationId, messageId, "sending");

        /* The plaintext is recovered from the message itself: text keeps it in
           `body`, an attachment in the fields the bubble renders from. */
        const envelope = envelopeFromMessage(message);
        const plaintext = envelope ? JSON.stringify(envelope) : message.body;

        const outcome = await postOutgoingMessage({
          conversationId,
          clientKey: messageId,
          kind: message.kind,
          plaintext,
          ...(message.attachmentId ? { attachmentId: message.attachmentId } : {}),
          myUserId,
          forwardSecrecy: get().forwardSecrecy,
        });
        await settleOutgoing({
          conversationId,
          id: messageId,
          kind: message.kind,
          plaintext,
          ...(message.attachmentId ? { attachmentId: message.attachmentId } : {}),
          outcome,
        });
        return outcome.kind === "sent";
      },

      updateMessageStatus: (conversationId, messageId, status) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, status } : m
                  ),
                }
              : c
          ),
        })),

      appendAIMessage: (conversationId, message) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: [...c.messages, message] }
              : c
          ),
        })),

      markConversationRead: (conversationId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        if (!conv || !conv.unreadCount) return; // no-op: avoids update loops
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
          ),
        }));
        void api(`/api/conversations/${conversationId}/read`, { method: "POST" });
      },

      markViewOnceViewed: (conversationId, messageId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, viewed: true } : m
                  ),
                }
                : c
          ),
        })),

      toggleMessageReaction: async (conversationId, messageId, emoji) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? { ...m, reactions: toggleLocalReaction(m.reactions, emoji) }
                      : m
                  ),
                }
              : c
          ),
        }));

        const res = await api<{ reactions: MessageReactionSummary[] }>(
          `/api/conversations/${conversationId}/messages/${messageId}/reactions`,
          { method: "POST", body: JSON.stringify({ emoji }) }
        );
        if (!res.ok) return;

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, reactions: res.data.reactions } : m
                  ),
                }
              : c
          ),
        }));
      },

      unlockConversation: (conversationId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, locked: false } : c
          ),
        })),

      setConversationAiAccess: async (conversationId, allowed) => {
        /* Optimistic flip; the server response carries the §39 effective
           state, which is what the UI actually gates on. */
        const prev = get().conversations.find((c) => c.id === conversationId);
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, aiAccess: allowed ? ("allowed" as const) : ("blocked" as const) }
              : c
          ),
        }));
        const res = await api<{
          aiAccess: "allowed" | "blocked";
          aiEffective: "allowed" | "limited" | "blocked";
          aiCircleDefault: string | null;
        }>(`/api/conversations/${conversationId}/ai`, {
          method: "POST",
          body: JSON.stringify({ allowed }),
        });
        if (res.ok) {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    aiAccess: res.data.aiAccess,
                    aiEffective: res.data.aiEffective,
                    aiCircleDefault: (res.data.aiCircleDefault ?? undefined) as Conversation["aiCircleDefault"],
                  }
                : c
            ),
          }));
          return { ok: true as const };
        }
        /* Revert on refusal (e.g. non-owner on a group). */
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, aiAccess: prev?.aiAccess ?? c.aiAccess } : c
          ),
        }));
        return { ok: false as const, error: res.error ?? "server_error" };
      },

      setConversationGhostTimer: async (conversationId, timer) => {
        const seconds = GHOST_TIMER_SECONDS[timer] ?? 0;
        const prev = get().conversations.find((c) => c.id === conversationId);
        /* Optimistic — revert if the server rejects. */
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, ghost: seconds > 0, ghostTimer: timer }
              : c
          ),
        }));
        const res = await api<{ ghostSeconds: number | null }>(
          `/api/conversations/${conversationId}/ghost`,
          { method: "POST", body: JSON.stringify({ seconds }) }
        );
        if (!res.ok) {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    ghost: prev?.ghost ?? false,
                    ghostTimer: prev?.ghostTimer ?? "off",
                  }
                : c
            ),
          }));
          return;
        }
        /* Adopt server truth (normalizes unknown timers). */
        const ghost = !!res.data.ghostSeconds && res.data.ghostSeconds > 0;
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  ghost,
                  ghostTimer: secondsToTimer(res.data.ghostSeconds),
                }
              : c
          ),
        }));
      },

      /* ---------- Dagger + trusted devices (codex §16/§18/§24) ---------- */
      fetchDevices: async () => {
        const res = await api<{
          devices: { deviceId: string; name: string; addedAt: string; lastActive: string; current: boolean }[];
        }>("/api/security/devices");
        if (res.ok) {
          set({
            devices: res.data.devices.map((d) => ({
              id: d.deviceId,
              name: d.name,
              platform: "",
              addedAt: new Date(d.addedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              }),
              lastActive: relativeTime(d.lastActive),
              trusted: true,
              current: d.current,
            })),
          });
        }
      },
      revokeDeviceRemote: async (deviceId) => {
        const res = await api(`/api/security/devices/${encodeURIComponent(deviceId)}/revoke`, {
          method: "POST",
        });
        if (res.ok) {
          await get().fetchDevices();
          return { ok: true as const };
        }
        return { ok: false as const, error: res.error ?? "server_error" };
      },
      requestRemoteDagger: async (deviceId) => {
        const res = await api(`/api/security/devices/${encodeURIComponent(deviceId)}/dagger`, {
          method: "POST",
        });
        if (res.ok) {
          await get().fetchDevices();
          return { ok: true as const };
        }
        return { ok: false as const, error: res.error ?? "server_error" };
      },
      runDagger: async () => {
        const silent = get().daggerConfig.silentCompletion;
        await daggerCurrentDevice(silent);
        /* The wipe cleared persistent state; blank the in-memory slice too
           so nothing sensitive lingers behind the lock overlay (§6). */
        set({
          auth: { user: null, checked: true },
          isAdmin: false,
          contacts: [],
          conversations: [],
          activeConversationId: null,
          guestPasses: [],
          passInvites: [],
          passAllocation: null,
          devices: [],
          membership: { membership: "none", origin: "admin_grant", active: false, renewal: "never" },
        });
      },
      daggerConfig: DAGGER_DEFAULTS,
      setDaggerConfig: (patch) =>
        set((s) => ({ daggerConfig: { ...s.daggerConfig, ...patch } })),

      /* ---------- E2EE identity + key maintenance ---------- */
      identityStatus: "unknown",
      restoreIdentityKeys: async (passphrase) => {
        const user = get().auth.user;
        if (!user) return false;
        const status = await restoreIdentity(user.id, passphrase);
        set({ identityStatus: status });
        if (status !== "ready") return false;
        /* Keys are back on this device — re-pull conversations so every
           ciphertext decrypts (and provision/heal with the new identity). */
        const convs = await api<{
          contacts: ServerContact[];
          conversations: ServerConversation[];
        }>("/api/conversations");
        if (convs.ok) await get().hydrateServerData(convs.data.contacts, convs.data.conversations);
        return true;
      },
      syncE2eeKeys: (() => {
        /* Module-closure cooldown: the sync loop calls this every tick;
           the GET per conversation is the only cost, so keep it at most
           every 15 seconds unless forced by a membership change. */
        let lastRun = 0;
        return async (force?: boolean) => {
          const user = get().auth.user;
          if (!user) return;
          const now = Date.now();
          if (!force && now - lastRun < 15_000) return;
          lastRun = now;
          /* Push the current FS window into the orchestrator (cheap setter;
             also re-applies after reload since module state resets). */
          const fs = get().forwardSecrecy;
          setForwardSecrecyWindow(fs === "off" ? null : FS_WINDOW_MS[fs] ?? null);
          const convs = get().conversations;
          await Promise.all(
            convs.map((c) =>
              syncConversationKeys(c.id, user.id).catch(() => undefined)
            )
          );
          /* Forward secrecy: retire key versions older than the window
             (server wraps first, then local seeds). No-op when off. */
          if (fs !== "off") {
            await applyForwardSecrecy(user.id).catch(() => undefined);
          }
        };
      })(),

      privacy: {
        readReceipts: true,
        typingIndicator: false,
        onlineStatus: false,
        messagePreviews: true,
        linkPreviews: false,
        mediaSaving: false,
        blockedCount: 0,
      },
      setPrivacy: (patch) =>
        set((s) => ({ privacy: { ...s.privacy, ...patch } })),

      ai: {
        enabled: true,
        processing: "local-only",
        memoryScope: "current-conversation",
        translation: true,
        persistentMemory: true,
      },
      setAI: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),

      notifications: {
        previews: "name-and-message",
        sounds: true,
        ghostChatNotifications: false,
      },
      setNotifications: (patch) =>
        set((s) => ({ notifications: { ...s.notifications, ...patch } })),
    }),
    {
      name: "cloak-local-state",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState;
        if (version < 2) {
          return {
            ...(persistedState as Partial<CloakState>),
            chatFontSize: "large",
          };
        }
        return persistedState;
      },
      // Only user controls persist — never message payloads or memory content.
      partialize: (s) => ({
        cloakMode: s.cloakMode,
        chatFontSize: s.chatFontSize,
        /* Theme is a plain UI preference and persists like the others. The
           inline bootstrap script in layout.tsx reads it back out of this
           same key before first paint. */
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        translationLanguage: s.translationLanguage,
        forwardSecrecy: s.forwardSecrecy,
        /* Protection stores only a PIN hash and a credential id. */
        cloakGuard: s.cloakGuard,
        /* Onboarding is a UI preference (per-device); never membership/identity. */
        onboarding: s.onboarding,
        privacy: s.privacy,
        ai: s.ai,
        notifications: s.notifications,
        chatFilters: s.chatFilters,
        /* Dagger preferences (silent completion, gesture) — plain user
           settings, not security state; wiped with everything else on a
           real Dagger (codex §20/§21). */
        daggerConfig: s.daggerConfig,
        /* Membership + pass registries are NEVER persisted: the server is
           the only entitlement source (settlement spec §85, "membership
           does not trust localStorage") and rehydrates per session. */
      }),
    }
  )
);

/*
 * Keep the device vault key in step with the session, in ONE place.
 *
 * The vault key is what the local cache is sealed under, so it must be
 * published before any cache write and dropped the moment the account changes —
 * otherwise rows would be written unattributed, or one account's key would stay
 * live while another is signed in. Subscribing covers EVERY path that touches
 * `auth.user` (bootstrap, sign-in, register, sign-out, and Dagger's teardown)
 * instead of sprinkling a call through each of them and missing one.
 */
useCloakStore.subscribe((state, prev) => {
  const nextId = state.auth.user?.id ?? null;
  const prevId = prev.auth.user?.id ?? null;
  if (nextId === prevId) return;

  setVaultUser(nextId);
  if (!nextId) {
    /* Signed out. Local content is RETAINED per account by design, so the
       persisted vault key stays — only the in-memory copy and the write-dedupe
       state go. */
    forgetCachedSignatures();
    return;
  }
  /* Best-effort: ask not to be evicted, then drop ghost rows whose timer ran
     out while this device was away. */
  void ensurePersistentStorage();
  void purgeExpiredCachedMessages();
});

/* ---------- outbox: settling, flushing and retrying ---------- */

function replaceMessage(conversationId: string, id: string, next: Message): void {
  useCloakStore.setState((s) => ({
    conversations: s.conversations.map((c) =>
      c.id !== conversationId
        ? c
        : { ...c, messages: c.messages.map((m) => (m.id === id ? next : m)) }
    ),
  }));
}

function setMessageStatus(conversationId: string, id: string, status: MessageStatus): void {
  useCloakStore.setState((s) => ({
    conversations: s.conversations.map((c) =>
      c.id !== conversationId
        ? c
        : { ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, status } : m)) }
    ),
  }));
}

/**
 * Rebuild the travelling envelope from a rendered attachment message. The
 * bubble blanks `body` and moves the envelope into separate fields, so this is
 * the inverse of `hydrateAttachmentMessage` — needed to retry a failed send,
 * where the only surviving copy of the envelope is the message itself.
 */
function envelopeFromMessage(message: Message): AttachmentEnvelope | null {
  if (!message.attachmentId) return null;
  return {
    type: "cloak.attachment",
    v: 1,
    attachmentId: message.attachmentId,
    name: message.fileName ?? "Attachment",
    mime: message.attachmentMime ?? "application/octet-stream",
    size: message.fileSizeBytes ?? 0,
    storedAt: message.createdAt,
    ...(message.voiceDurationSec ? { durationSec: message.voiceDurationSec } : {}),
    ...(message.attachmentBlob ? { blob: message.attachmentBlob } : {}),
  };
}

/**
 * Apply a send outcome to the optimistic bubble.
 *
 * The three branches are the whole feature:
 *   sent      -> the server's row replaces the local one
 *   permanent -> "failed", because retrying genuinely cannot help
 *   retryable -> HELD in the outbox as "queued", so the words survive a reload,
 *                a dead connection and a closed tab
 */
async function settleOutgoing(params: {
  conversationId: string;
  id: string;
  kind: MessageKind;
  plaintext: string;
  attachmentId?: string;
  outcome: SendOutcome;
}): Promise<void> {
  const { conversationId, id, kind, plaintext, attachmentId, outcome } = params;

  if (outcome.kind === "sent") {
    replaceMessage(
      conversationId,
      id,
      outcome.transferFailed
        ? { ...outcome.message, attachmentTransferFailed: true }
        : outcome.message
    );
    return;
  }

  if (outcome.kind === "permanent") {
    setMessageStatus(conversationId, id, "failed");
    return;
  }

  const queued = await enqueueOutbox({
    id,
    conversationId,
    kind,
    plaintext,
    ...(attachmentId ? { attachmentId } : {}),
  });
  if (!queued.ok) {
    /* No vault key, so it cannot be held durably. Saying "failed" is honest;
       "queued" would promise a send that a reload would erase. */
    setMessageStatus(conversationId, id, "failed");
    return;
  }
  setMessageStatus(conversationId, id, "queued");
  /* Overflow dropped the oldest pending sends. Surface them rather than
     letting them vanish. */
  for (const evictedId of queued.evicted) {
    setMessageStatus(conversationId, evictedId, "failed");
  }
}

/**
 * Drain the queue.
 *
 * STRICTLY FIFO PER CONVERSATION, with head-of-line blocking: if the oldest
 * pending message for a conversation cannot go, nothing behind it goes either.
 * Skipping ahead would let a later message land first, and the server stamps
 * `createdAt` at insert time — so a message the user typed second would render
 * above the one they typed first. Stalling is the honest failure mode.
 *
 * Other conversations are unaffected: only the blocked one waits.
 */
let outboxFlushing = false;

export async function flushOutbox(): Promise<void> {
  if (outboxFlushing) return;
  if (!useCloakStore.getState().auth.user) return;
  outboxFlushing = true;
  try {
    const entries = await listOutbox();
    if (!entries.length) return;

    const byConversation = new Map<string, OutboxEntry[]>();
    for (const entry of entries) {
      const queue = byConversation.get(entry.conversationId) ?? [];
      queue.push(entry);
      byConversation.set(entry.conversationId, queue);
    }

    for (const [conversationId, queue] of byConversation) {
      for (const entry of queue) {
        const state = useCloakStore.getState();
        const myUserId = state.auth.user?.id;
        if (!myUserId) return; // signed out mid-flush: keep the rest queued

        /* A row whose body will not open cannot be sent and cannot be fixed.
           Clear it so it does not retry forever, and say so. */
        if (!entry.body) {
          await deleteOutboxEntry(entry.id);
          setMessageStatus(conversationId, entry.id, "failed");
          continue;
        }

        const outcome = await postOutgoingMessage({
          conversationId,
          clientKey: entry.id,
          kind: entry.kind,
          plaintext: entry.body,
          ...(entry.attachmentId ? { attachmentId: entry.attachmentId } : {}),
          myUserId,
          forwardSecrecy: state.forwardSecrecy,
        });

        if (outcome.kind === "sent") {
          await deleteOutboxEntry(entry.id);
          replaceMessage(
            conversationId,
            entry.id,
            outcome.transferFailed
              ? { ...outcome.message, attachmentTransferFailed: true }
              : outcome.message
          );
          continue;
        }
        if (outcome.kind === "permanent") {
          await deleteOutboxEntry(entry.id);
          setMessageStatus(conversationId, entry.id, "failed");
          continue;
        }
        /* Retryable: keep this message AND everything behind it, and try again
           on the next trigger. */
        await bumpOutboxAttempt(entry.id);
        break;
      }
    }
  } finally {
    outboxFlushing = false;
  }
}

/*
 * Flush triggers. A queue that nothing drains is just a leak, and each of these
 * covers a case the others miss:
 *   online             the connection came back while the app was open
 *   visibilitychange   the tab was backgrounded and is being looked at again
 *   the sync loop      a successful poll PROVES the network works, which also
 *                      covers a reconnect the `online` event never fired for
 *                      (and a first load that was never offline to begin with)
 * All are best-effort and cheap when the queue is empty.
 */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
}

/* Convenience selector: the active conversation object. */
export function useActiveConversation(): Conversation | null {
  return useCloakStore((s) => {
    if (!s.activeConversationId) return null;
    return (
      s.conversations.find((c) => c.id === s.activeConversationId) ?? null
    );
  });
}

/* The model manager reads this to present current artifacts in UI. */
export const CURRENT_MODEL_MANIFEST = MODEL_MANIFEST;
