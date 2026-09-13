import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  entitlementForUser,
  grantMembership,
  hashInviteTokenServer,
  lazyExpireInvites,
} from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/membership/invite-redeem — consume a pending invitation and
 * grant the recipient a REAL Cloak Private membership (spec §8, §10):
 * single-use, permanently consumed, never recycled. Recipient rules:
 * never silently waste a pass (an existing membership blocks redemption
 * WITHOUT consuming the pass), never downgrade Reserve, never double-grant.
 * Runs lazily after invite expiry so a stale token can never redeem.
 */

interface RedeemBody {
  token?: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: RedeemBody = {};
  try {
    body = (await req.json()) as RedeemBody;
  } catch {
    body = {};
  }
  const token = (body.token ?? "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 400 });
  }

  await lazyExpireInvites();

  const tokenHash = hashInviteTokenServer(token);
  const invite = await db.guestPassInvite.findUnique({
    where: { tokenHash },
    include: { pass: true },
  });
  if (!invite || !invite.pass) {
    return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 404 });
  }
  if (invite.status === "redeemed" || invite.pass.status === "redeemed") {
    return NextResponse.json({ ok: false, error: "already_redeemed" }, { status: 409 });
  }
  if (invite.status === "expired" || invite.pass.status === "expired") {
    return NextResponse.json({ ok: false, error: "already_expired" }, { status: 409 });
  }
  if (invite.status === "revoked" || invite.pass.status === "revoked_before_redemption") {
    return NextResponse.json({ ok: false, error: "already_revoked" }, { status: 409 });
  }
  if (invite.status !== "pending" || invite.pass.status !== "issued") {
    return NextResponse.json({ ok: false, error: "not_pending" }, { status: 409 });
  }

  /* Recipient rules (spec §10) — checked BEFORE any consumption. */
  const recipient = await db.user.findUnique({
    where: { id: user.id },
    select: { membershipTier: true, membershipOrigin: true, membershipGrantedAt: true },
  });
  const entitlement = entitlementForUser(recipient ?? { membershipTier: null, membershipOrigin: null, membershipGrantedAt: null });
  if (entitlement.membership === "reserve") {
    return NextResponse.json({ ok: false, error: "recipient_already_reserve" }, { status: 409 });
  }
  if (entitlement.membership !== "none") {
    return NextResponse.json({ ok: false, error: "recipient_already_private" }, { status: 409 });
  }

  let granted;
  try {
    granted = await db.$transaction(async (txDb) => {
      const updated = await txDb.guestPassInvite.updateMany({
        where: { id: invite.id, status: "pending" }, // optimistic guard: one redemption wins
        data: { status: "redeemed", redeemedByUserId: user.id, redeemedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("invite_race");
      await txDb.guestPass.update({
        where: { id: invite.passId },
        data: { status: "redeemed", redeemedByUserId: user.id, redeemedAt: new Date() },
      });
      await grantMembership(txDb, user.id, "private", "reserve_guest_pass");
      const fresh = await txDb.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { membershipTier: true, membershipOrigin: true, membershipGrantedAt: true },
      });
      return entitlementForUser(fresh);
    });
  } catch (err) {
    if (err instanceof Error && err.message === "invite_race") {
      return NextResponse.json({ ok: false, error: "already_redeemed" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, entitlement: granted });
}
