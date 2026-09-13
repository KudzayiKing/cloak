/*
 * Server-side membership domain (pricing & membership spec §35, USDC
 * direct-settlement spec §57, guest passes §7-§13).
 *
 * The server is the ONLY writer of entitlements: payment verification
 * redeems a claim, guest-pass redemption consumes an invite token. Nothing
 * here trusts client-supplied tiers. localStorage/persisted store state is
 * a mirror, never the authority ("membership does not trust localStorage",
 * settlement spec §85).
 */

import { db } from "@/lib/db";
import {
  RESERVE_GUEST_INVITE_EXPIRY_DAYS,
} from "@/lib/cloak/config";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  GuestPassStatus,
  MembershipEntitlement,
  MembershipOrigin,
  MembershipRenewal,
  ReserveGuestPass,
} from "@/lib/cloak/types";

type Db = Prisma.TransactionClient | PrismaClient;

/* ---------- Entitlement resolution ---------- */

/**
 * Dev-activation fallback. CLOAK_ALLOW_DEV_ACTIVATION=1 lets the seeded test
 * identities into the app without on-chain payment. Removed at launch —
 * production entitlements come ONLY from /api/payments/verify and invite
 * redemption (server-written User rows).
 */
export function devEntitlementFallback(): MembershipEntitlement | null {
  if (process.env.CLOAK_ALLOW_DEV_ACTIVATION !== "1") return null;
  return {
    membership: "private",
    origin: "admin_grant",
    active: true,
    grantedAt: new Date().toISOString(),
    renewal: "never",
  };
}

/** Entitlement for a full User row — real tier first, dev fallback second. */
export function entitlementForUser(user: {
  membershipTier: string | null;
  membershipOrigin: string | null;
  membershipGrantedAt: Date | null;
}): MembershipEntitlement {
  if (user.membershipTier) {
    return {
      membership: user.membershipTier as MembershipEntitlement["membership"],
      origin: (user.membershipOrigin ?? "admin_grant") as MembershipOrigin,
      active: true,
      grantedAt: (user.membershipGrantedAt ?? new Date()).toISOString(),
      renewal: "never" as MembershipRenewal,
    };
  }
  return (
    devEntitlementFallback() ?? {
      membership: "none",
      origin: "admin_grant",
      active: false,
      renewal: "never",
    }
  );
}

/** Write a server-authoritative entitlement onto the User row. */
export async function grantMembership(
  tx: Db,
  userId: string,
  tier: string,
  origin: MembershipOrigin
) {
  return tx.user.update({
    where: { id: userId },
    data: {
      membershipTier: tier,
      membershipOrigin: origin,
      membershipGrantedAt: new Date(),
    },
  });
}

/* ---------- Invite tokens (server-side, node crypto) ---------- */

/** High-entropy 256-bit invite token — base64url, URL-safe. */
export function generateInviteTokenServer(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex — the only form of a token that is ever persisted. */
export function hashInviteTokenServer(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* ---------- Guest passes (Reserve allocation, spec §7-§13) ---------- */

export const RESERVE_PASS_SLOTS = 10;

/** Creates the 10 pass slots for a fresh Reserve entitlement (idempotent). */
export async function ensureReservePasses(tx: Db, ownerId: string): Promise<void> {
  const existing = await tx.guestPass.count({ where: { ownerUserId: ownerId } });
  if (existing > 0) return;
  await tx.guestPass.createMany({
    data: Array.from({ length: RESERVE_PASS_SLOTS }, (_, slotIndex) => ({
      ownerUserId: ownerId,
      slotIndex,
    })),
    /* SQLite createMany has no skipDuplicates — the count guard above is
       the idempotency mechanism (and the slot unique constraint backs it). */
  });
}

interface PassRow {
  id: string;
  ownerUserId: string;
  status: string;
  issuedAt: Date | null;
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
  invites: { id: string; status: string; method: string; expiresAt: Date }[];
}

/**
 * Lazy expiry (spec §13): pending invitations past their window are marked
 * expired and their pass slot returns to the allocation. Runs on every pass
 * surface read — no timers, the next access pays the cost.
 */
export async function lazyExpireInvites(ownerUserId?: string): Promise<void> {
  const where: Prisma.GuestPassInviteWhereInput = {
    status: "pending",
    expiresAt: { lte: new Date() },
    ...(ownerUserId ? { pass: { ownerUserId } } : {}),
  };
  const stale = await db.guestPassInvite.findMany({
    where,
    select: { id: true, passId: true },
    take: 200,
  });
  if (stale.length === 0) return;
  await db.$transaction([
    db.guestPassInvite.updateMany({
      where: { id: { in: stale.map((i) => i.id) } },
      data: { status: "expired" },
    }),
    db.guestPass.updateMany({
      where: { id: { in: stale.map((i) => i.passId) }, status: "issued" },
      data: { status: "available" }, // slot returns to the allocation
    }),
  ]);
}

/** Effective pass status: an issued pass is only consuming while a pending,
 *  unexpired invitation exists (server rows are already lazy-expired). */
export function effectivePassStatusServer(pass: PassRow, now = Date.now()): GuestPassStatus {
  if (pass.status === "issued") {
    const pending = pass.invites.some(
      (inv) => inv.status === "pending" && inv.expiresAt.getTime() > now
    );
    if (!pending) return "expired";
  }
  return pass.status as GuestPassStatus;
}

/** Serialize a GuestPass row (+ current invite) into the client shape. */
export function serializePass(pass: PassRow, now = Date.now()): ReserveGuestPass {
  const status = effectivePassStatusServer(pass, now);
  const pendingInvite = pass.invites.find((inv) => inv.status === "pending");
  return {
    id: pass.id,
    ownerUserId: pass.ownerUserId,
    status,
    issuedAt: pass.issuedAt?.toISOString(),
    expiresAt: status === "issued" ? pendingInvite?.expiresAt.toISOString() : undefined,
    redeemedAt: pass.redeemedAt?.toISOString(),
    redeemedByUserId: pass.redeemedByUserId ?? undefined,
    note: pendingInvite ? `Invited via ${pendingInvite.method === "qr" ? "QR" : "secure link"}` : undefined,
  };
}

export interface SerializedInvite {
  id: string;
  passId: string;
  method: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  slotIndex: number;
}

/** Allocation accounting identical to the client-side pure helper. */
export function allocationFromPasses(passes: ReserveGuestPass[]) {
  const total = RESERVE_PASS_SLOTS;
  let pending = 0;
  let redeemed = 0;
  for (const p of passes) {
    if (p.status === "issued") pending += 1;
    if (p.status === "redeemed") redeemed += 1;
  }
  return { total, pending, redeemed, available: Math.max(0, total - pending - redeemed) };
}
