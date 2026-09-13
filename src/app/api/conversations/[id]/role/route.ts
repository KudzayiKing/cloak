import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { GroupOperationError, setMemberRole, type GroupRole } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "member", "owner"]), // "owner" = ownership transfer
});

/** Promote/demote a member, or transfer ownership (owner only, spec §6/§76). */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  let body: z.infer<typeof roleSchema>;
  try {
    body = roleSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    await setMemberRole({
      conversationId,
      actorId: user.id,
      actorName: user.displayName,
      targetUserId: body.userId,
      role: body.role as GroupRole,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
