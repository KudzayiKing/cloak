"use client";

/*
 * Cloak client state.
 *
 * - Cloaq Mode is a global privacy control (spec §23) with a reusable
 *   useCloakMode() hook built on this store.
 * - Demo conversations live in memory; settings and Cloaq Mode persist
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
  MessageReactionSummary,
  MembershipEntitlement,
  MessageKind,
  PreviewVisibility,
  ReserveGuestPass,
} from "@/lib/cloak/types";
import type { IssueGuestPassInput } from "@/lib/cloak/membership";
import { membershipService, type PassAllocationView, type PassInviteRecord } from "@/lib/cloak/membership-service";
import { syncPushAfterAuth } from "@/lib/cloak/push-client";
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
  saveLocalAttachment,
  type AttachmentEnvelope,
} from "@/lib/cloak/attachment-storage";
import {
  applyForwardSecrecy,
  decryptBody,
  encryptBody,
  ensureIdentity,
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
  if (!myUserId) return messages.map(toClientMessage);
  return Promise.all(
    messages.map(async (m) => {
      if (m.kind === "system" || m.authorId === "system" || m.authorId === "cloak") {
        return toClientMessage(m); // service notices / local AI answers
      }
      const base = toClientMessage(m);
      const result = await decryptBody(
        m.conversationId,
        m.body,
        m.kind,
        m.authorId,
        myUserId
      );
      if (!result.ok)
        return {
          ...base,
          body: "",
          bodyLocked: true,
          bodyLockedReason: result.reason ?? "missing",
        };
      return hydrateAttachmentMessage({ ...base, body: result.text ?? base.body });
    })
  );
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

/* Cloaq Mode protection (user feedback round 4): turning Cloaq Mode OFF can
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
  /** "cloak-off" — verifying to turn Cloaq Mode off.
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

  /* Server hydration / sync */
  hydrateServerData: (contacts: ServerContact[], conversations: ServerConversation[]) => Promise<void>;
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

  /* Cloaq Mode protection — PIN / biometric gate for turning it off */
  cloakGuard: CloakGuardSettings;
  setCloakGuardPin: (pinHash: string | null) => void;
  setCloakGuardBiometric: (credentialId: string | null) => void;
  cloakGate: CloakGateState;
  openCloakGate: (purpose: CloakGateState["purpose"], onVerified?: (ok: boolean) => void) => void;
  closeCloakGate: (verified: boolean) => void;

  /* Membership (server-authoritative: /api/auth, /api/payments/verify and
     /api/membership are the ONLY writers. The store is a display mirror —
     never persisted, never trusted for access decisions, settlement spec
     §85 "membership does not trust localStorage". */
  membership: MembershipEntitlement;
  setMembershipEntitlement: (entitlement: MembershipEntitlement) => void;

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
    file: File
  ) => Promise<{ ok: true; messageId: string } | { ok: false; error: string }>;
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

/* Verification callback for the Cloaq Mode gate — module scope so it never
   enters persisted state. */
let cloakGateCallback: ((verified: boolean) => void) | null = null;

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
          set({ auth: { user: null, checked: true } });
          await checkPendingDaggerCommand().catch(() => undefined);
          return;
        }
        const res = await api<{
          user: AuthUser;
          membership: MembershipEntitlement | null;
        }>("/api/auth/me");
        if (res.ok) {
          const { user, membership } = res.data;
          /* E2EE: a refresh has no passphrase — the device-local identity
             is reused. When it is missing but a server backup exists (new
             browser with a live session), the UI offers a restore prompt. */
          const identityStatus = await ensureIdentity(user.id);
          set((s) => ({
            auth: { user, checked: true },
            membership: membership ?? s.membership,
            identityStatus,
          }));
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
          set({ auth: { user: null, checked: true } });
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
        const { user, membership } = res.data;
        /* Open the gate the moment the session exists. Everything after this
           point is enrichment (E2EE keys, chat hydration, push) and must
           never be able to hold a signed-in user on the sign-in screen. */
        set((s) => ({
          auth: { user, checked: true },
          membership: membership ?? s.membership,
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
        const { user, membership } = res.data;
        /* Same contract as signIn: the session opens the gate immediately,
           and identity provisioning is bounded enrichment. */
        set((s) => ({
          auth: { user, checked: true },
          membership: membership ?? s.membership,
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

      /* ---------- Server hydration / sync ---------- */
      hydrateServerData: async (contacts, conversations) => {
        const currentActive = get().activeConversationId;
        const myUserId = get().auth.user?.id;
        const clientConvs = await Promise.all(
          conversations.map((c) => toClientConversationAsync(c, myUserId))
        );
        set({
          contacts,
          conversations: clientConvs,
          activeConversationId:
            currentActive && clientConvs.some((c) => c.id === currentActive)
              ? currentActive
              : null,
        });
        /* E2EE: provision / unwrap / heal keys for every conversation
           (inflight-guarded + cooldown inside the orchestrator). */
        void get().syncE2eeKeys();
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

      cloakGuard: { pinHash: null, credentialId: null },
      setCloakGuardPin: (pinHash) =>
        set((s) => ({ cloakGuard: { ...s.cloakGuard, pinHash } })),
      setCloakGuardBiometric: (credentialId) =>
        set((s) => ({ cloakGuard: { ...s.cloakGuard, credentialId } })),
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
        const id = nextLocalId("m");
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

        /* E2EE: the plaintext NEVER leaves the device — the body is
           encrypted with the conversation key before POSTing. The key
           provisioning (if still running) is awaited briefly. */
        void (async () => {
          const myUserId = get().auth.user?.id;
          let encrypted: string | null = null;
          if (myUserId) {
            /* Sending should not wait for the background poll to prepare
               keys. Run key maintenance immediately, then wait briefly for
               the local key. A second pass covers races where the first
               caller was already provisioning. */
            await syncConversationKeys(conversationId, myUserId);
            let readyKey = await waitForConversationKey(conversationId, 2500);
            if (!readyKey) {
              await syncConversationKeys(conversationId, myUserId);
              readyKey = await waitForConversationKey(conversationId, 1500);
            }
            /* Forward secrecy: when a window is active, retire an over-aged
               key version BEFORE encrypting so this message lands under a
               fresh root (CAS makes concurrent rotators safe — a 409 loser
               just sends under the key it holds). */
            const fs = get().forwardSecrecy;
            if (fs !== "off") {
              const windowMs = FS_WINDOW_MS[fs];
              if (windowMs) await maybeRotateForAge(conversationId, myUserId, windowMs / 2);
            }
            encrypted = await encryptBody(conversationId, body, kind, myUserId);
          }
          if (!encrypted) {
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id !== conversationId
                  ? c
                  : {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === id ? { ...m, status: "failed" as const } : m
                      ),
                    }
              ),
            }));
            return;
          }
          const res = await api<{ message: ServerMessage }>(
            `/api/conversations/${conversationId}/messages`,
            { method: "POST", body: JSON.stringify({ body: encrypted, kind }) }
          );
          /* Real transport — the API is the authority; the sync loop brings
             delivered/read states from the peer's participation markers. */
          let serverMessage: Message | null = null;
          if (res.ok) {
            const confirmed = toClientMessage(res.data.message);
            /* This device already has the plaintext it just encrypted.
               Avoid re-decrypting the server envelope here; if key sync is
               mid-flight, that would falsely mark a delivered message as
               failed. Polling will still refresh tick state later. */
            serverMessage = {
              ...confirmed,
              body,
              status: confirmed.status ?? "sent",
            };
          }
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === id
                        ? serverMessage
                          ? serverMessage
                          : { ...m, status: "failed" as const }
                        : m
                    ),
                  }
            ),
          }));
        })();
        return id;
      },

      sendAttachment: async (conversationId, file) => {
        if (!file || file.size <= 0) return { ok: false, error: "empty_file" };
        const kind: MessageKind = file.type.startsWith("image/") ? "image" : "file";
        let saved: Awaited<ReturnType<typeof saveLocalAttachment>>;
        try {
          saved = await saveLocalAttachment(file, conversationId);
        } catch {
          return { ok: false, error: "storage_unavailable" };
        }

        const id = nextLocalId("m");
        const plaintext = JSON.stringify(saved.envelope);
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

        void (async () => {
          const myUserId = get().auth.user?.id;
          let encrypted: string | null = null;
          if (myUserId) {
            await syncConversationKeys(conversationId, myUserId);
            let readyKey = await waitForConversationKey(conversationId, 2500);
            if (!readyKey) {
              await syncConversationKeys(conversationId, myUserId);
              readyKey = await waitForConversationKey(conversationId, 1500);
            }
            const fs = get().forwardSecrecy;
            if (fs !== "off") {
              const windowMs = FS_WINDOW_MS[fs];
              if (windowMs) await maybeRotateForAge(conversationId, myUserId, windowMs / 2);
            }
            encrypted = await encryptBody(conversationId, plaintext, kind, myUserId);
          }

          if (!encrypted) {
            set((s) => ({
              conversations: s.conversations.map((c) =>
                c.id !== conversationId
                  ? c
                  : {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === id ? { ...m, status: "failed" as const } : m
                      ),
                    }
              ),
            }));
            return;
          }

          const res = await api<{ message: ServerMessage }>(
            `/api/conversations/${conversationId}/messages`,
            { method: "POST", body: JSON.stringify({ body: encrypted, kind }) }
          );

          let serverMessage: Message | null = null;
          if (res.ok) {
            const confirmed = toClientMessage(res.data.message);
            serverMessage = {
              ...confirmed,
              ...message,
              id: confirmed.id,
              createdAt: confirmed.createdAt,
              status: confirmed.status ?? "sent",
            };
          }

          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === id
                        ? serverMessage
                          ? serverMessage
                          : { ...m, status: "failed" as const }
                        : m
                    ),
                  }
            ),
          }));
        })();

        return { ok: true, messageId: id };
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

/* TEMP-theme-repro: expose the store in dev so an e2e can drive setTheme
   without auth. Removed after the repro. */
if (process.env.NODE_ENV !== "production") {
  (globalThis as unknown as { __cloakStore?: typeof useCloakStore }).__cloakStore =
    useCloakStore;
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
