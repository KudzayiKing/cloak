import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authenticateDevice,
  DEVICE_ID_HEADER,
  DEVICE_TOKEN_HEADER,
  getSessionUser,
  hashToken,
} from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Dagger command channel (dagger codex §18/§19).
 *
 * GET  -> poll for a pending local-wipe command for THIS device. The status
 *         machine only moves forward (issued -> delivered -> executing ->
 *         completed) and the updateMany CAS makes delivery single-use: a
 *         replayed poll cannot observe the same "issued" command twice.
 * POST -> the target reports progress (executing/completed) so the queue
 *         drains honestly.
 *
 * Authentication is DEVICE-scoped: X-Cloak-Device-Id + X-Cloak-Device-Token.
 * This is deliberate — a Remote Dagger destroys the device's user sessions
 * server-side BEFORE the target reconnects, so the device credential is the
 * only remaining way to authenticate and pick up the wipe command (§18:
 * "target destroys local Cloak data next time it connects"). A session-
 * bound fallback covers sessions created before the device registry.
 */

const progressSchema = z.object({
  status: z.enum(["executing", "completed"]),
});

async function resolveDevice(req: NextRequest): Promise<{ userId: string; deviceId: string } | null> {
  try {
    /* Primary: device credential (survives session destruction). */
    const viaDevice = await authenticateDevice(req);
    if (viaDevice) {
      return { userId: viaDevice.device.userId, deviceId: viaDevice.device.id };
    }
    /* Fallback: session bound to a device (legacy / same-boot polls). */
    const user = await getSessionUser(req);
    if (!user) return null;
    const tokenHash = hashToken(req.cookies.get("cloak_session")?.value ?? "");
    const session = await db.session.findUnique({ where: { tokenHash } });
    if (!session?.deviceId) return null;
    return { userId: user.id, deviceId: session.deviceId };
  } catch {
    /* Dagger polling is fail-closed: an unavailable DB must not crash the
       client loop or imply that a wipe command exists. */
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ctx = await resolveDevice(req);
  if (!ctx) {
    return NextResponse.json({ ok: true, pending: false });
  }

  /* Deliver at most once: CAS from "issued" to "delivered". */
  const delivered = await db.daggerCommand.updateMany({
    where: { deviceId: ctx.deviceId, status: "issued" },
    data: { status: "delivered", deliveredAt: new Date() },
  });

  if (delivered.count === 0) {
    /* Drain terminal rows lazily so the queue never grows. */
    await db.daggerCommand
      .deleteMany({ where: { deviceId: ctx.deviceId, status: "completed" } })
      .catch(() => undefined);
    return NextResponse.json({ ok: true, pending: false });
  }

  const command = await db.daggerCommand.findFirst({
    where: { deviceId: ctx.deviceId, status: "delivered" },
    orderBy: { issuedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    pending: true,
    command: command
      ? { id: command.id, nonce: command.nonce, issuedAt: command.issuedAt.getTime() }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveDevice(req);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let parsed: z.infer<typeof progressSchema>;
  try {
    parsed = progressSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Forward-only: executing -> completed; completed is terminal. */
  if (parsed.status === "executing") {
    await db.daggerCommand.updateMany({
      where: { deviceId: ctx.deviceId, status: "delivered" },
      data: { status: "executing" },
    });
  } else {
    await db.daggerCommand.updateMany({
      where: { deviceId: ctx.deviceId, status: { in: ["delivered", "executing"] } },
      data: { status: "completed", completedAt: new Date() },
    });
  }
  return NextResponse.json({ ok: true });
}
