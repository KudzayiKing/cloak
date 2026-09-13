import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { CircleOperationError, resolveCircleJoinRequest } from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  requestId: z.string().min(1).max(64),
  approve: z.boolean(),
});

/** Resolve an approval-queue join request (spec §41) — managers only. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof resolveSchema>;
  try {
    body = resolveSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const result = await resolveCircleJoinRequest({
      circleId,
      actorId: user.id,
      requestId: body.requestId,
      approve: body.approve,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
