import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { CircleOperationError, setCirclePolicy } from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const policySchema = z.object({
  newMemberHistory: z.enum(["none", "all"]).optional(),
  cloudAi: z.enum(["disabled", "current_request", "allowed"]).optional(),
  inviteExpiryDays: z.number().int().min(1).max(30).optional(),
});

/** Circle security policy (spec §38). Groups created afterwards inherit
 *  these defaults; existing groups may only be stricter (§39 precedence). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof policySchema>;
  try {
    body = policySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    await setCirclePolicy({ circleId, actorId: user.id, ...body });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
