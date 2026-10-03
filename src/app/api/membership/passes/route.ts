import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  allocationFromPasses,
  ensureGrantPasses,
  grantProgramAllowance,
  lazyExpireInvites,
  serializePass,
  type MembershipGrantProgram,
} from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/membership/passes — the current member's Private grant allocation
 * (pricing spec §11). Owner-private: nothing here ever reaches another
 * member's surfaces (spec §15).
 */

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  await lazyExpireInvites(user.id);

  const full = await db.user.findUnique({
    where: { id: user.id },
    select: { membershipTier: true, membershipOrigin: true },
  });
  const program: MembershipGrantProgram | null = full?.membershipTier === "reserve"
    ? "reserve"
    : full?.membershipTier === "private" && full.membershipOrigin === "founding_adviser"
      ? "founding_adviser"
      : null;
  if (!program) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await ensureGrantPasses(db, user.id, program, grantProgramAllowance(program));

  const rows = await db.guestPass.findMany({
    where: { ownerUserId: user.id, program },
    include: {
      invites: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 },
      redeemedBy: { select: { displayName: true, handle: true } },
    },
    orderBy: { slotIndex: "asc" },
  });

  const passes = rows.map((row) => ({
    ...serializePass(row),
    redeemedByName: row.redeemedBy?.displayName ?? undefined,
  }));
  const invites = rows
    .flatMap((row) =>
      row.invites.map((inv) => ({
        id: inv.id,
        passId: row.id,
        slotIndex: row.slotIndex,
        method: inv.method,
        status: inv.status,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        redeemedByName: row.redeemedBy?.displayName,
      }))
    )
    .filter((inv) => inv.status === "pending");

  return NextResponse.json({
    ok: true,
    passes,
    invites,
    allocation: allocationFromPasses(passes, rows.length),
    program,
  });
}
