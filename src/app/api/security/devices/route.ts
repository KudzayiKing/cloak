import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  bindSessionDevice,
  getSessionUser,
  listDevices,
} from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Trusted-devices registry (dagger codex §16/§24).
 *
 * GET  -> active sessions grouped by bound deviceId (the Trusted Devices
 *         list; the caller's own device is flagged `current`).
 * POST -> bind the caller's session to a deviceId (bootstrap path for
 *         sessions created before the registry existed). Idempotent; a
 *         session that is already bound is never re-bound to another id.
 */

const bindSchema = z.object({
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(64).optional(),
  deviceToken: z.string().min(16).max(128).optional(),
});

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const devices = await listDevices(req);
  return NextResponse.json({ ok: true, devices });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let parsed: z.infer<typeof bindSchema>;
  try {
    parsed = bindSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const bound = await bindSessionDevice(req, parsed.deviceId, parsed.deviceName, parsed.deviceToken);
  if (!bound) {
    return NextResponse.json({ ok: false, error: "device_unavailable" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
