import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  CircleOperationError,
  createCircleInvite,
  loadCircleDetail,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  groupIds: z.array(z.string().min(1)).max(50).default([]),
  expiresInDays: z.number().int().min(1).max(30).optional(),
  /** §41 "Approval required": redemption files a join request instead of
   *  joining directly; the single-use token is consumed on approval. */
  approvalRequired: z.boolean().optional(),
});

/** List invites (managers) — GET; create one — POST (spec §40/§41).
 *  The raw token + full URL exist ONLY in this response; the server keeps
 *  the hash. Least-privilege is explicit in the selected groupIds. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  const circle = await loadCircleDetail(circleId, user.id);
  if (!circle) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, invites: circle.invites ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  let body: z.infer<typeof inviteSchema>;
  try {
    body = inviteSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const { invite, token, url } = await createCircleInvite({
      circleId,
      createdByUserId: user.id,
      groupIds: body.groupIds,
      expiresInDays: body.expiresInDays,
      approvalRequired: body.approvalRequired,
    });
    return NextResponse.json({
      ok: true,
      invite: {
        id: invite.id,
        token,
        url,
        expiresAt: invite.expiresAt.getTime(),
        maxUses: invite.maxUses,
      },
    });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
