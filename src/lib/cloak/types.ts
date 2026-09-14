/*
 * Cloak core product types.
 * Shared vocabulary for membership entitlements, protection state, model
 * state, messaging, and AI routing. Kept dependency-free.
 */

/* ---------- Membership (pricing & membership update §35) ---------- */

export type CloakMembership =
  | "none"
  | "private"
  | "reserve"
  | "private_circle"
  | "office"
  | "sovereign";

export type MembershipOrigin =
  | "direct_usdc"
  | "reserve_guest_pass"
  | "bank_transfer"
  | "invoice"
  | "contract"
  | "admin_grant"
  /** Legacy purchase origin (pre direct-settlement entitlements). */
  | "purchase";

export type MembershipRenewal = "never" | "annual" | "custom";

export interface MembershipEntitlement {
  membership: CloakMembership;
  origin: MembershipOrigin;
  active: boolean;
  grantedAt?: string;
  purchasedAt?: string;
  renewal?: MembershipRenewal;
  /** Present when this entitlement came from someone's guest pass. */
  sourceOwnerUserId?: string;
  sourceGuestPassId?: string;
}

/* ---------- Reserve guest passes (spec §7-§8) ---------- */

export type GuestPassStatus =
  | "available"
  | "issued"
  | "redeemed"
  | "expired"
  | "revoked_before_redemption";

export interface GuestPassRecipient {
  cloakId?: string;
  email?: string;
  /** Display name only — never billing or identity documents. */
  name?: string;
  inviteTokenId?: string;
}

export interface ReserveGuestPass {
  id: string;
  ownerUserId: string;
  status: GuestPassStatus;

  issuedTo?: GuestPassRecipient;

  issuedAt?: string;
  expiresAt?: string;

  redeemedAt?: string;
  redeemedByUserId?: string;

  revokedAt?: string;
  /** Optional note, e.g. how the invite was delivered. Never secret material. */
  note?: string;
  /** Display name of the recipient after redemption (owner's pass list only). */
  redeemedByName?: string;
}

export interface IssueGuestPassInput {
  ownerUserId: string;
  /** Specific slot to issue; the server picks the first available when absent. */
  passId?: string;
  recipient?: GuestPassRecipient;
  /** Delivery hint for the pass record — the token itself is never stored here.
   *  Only secure link + QR exist: a pre-payment guest cannot have a Cloak ID. */
  method?: "secure_link" | "qr";
}

/* ---------- Upgrade quotes (spec §38) ---------- */

export interface MembershipQuote {
  from: CloakMembership;
  to: CloakMembership;
  amountDue: number;
  currency: string;
  creditApplied?: number;
}

export interface CheckoutResult {
  configured: boolean;
  checkoutUrl?: string;
  sessionId?: string;
  /** Honest operator message when checkout is not available. */
  message?: string;
}

/* ---------- Acquisition mode (spec §34) ---------- */

export type AccessAcquisitionMode =
  | "direct_purchase"
  | "request_access"
  | "invite_only";

/* ---------- Security state (spec §21) ---------- */

export type ProtectionState =
  | "protected"
  | "attention"
  | "disabled"
  | "unavailable"
  | "not-configured";

export interface SecurityItemState {
  id: string;
  label: string;
  state: ProtectionState;
  detail: string;
}

/* ---------- Identity & contacts (spec §25) ---------- */

export type ContactVerification = "verified" | "unverified" | "pending";

export interface Contact {
  id: string;
  name: string;
  /** Cloak ID — the primary identity. Phone numbers are never primary. */
  cloakId: string;
  verification: ContactVerification;
  avatarInitials: string;
  about?: string;
  blocked?: boolean;
  /** ISO date the identity was safety-number verified, when verified. */
  verifiedAt?: string;
}

/* ---------- Messaging (spec §17, §18, §24) ---------- */

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type MessageKind =
  | "text"
  | "system"
  | "ai"
  | "file"
  | "image"
  | "voice"
  | "view-once";

export type DisappearingTimer =
  | "off"
  | "30s"
  | "5m"
  | "1h"
  | "1d"
  | "7d"
  | "custom";

export interface RetrievedMemoryRef {
  id: string;
  label: string;
  source: "memory" | "message";
  conversationId?: string;
}

export interface AIProcessingDetails {
  provider: string;
  model: string;
  location: "This device" | "Cloud";
  cloudUsed: boolean;
  memoryUploaded: boolean;
  retrievedItems: number;
  retrieved: RetrievedMemoryRef[];
  route: ExecutionRoute;
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string; // "me" for outgoing, member id, or "cloak"
  kind: MessageKind;
  body: string;
  createdAt: number;
  status?: MessageStatus;
  /** Sender display name (groups) — server-provided, never user input. */
  authorName?: string;
  replyToId?: string;
  /** Ghost chat metadata */
  disappearsAfter?: DisappearingTimer;
  expiresAt?: number;
  /** View-once media */
  viewed?: boolean;
  /** E2EE: ciphertext could not be decrypted with the keys this device
   *  holds (key not yet synced / not a member of that key version). The
   *  body is NOT displayed. */
  bodyLocked?: boolean;
  /** Why the body is locked: "missing" = key not on this device (yet),
   *  "expired" = key retired by the forward-secrecy window (permanent). */
  bodyLockedReason?: "missing" | "expired";
  fileName?: string;
  fileSizeBytes?: number;
  /** Device-local attachment blob id (IndexedDB / origin storage). */
  attachmentId?: string;
  attachmentMime?: string;
  attachmentStoredLocal?: boolean;
  voiceDurationSec?: number;
  /** For AI answers: where and how processing happened. */
  ai?: AIProcessingDetails;
}

export interface Conversation {
  id: string;
  contactId: string;
  isGroup?: boolean;
  groupName?: string;
  groupDescription?: string;
  groupMemberIds?: string[];
  /** Live member count (server truth) for groups. */
  memberCount?: number;
  /** Viewer's role in this group: owner | admin | member. */
  myRole?: "owner" | "admin" | "member";
  pinned?: boolean;
  muted?: boolean;
  unreadCount?: number;
  /** Ghost Chat — whole conversation is ephemeral */
  ghost?: boolean;
  ghostTimer?: DisappearingTimer;
  /** Conversation requires biometric/passcode-style unlock in UI */
  locked?: boolean;
  /** Per-conversation AI permission (spec §31) — the group's OWN setting,
   *  mirrored from the server (no longer a client-local toggle). */
  aiAccess: "allowed" | "blocked";
  /** EFFECTIVE AI access (spec §39): strictest of the group setting and
   *  the owning Circle's policy. "limited" = current request only. The
   *  client gates @Cloak and the composer hint on this. */
  aiEffective?: "allowed" | "limited" | "blocked";
  /** Present when a Circle clamps this group — the UI shows why. */
  aiCircleDefault?: "disabled" | "current_request" | "allowed";
  persistentMemory: boolean;
  /** E2EE history-sharing policy for groups (server truth):
   *  "none" hides pre-join history from members added later, "all"
   *  shares it. Drives key rotation vs. re-wrap on member adds. */
  historyPolicy?: "none" | "all";
  /** Cloak Circle association (circles spec §53): set when this group
   *  belongs to a Circle. Shown in the group header + details panel. */
  circleId?: string;
  circleName?: string;
  messages: Message[];
  /** History pagination (server truth): more older pages exist beyond
   *  the messages currently in memory. Undefined = not fetched yet. */
  historyHasMore?: boolean;
  /** An older-page fetch is in flight (drives the loading row). */
  historyLoading?: boolean;
}

/* ---------- AI routing (spec §4, §5, §6) ---------- */

export type ExecutionRoute =
  | "deterministic"
  | "retrieval-only"
  | "local-llm"
  | "translation"
  | "cloud-fallback";

export type AIProcessingPreference = "local-only" | "ask-before-cloud" | "allow-cloud";

export type MemoryScope =
  | "current-conversation"
  | "selected-conversations"
  | "selected-contacts"
  | "all-permitted"
  | "none";

/* ---------- Model management (spec §3, §29) ---------- */

export type ModelInstallState =
  | "not-installed"
  | "checking"
  | "downloading"
  | "verifying"
  | "ready"
  | "update-available"
  | "unsupported"
  | "insufficient-storage"
  | "error";

export interface ModelArtifact {
  id: string;
  displayName: string;
  /** Public/custom-domain URL — no R2 credentials in client. */
  url?: string;
  sizeBytes?: number;
  version?: string;
  sha256?: string;
}

/* ---------- Notifications previews ---------- */

export type PreviewVisibility = "name-and-message" | "name-only" | "off";

/* ---------- Cloak Circles (groups & circles spec §23-§68) ----------
 * Mirror payloads of /api/circles — the server is authoritative (§80);
 * these types only describe what the client may display. */

export type CircleRole = "owner" | "admin" | "member";

export interface CircleSummary {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "managed";
  myRole: CircleRole;
  memberCount: number;
  /** Groups the viewer may see by name (§26/§42): managers see all. */
  visibleGroupCount: number;
  totalGroupCount: number;
  /** Groups the viewer is NOT in — a count, never names (§67). */
  hiddenGroupCount: number;
  archived: boolean;
  lastActivityAt: number | null;
}

export interface CircleMemberEntry {
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  role: CircleRole;
  joinedAt: number;
  isYou: boolean;
  /** Circle groups of this member the VIEWER may know about (§42/§43). */
  groupAccess?: string[];
}

export interface CircleGroupEntry {
  id: string;
  title: string;
  description?: string;
  memberCount: number;
  isMember: boolean;
  myRole?: "owner" | "admin" | "member";
  updatedAt: number;
}

export interface CircleInviteEntry {
  id: string;
  status: "active" | "redeemed" | "expired" | "revoked";
  groupNames: string[];
  useCount: number;
  maxUses: number;
  expiresAt: number;
  createdAt: number;
  revokedAt?: number | null;
  /** Present ONLY in the create response — raw tokens are never stored. */
  token?: string;
  url?: string;
}

export interface CircleJoinRequestEntry {
  id: string;
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  createdAt: number;
}

export interface CircleAuditEntry {
  id: string;
  event: string;
  detail?: string;
  actorName?: string;
  createdAt: number;
}

export interface CircleDetail {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "managed";
  myRole: CircleRole;
  archived: boolean;
  createdAt: number;
  ownerUserId: string;
  policy: {
    newMemberHistory: "none" | "all";
    cloudAi: "disabled" | "current_request" | "allowed";
    inviteExpiryDays: number;
  };
  members: CircleMemberEntry[];
  groups: CircleGroupEntry[];
  hiddenGroupCount: number;
  invites?: CircleInviteEntry[];
  /** Pending approval-queue requests (§41) — managers only. */
  joinRequests?: CircleJoinRequestEntry[];
  audit?: CircleAuditEntry[];
  security: {
    memberCount: number;
    groupCount: number;
    /** Members whose client has provisioned an E2EE identity key — the
     *  only honest verification signal that exists today (§68). */
    identityKeysProvisioned: number;
    openInvites: number;
    cloudAi: string;
    newMemberHistory: string;
    archived: boolean;
  };
}

/** Starting structures (spec §31). Client copy of the server allow-list;
 *  the server rejects unknown ids. */
export const CIRCLE_TEMPLATES = [
  { id: "family-office", name: "Family Office", groups: ["Principal", "Legal", "Investments", "Security", "Travel", "Family"] },
  { id: "executive-office", name: "Executive Office", groups: ["Leadership", "Operations", "Communications", "Security"] },
  { id: "legal-matter", name: "Legal Matter", groups: ["Case Team", "Documents", "Advisors"] },
  { id: "board", name: "Board", groups: ["Directors", "Committees", "Materials"] },
  { id: "security-team", name: "Security Team", groups: ["Operations", "Incidents", "Review"] },
  { id: "private-project", name: "Private Project", groups: ["Planning", "Build", "Launch"] },
] as const;
