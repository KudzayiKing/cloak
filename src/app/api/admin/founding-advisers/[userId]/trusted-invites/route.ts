import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { ensureGrantPasses, lazyExpireInvites } from "@/lib/cloak/server/membership-server";
import { adviserNoStoreHeaders, isAdminUser, requireSameOrigin } from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/founding-advisers/[userId]/trusted-invites">
) {
  const actor = await getSessionUser(req);
  if (!isAdminUser(actor)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: actor ? 403 : 401, headers: adviserNoStoreHeaders() });
  const { userId } = await ctx.params;
  const owner = await db.user.findFirst({
    where: { id: userId, membershipTier: "private", membershipOrigin: "founding_adviser" },
    select: {
      passesGranted: { where: { program: "founding_adviser" }, select: { status: true } },
    },
  });
  if (!owner) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: adviserNoStoreHeaders() });
  const pending = owner.passesGranted.filter((row) => row.status === "issued").length;
  const redeemed = owner.passesGranted.filter((row) => row.status === "redeemed").length;
  const total = owner.passesGranted.length;
  return NextResponse.json({ ok: true, allocation: { total, pending, redeemed, available: total - pending - redeemed } }, { headers: adviserNoStoreHeaders() });
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/founding-advisers/[userId]/trusted-invites">
) {
  const actor = await getSessionUser(req);
  if (!isAdminUser(actor)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: actor ? 403 : 401, headers: adviserNoStoreHeaders() });
  if (!requireSameOrigin(req)) return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: adviserNoStoreHeaders() });

  const { userId } = await ctx.params;
  let body: { amount?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: adviserNoStoreHeaders() });
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400, headers: adviserNoStoreHeaders() });
  }

  const owner = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, membershipTier: true, membershipOrigin: true },
  });
  if (!owner || owner.membershipTier !== "private" || owner.membershipOrigin !== "founding_adviser") {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: adviserNoStoreHeaders() });
  }

  await lazyExpireInvites(userId);
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.guestPass.count({ where: { ownerUserId: userId, program: "founding_adviser" } });
    await tx.guestPass.createMany({
      data: Array.from({ length: amount }, (_, index) => ({
        ownerUserId: userId,
        program: "founding_adviser",
        slotIndex: existing + index,
      })),
    });
    await tx.trustedInviteAdminEvent.create({
      data: { ownerUserId: userId, actorUserId: actor!.id, amount },
    });
    return tx.guestPass.findMany({
      where: { ownerUserId: userId, program: "founding_adviser" },
      select: { status: true },
    });
  }, { isolationLevel: "Serializable" });

  const pending = created.filter((row) => row.status === "issued").length;
  const redeemed = created.filter((row) => row.status === "redeemed").length;
  return NextResponse.json({
    ok: true,
    allocation: { total: created.length, pending, redeemed, available: Math.max(0, created.length - pending - redeemed) },
  }, { headers: adviserNoStoreHeaders() });
}
