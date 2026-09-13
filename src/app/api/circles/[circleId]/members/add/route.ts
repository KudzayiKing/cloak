import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { resolveHandles } from "@/lib/cloak/server/groups";
import {
  CircleOperationError,
  addCircleMembers,
  loadCircleDetail,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addSchema = z.object({
  handles: z.array(z.string().max(64)).min(1).max(50),
});

/** Add existing Cloak members to the circle (spec §25/§27). Direct adds
 *  grant the SHELL only — zero group access until someone with
 *  circle.member.assign_group places them (§26). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof addSchema>;
  try {
    body = addSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const { users, unknown } = await resolveHandles(body.handles);
    const added = await addCircleMembers({
      circleId,
      actorId: user.id,
      userIds: users.map((u) => u.id),
    });
    const circle = await loadCircleDetail(circleId, user.id);
    return NextResponse.json({ ok: true, added, unknownHandles: unknown, circle });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
