import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/security/devices/:deviceId/dagger — Remote Dagger
 * (dagger codex §16/§18/§19).
 *
 * Server-authoritative, authenticated, scoped to one device, replay-
 * resistant:
 *   1. DeviceRevocation row upserted (reason dagger) — every current and
 *      future session bound to this device is deleted on sight by
 *      getSessionUser, so access dies HERE, before any local completion.
 *   2. All sessions bound to the device are deleted immediately.
 *   3. A single-use DaggerCommand (status "issued", unique nonce) is
 *      queued — the target destroys its local Cloak data the next time it
 *      connects. Offline devices cannot receive the local wipe command
 *      until they reconnect (never claim a guaranteed remote wipe).
 */

type Params = { params: Promise<{ deviceId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { deviceId } = await params;
  if (!deviceId || deviceId.startsWith("legacy-")) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Scope check: the device must actually belong to the caller. */
  const owned = await db.session.findFirst({
    where: { userId: user.id, deviceId },
    select: { id: true },
  });
  const alreadyRevoked = await db.deviceRevocation.findUnique({ where: { deviceId } });
  if (!owned && !alreadyRevoked) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (alreadyRevoked && alreadyRevoked.userId !== user.id) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  /* 1+2: revoke server-side NOW — the registry row too, so the device
     credential can never re-enroll this identity (codex §26). */
  await db.deviceRevocation.upsert({
    where: { deviceId },
    update: { reason: "dagger", revokedAt: new Date() },
    create: { userId: user.id, deviceId, reason: "dagger" },
  });
  await db.device
    .update({ where: { id: deviceId }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
  await db.session.deleteMany({ where: { deviceId } });

  /* 3: single-use local-wipe command for the next reconnect. */
  const command = await db.daggerCommand.create({
    data: {
      userId: user.id,
      deviceId,
      nonce: randomBytes(24).toString("base64url"),
      status: "issued",
    },
  });

  return NextResponse.json({
    ok: true,
    revoked: true,
    commandId: command.id,
    /* Honest limitation (§39): local destruction happens only when the
       target reconnects. */
    note: "device_revoked_local_wipe_pending",
  });
}
