import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/security/devices/:deviceId/revoke — plain revocation
 * (dagger codex §24: "Do not confuse simple revocation with Dagger").
 *
 * Kills every session bound to the device immediately. No local-wipe
 * command is queued — the device's local encrypted storage remains until
 * the app is used again on it.
 */

type Params = { params: Promise<{ deviceId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { deviceId } = await params;
  if (!deviceId) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Sessions created before the device registry existed have no deviceId to
     revoke, so they cannot be killed by the normal path — and because
     getSessionUser only enforces revocation for BOUND sessions, they were
     effectively unrevocable for their whole 30-day life. The list surfaces
     them as one `legacy-<userId>` row; revoking that row deletes every
     unbound session the caller owns. The id is checked against the caller so
     it can never target another account. */
  if (deviceId.startsWith("legacy-")) {
    if (deviceId !== `legacy-${user.id}`) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const removed = await db.session.deleteMany({
      where: { userId: user.id, deviceId: null },
    });
    return NextResponse.json({ ok: true, revoked: true, sessions: removed.count });
  }

  const owned = await db.session.findFirst({
    where: { userId: user.id, deviceId },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  await db.deviceRevocation.upsert({
    where: { deviceId },
    update: { reason: "manual", revokedAt: new Date() },
    create: { userId: user.id, deviceId, reason: "manual" },
  });
  await db.device
    .update({ where: { id: deviceId }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
  await db.session.deleteMany({ where: { deviceId } });

  return NextResponse.json({ ok: true, revoked: true });
}
