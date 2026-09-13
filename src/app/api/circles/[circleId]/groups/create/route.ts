import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { GHOST_SECONDS_ALLOWED, loadConversationDetail } from "@/lib/cloak/server/conversations";
import { resolveHandles } from "@/lib/cloak/server/groups";
import {
  CircleOperationError,
  createCircleGroup,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  handles: z.array(z.string().max(64)).max(50).optional(),
  ghostSeconds: z
    .number()
    .int()
    .refine((s) => (GHOST_SECONDS_ALLOWED as readonly number[]).includes(s) && s > 0)
    .optional(),
});

/** Create a group inside the circle (spec §44). The group inherits the
 *  circle security defaults (§38) and may only seat ACTIVE circle members
 *  (§26 — group membership is an explicit second grant). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const { users, unknown } = await resolveHandles(body.handles ?? []);
    const conversation = await createCircleGroup({
      circleId,
      actorId: user.id,
      actorName: user.displayName,
      title: body.title,
      description: body.description,
      memberIds: users.map((u) => u.id),
      ghostSeconds: body.ghostSeconds,
    });
    const detail = await loadConversationDetail(conversation.id, user.id);
    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      conversation: detail,
      unknownHandles: unknown,
    });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
