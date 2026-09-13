import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  CircleOperationError,
  removeCircleMember,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const removeSchema = z.object({ userId: z.string().min(1) });

/** Circle offboarding (spec §61/§77): revokes the circle shell AND every
 *  circle group the target belongs to (v1 policy). Never touches the
 *  target's Cloak membership or unrelated conversations. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof removeSchema>;
  try {
    body = removeSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const result = await removeCircleMember({
      circleId,
      actorId: user.id,
      actorName: user.displayName,
      targetUserId: body.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
