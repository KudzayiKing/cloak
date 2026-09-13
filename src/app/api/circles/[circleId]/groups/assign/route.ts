import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { resolveHandles } from "@/lib/cloak/server/groups";
import {
  CircleOperationError,
  assignMemberToGroup,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assignSchema = z.object({
  groupId: z.string().min(1),
  handle: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
});

/** Assign a circle member to one of the circle's groups (spec §27
 *  circle.member.assign_group). Accepts a stored userId or an @handle. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof assignSchema>;
  try {
    body = assignSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!body.handle && !body.userId) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    let targetUserId = body.userId;
    if (body.handle) {
      const { users, unknown } = await resolveHandles([body.handle]);
      if (users.length === 0 || unknown.length > 0) {
        return NextResponse.json({ ok: false, error: "unknown_handle" }, { status: 400 });
      }
      targetUserId = users[0].id;
    }
    await assignMemberToGroup({
      circleId,
      actorId: user.id,
      actorName: user.displayName,
      groupId: body.groupId,
      targetUserId: targetUserId!,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
