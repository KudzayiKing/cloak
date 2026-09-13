import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  CircleOperationError,
  setCircleMemberRole,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]),
});

/** Role change / ownership transfer (spec §27/§76). Owner-only; the
 *  "owner" role performs the transfer (current owner steps down to admin). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof roleSchema>;
  try {
    body = roleSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    await setCircleMemberRole({
      circleId,
      actorId: user.id,
      targetUserId: body.userId,
      role: body.role,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
