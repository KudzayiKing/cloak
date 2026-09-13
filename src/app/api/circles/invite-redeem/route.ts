import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { CircleOperationError, redeemCircleInvite } from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redeemSchema = z.object({ token: z.string().min(1).max(200) });

/** Redeem a circle invite (spec §40/§61). REQUIRES an existing account:
 *  circle invites organize people who are already Cloak members — they are
 *  not a registration path (§60; registration itself is payment-gated and
 *  Reserve guest passes are the onboarding grant). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof redeemSchema>;
  try {
    body = redeemSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const result = await redeemCircleInvite({
      token: body.token,
      userId: user.id,
      userName: user.displayName,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
