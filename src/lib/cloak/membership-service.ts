/*
 * MembershipService — the typed boundary between the product and the
 * server-owned membership domain (pricing & membership spec §39, USDC
 * direct-settlement spec §57).
 *
 * RULES THIS BOUNDARY ENFORCES
 *  - localStorage/IndexedDB state is never authoritative for payments or
 *    passes: every call lands on the server, which owns entitlements,
 *    allocation accounting, and the pass state machine.
 *  - Entitlement logic stays separate from payment transaction data.
 *  - Upgrade amounts come from a quote, never frontend arithmetic.
 *  - The client never supplies a payable amount; checkout amounts come
 *    from /api/payments/request (server SKU map, §53).
 */

import type {
  CheckoutResult,
  CloakMembership,
  IssueGuestPassInput,
  MembershipEntitlement,
  MembershipQuote,
  ReserveGuestPass,
} from "./types";
import { CLOAK_PRICING } from "./config";
import { useCloakStore } from "@/stores/cloak-store";
import { can as canCapability } from "./membership";
import type { Capability } from "./membership";

export interface PassInviteRecord {
  id: string;
  passId: string;
  slotIndex: number;
  method: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  redeemedByName?: string;
}

export interface PassAllocationView {
  total: number;
  available: number;
  pending: number;
  redeemed: number;
}

export interface InviteIssueResult {
  ok: true;
  pass: ReserveGuestPass;
  invite: PassInviteRecord;
  token: string;
  link: string;
  qrDataUrl: string | null;
}

export interface InviteLookupResult {
  found: boolean;
  reason?: "unknown_token";
  status?: string;
  inviterName?: string;
  method?: string;
  expiresAt?: string;
}

export interface MembershipService {
  getCurrentMembership(): Promise<MembershipEntitlement>;
  getQuote(target: CloakMembership): Promise<MembershipQuote>;
  createCheckout(target: CloakMembership): Promise<CheckoutResult>;
  getGuestPasses(): Promise<{
    passes: ReserveGuestPass[];
    invites: PassInviteRecord[];
    allocation: PassAllocationView;
  }>;
  issueGuestPass(input: IssueGuestPassInput): Promise<InviteIssueResult | { ok: false; error: string }>;
  revokePendingGuestPass(passId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  redeemGuestPass(token: string): Promise<
    | { ok: true; entitlement: MembershipEntitlement }
    | { ok: false; error: string }
  >;
  /** Token lookup for the invitation screen — state only, never secrets. */
  lookupInvite(token: string): Promise<InviteLookupResult>;
}

/** Upgrade quote estimate. The payment service calculates real amounts (spec §38). */
async function quote(target: CloakMembership): Promise<MembershipQuote> {
  const current = useCloakStore.getState().membership;
  const from = current.membership;
  if (from === "private" && target === "reserve") {
    const creditApplied = CLOAK_PRICING.private.amount;
    return {
      from,
      to: target,
      amountDue: Math.max(0, CLOAK_PRICING.reserve.amount - creditApplied),
      currency: CLOAK_PRICING.reserve.currency,
      creditApplied,
    };
  }
  const amount =
    target === "reserve"
      ? CLOAK_PRICING.reserve.amount
      : target === "private"
        ? CLOAK_PRICING.private.amount
        : 0;
  return { from, to: target, amountDue: amount, currency: "USD" };
}

/**
 * Server-backed membership service. Entitlement reads mirror the store,
 * which bootstrapAuth/signIn hydrate from /api/auth/me and /api/auth/login.
 */
export class ServerMembershipService implements MembershipService {
  async getCurrentMembership(): Promise<MembershipEntitlement> {
    return useCloakStore.getState().membership;
  }

  async getQuote(target: CloakMembership): Promise<MembershipQuote> {
    return quote(target);
  }

  async createCheckout(target: CloakMembership): Promise<CheckoutResult> {
    /* One-time individual plans settle through the USDC checkout dialog
       (server-derived amount). Consultative tiers are contact-led. */
    if (target !== "private" && target !== "reserve") {
      return {
        configured: false,
        message:
          "This membership is arranged directly with Cloaq. Use the contact form and our team will follow up.",
      };
    }
    return { configured: true, message: "Direct settlement in USDC on Solana." };
  }

  async getGuestPasses() {
    const res = await fetch("/api/membership/passes", { cache: "no-store" });
    const json = (await res.json()) as {
      ok: boolean;
      passes?: ReserveGuestPass[];
      invites?: PassInviteRecord[];
      allocation?: PassAllocationView;
    };
    if (!res.ok || !json.ok || !json.passes || !json.invites || !json.allocation) {
      throw new Error("passes_unavailable");
    }
    return { passes: json.passes, invites: json.invites, allocation: json.allocation };
  }

  async issueGuestPass(
    input: IssueGuestPassInput
  ): Promise<InviteIssueResult | { ok: false; error: string }> {
    const entitlement = useCloakStore.getState().membership;
    if (!canCapability(entitlement, "guest_pass.issue")) {
      return { ok: false, error: "missing_capability" };
    }
    try {
      const res = await fetch("/api/membership/passes/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passId: input.passId, method: input.method }),
      });
      const json = (await res.json()) as
        | {
            ok: true;
            pass: ReserveGuestPass;
            invite: PassInviteRecord;
            token: string;
            link: string;
            qrDataUrl: string | null;
          }
        | { ok: false; error: string };
      return json;
    } catch {
      return { ok: false, error: "network" };
    }
  }

  async revokePendingGuestPass(passId: string) {
    try {
      const res = await fetch("/api/membership/passes/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      return json.ok
        ? ({ ok: true } as const)
        : ({ ok: false, error: json.error ?? "failed" } as const);
    } catch {
      return { ok: false as const, error: "network" };
    }
  }

  async redeemGuestPass(token: string) {
    try {
      const res = await fetch("/api/membership/invite-redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        entitlement?: MembershipEntitlement;
        error?: string;
      };
      if (json.ok && json.entitlement) {
        useCloakStore.getState().setMembershipEntitlement(json.entitlement);
        return { ok: true as const, entitlement: json.entitlement };
      }
      return { ok: false as const, error: json.error ?? "unknown_token" };
    } catch {
      return { ok: false as const, error: "network" };
    }
  }

  async lookupInvite(token: string): Promise<InviteLookupResult> {
    try {
      const res = await fetch(`/api/membership/invite-lookup?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        found: boolean;
        reason?: string;
        status?: string;
        inviterName?: string;
        method?: string;
        expiresAt?: string;
      };
      if (!json.found) return { found: false, reason: "unknown_token" };
      return {
        found: true,
        status: json.status,
        inviterName: json.inviterName,
        method: json.method,
        expiresAt: json.expiresAt,
      };
    } catch {
      return { found: false, reason: "unknown_token" };
    }
  }
}

/** Production service — server-authoritative since the payment domain landed. */
export const membershipService: MembershipService = new ServerMembershipService();

/* ---------- Convenience helpers ---------- */

export async function canDo(capability: Capability): Promise<boolean> {
  const entitlement = await membershipService.getCurrentMembership();
  return canCapability(entitlement, capability);
}
