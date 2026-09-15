/*
 * Cloaq membership model — types, capabilities, and the guest-pass state
 * machine (pricing & membership update spec §1, §7-§13, §35-§36, §53-§54).
 *
 * This module is intentionally dependency-free and side-effect-free so the
 * entitlement rules and pass invariants can be unit-tested in isolation.
 *
 * Core product rules encoded here:
 *   - Reserve includes 10 Cloaq Private guest passes; each grants ONE recipient
 *     a REAL Cloaq Private lifetime membership — never a limited account.
 *   - Redeemed = permanently consumed. Never recycled, never reclaimed.
 *   - A pass returns to the allocation only if it expires or is revoked
 *     BEFORE redemption (backend policy; encoded here as the default policy).
 *   - Membership is private. Nothing in this model may surface another
 *     user's tier on any public surface (spec §15, §52, §15-privacy).
 */

import { CLOAK_PRICING } from "./config";
import type {
  AccessAcquisitionMode,
  CheckoutResult,
  CloakMembership,
  GuestPassRecipient,
  GuestPassStatus,
  IssueGuestPassInput,
  MembershipEntitlement,
  MembershipOrigin,
  MembershipQuote,
  MembershipRenewal,
  ReserveGuestPass,
} from "./types";

export type {
  AccessAcquisitionMode,
  CheckoutResult,
  CloakMembership,
  GuestPassRecipient,
  GuestPassStatus,
  IssueGuestPassInput,
  MembershipEntitlement,
  MembershipOrigin,
  MembershipQuote,
  MembershipRenewal,
  ReserveGuestPass,
};

/* ---------- Capability-based access control (spec §36) ---------- */
export const CAPABILITIES = [
  "messaging.private",
  "messaging.groups",
  "ghost_chat",
  "cloak_mode",
  "calls.voice",
  "calls.video",
  "ai.local",
  "memory.local",
  "translation.local",
  "devices.standard",
  "devices.advanced",
  "identity.standard",
  "identity.enhanced",
  "guest_pass.issue",
  "guest_pass.manage",
  "support.priority",
  "onboarding.assisted",
  "security.advanced",
  "organization.admin",
  "deployment.private",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The complete core individual product (spec §4) belongs to every paid tier.
 * Organizational tiers inherit the individual baseline for their members.
 */
const CORE_INDIVIDUAL: Capability[] = [
  "messaging.private",
  "messaging.groups",
  "ghost_chat",
  "cloak_mode",
  "calls.voice",
  "calls.video",
  "ai.local",
  "memory.local",
  "translation.local",
  "devices.standard",
  "identity.standard",
];

/** Reserve adds assurance and service — never invented cryptography (spec §6). */
const RESERVE_ASSURANCE: Capability[] = [
  ...CORE_INDIVIDUAL,
  "devices.advanced",
  "identity.enhanced",
  "guest_pass.issue",
  "guest_pass.manage",
  "support.priority",
  "onboarding.assisted",
  "security.advanced",
];

const MEMBERSHIP_CAPABILITIES: Record<CloakMembership, Capability[]> = {
  none: [],
  private: CORE_INDIVIDUAL,
  reserve: RESERVE_ASSURANCE,
  /* Circle members hold individual entitlements per contract plus high-touch
     service; administrative control over members is NOT included (spec §53). */
  private_circle: [...RESERVE_ASSURANCE, "onboarding.assisted"],
  /* Office is organizational: administration plus the individual baseline.
     It does not reuse Reserve guest-pass logic (spec §54). */
  office: [
    ...CORE_INDIVIDUAL,
    "organization.admin",
    "support.priority",
    "onboarding.assisted",
    "security.advanced",
  ],
  /* Sovereign is private deployment: everything, including infrastructure. */
  sovereign: [...CAPABILITIES],
};

export function membershipCapabilities(membership: CloakMembership): Capability[] {
  return MEMBERSHIP_CAPABILITIES[membership] ?? [];
}

export function can(
  entitlement: Pick<MembershipEntitlement, "membership" | "active">,
  capability: Capability
): boolean {
  if (!entitlement.active) return false;
  return membershipCapabilities(entitlement.membership).includes(capability);
}

/* ---------- Pass allocation accounting ---------- */

export interface PassAllocation {
  total: number;
  available: number;
  pending: number;
  redeemed: number;
}

/** Statuses that permanently consume one slot of the Reserve allocation. */
const CONSUMING_STATUSES: GuestPassStatus[] = ["issued", "redeemed"];

/**
 * Allocation accounting for a Reserve member's grants (internal type "reserve").
 * Expired invitations and pre-redemption revocations release their slot
 * (default backend policy, spec §8 + §13). Redeemed passes never do.
 */
export function passAllocation(passes: ReserveGuestPass[], now = Date.now()): PassAllocation {
  const total = CLOAK_PRICING.reserve.includedPrivatePasses;
  let pending = 0;
  let redeemed = 0;
  let consuming = 0;
  for (const pass of passes) {
    const status = effectivePassStatus(pass, now);
    if (CONSUMING_STATUSES.includes(status)) consuming += 1;
    if (status === "issued") pending += 1;
    if (status === "redeemed") redeemed += 1;
  }
  return {
    total,
    pending,
    redeemed,
    available: Math.max(0, total - consuming),
  };
}

/** A pass whose invitation window passed without redemption is expired. */
export function effectivePassStatus(pass: ReserveGuestPass, now = Date.now()): GuestPassStatus {
  if (
    pass.status === "issued" &&
    pass.expiresAt &&
    new Date(pass.expiresAt).getTime() <= now
  ) {
    return "expired";
  }
  return pass.status;
}

/* ---------- Guest-pass state machine (pure transitions) ---------- */

export type PassTransitionError =
  | "not_found"
  | "already_redeemed"
  | "already_revoked"
  | "already_expired"
  | "not_pending"
  | "allocation_exhausted"
  | "missing_capability";

/**
 * ISSUE — available pass becomes a pending invitation.
 * Requires capability `guest_pass.issue` and a free allocation slot.
 */
export function issuePassTransition(
  passes: ReserveGuestPass[],
  passId: string,
  input: { recipient?: GuestPassRecipient; method?: IssueGuestPassInput["method"] },
  now = Date.now()
): { pass: ReserveGuestPass } | { error: PassTransitionError } {
  const allocation = passAllocation(passes, now);
  if (allocation.available <= 0) return { error: "allocation_exhausted" };
  const pass = passes.find((p) => p.id === passId);
  if (!pass) return { error: "not_found" };
  if (pass.status !== "available") return { error: "not_pending" };
  return {
    pass: {
      ...pass,
      status: "issued",
      issuedTo: input.recipient,
      issuedAt: new Date(now).toISOString(),
      expiresAt: undefined /* set by the service, which owns the policy window */,
      note: input.method ? `Invited via ${input.method}` : pass.note,
    },
  };
}

/**
 * REDEEM — a pending, unexpired pass becomes permanently consumed.
 * One token -> one redemption; expired, revoked, and reused tokens fail.
 */
export function redeemPassTransition(
  passes: ReserveGuestPass[],
  passId: string,
  input: { redeemedByUserId: string },
  now = Date.now()
): { pass: ReserveGuestPass } | { error: PassTransitionError } {
  const pass = passes.find((p) => p.id === passId);
  if (!pass) return { error: "not_found" };
  const status = effectivePassStatus(pass, now);
  switch (status) {
    case "redeemed":
      return { error: "already_redeemed" };
    case "expired":
      return { error: "already_expired" };
    case "revoked_before_redemption":
      return { error: "already_revoked" };
    case "issued":
      break;
    default:
      return { error: "not_pending" };
  }
  return {
    pass: {
      ...pass,
      status: "redeemed",
      redeemedAt: new Date(now).toISOString(),
      redeemedByUserId: input.redeemedByUserId,
    },
  };
}

/**
 * REVOKE — only while the invitation is still pending.
 * Redemption is final: a redeemed membership can never be pulled back.
 */
export function revokePassTransition(
  passes: ReserveGuestPass[],
  passId: string,
  now = Date.now()
): { pass: ReserveGuestPass } | { error: PassTransitionError } {
  const pass = passes.find((p) => p.id === passId);
  if (!pass) return { error: "not_found" };
  const status = effectivePassStatus(pass, now);
  if (status === "redeemed") return { error: "already_redeemed" };
  if (status !== "issued") return { error: "not_pending" };
  return {
    pass: {
      ...pass,
      status: "revoked_before_redemption",
      revokedAt: new Date(now).toISOString(),
    },
  };
}

/**
 * Redemption eligibility for the RECIPIENT's existing membership (spec §10):
 * never silently waste a pass, never downgrade Reserve, never double-grant.
 */
export type RedemptionDecision =
  | { allowed: true }
  | { allowed: false; reason: "recipient_already_private" | "recipient_already_reserve" };

export function decideRedemption(
  recipient: Pick<MembershipEntitlement, "membership">,
  pass: ReserveGuestPass,
  now = Date.now()
): RedemptionDecision {
  if (recipient.membership === "reserve") {
    return { allowed: false, reason: "recipient_already_reserve" };
  }
  if (recipient.membership !== "none") {
    return { allowed: false, reason: "recipient_already_private" };
  }
  const check = redeemPassTransition([pass], pass.id, { redeemedByUserId: "check" }, now);
  return "error" in check ? { allowed: false, reason: "recipient_already_private" } : { allowed: true };
}

/* ---------- Invite tokens (spec §43) ---------- */

/**
 * High-entropy, single-purpose invitation token. Only its hash is persisted;
 * the raw token exists solely inside the invite link. Never sequential.
 * Returns null when the platform lacks a secure randomness source.
 */
export function generateInviteToken(): string | null {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const cryptoObj = g && "crypto" in g ? g.crypto : undefined;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(32);
  cryptoObj.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "function") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 hex hash of an invite token — the only form stored server-side. */
export async function hashInviteToken(token: string): Promise<string | null> {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const cryptoObj = g && "crypto" in g ? g.crypto : undefined;
  if (!cryptoObj?.subtle) return null;
  const data = new TextEncoder().encode(token);
  const digest = await cryptoObj.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
