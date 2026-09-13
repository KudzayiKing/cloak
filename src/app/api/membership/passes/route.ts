import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  allocationFromPasses,
  lazyExpireInvites,
  serializePass,
} from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/membership/passes — the Reserve member's Private pass allocation
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
    select: { membershipTier: true },
  });
  if (full?.membershipTier !== "reserve") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rows = await db.guestPass.findMany({
    where: { ownerUserId: user.id },
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
    allocation: allocationFromPasses(passes),
  });
}
