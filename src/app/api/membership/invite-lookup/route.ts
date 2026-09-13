import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashInviteTokenServer, lazyExpireInvites } from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/membership/invite-lookup?token=... — token-gated invitation
 * screen data. NO AUTH: the recipient may not have a Cloak account yet —
 * that is the entire point of a guest pass (no wallet, no payment). The
 * 256-bit token in the link IS the capability; only its SHA-256 hash is
 * stored server-side. Returns pass state + inviter display name only —
 * never secrets, never token material (§43).
 */

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();
  if (!token || token.length < 20 || token.length > 200) {
    return NextResponse.json({ found: false, reason: "unknown_token" });
  }

  /* Late invitations must not linger: expiry runs on every lookup too. */
  await lazyExpireInvites();

  const tokenHash = hashInviteTokenServer(token);
  const invite = await db.guestPassInvite.findUnique({
    where: { tokenHash },
    include: {
      pass: { select: { status: true } },
    },
  });
  if (!invite) {
    return NextResponse.json({ found: false, reason: "unknown_token" });
  }

  const owner = await db.guestPass.findUnique({
    where: { id: invite.passId },
    select: { owner: { select: { displayName: true } } },
  });

  return NextResponse.json({
    found: true,
    status: invite.status, // pending | redeemed | expired | revoked
    inviterName: owner?.owner.displayName ?? "A Cloak Reserve member",
    method: invite.method,
    expiresAt: invite.expiresAt.toISOString(),
  });
}
