import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/membership/passes/revoke — revoke a PENDING invitation (spec
 * §12: "Allow revocation while still pending"). Redemption is final — a
 * redeemed pass can never be pulled back, so only pending invites qualify.
 * The slot returns to the allocation immediately.
 */

interface RevokeBody {
  passId?: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: RevokeBody = {};
  try {
    body = (await req.json()) as RevokeBody;
  } catch {
    body = {};
  }
  if (!body.passId) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const pass = await db.guestPass.findUnique({
    where: { id: body.passId },
    include: { invites: { where: { status: "pending" } } },
  });
  if (!pass || pass.ownerUserId !== user.id) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (pass.status === "redeemed") {
    return NextResponse.json(
      {
        ok: false,
        error: "already_redeemed",
        message: "This pass was redeemed. A redeemed membership can never be pulled back.",
      },
      { status: 409 }
    );
  }
  if (pass.status !== "issued" || pass.invites.length === 0) {
    return NextResponse.json({ ok: false, error: "not_pending" }, { status: 409 });
  }

  await db.$transaction([
    db.guestPassInvite.updateMany({
      where: { passId: pass.id, status: "pending" },
      data: { status: "revoked" },
    }),
    db.guestPass.update({
      where: { id: pass.id },
      data: { status: "available", issuedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
