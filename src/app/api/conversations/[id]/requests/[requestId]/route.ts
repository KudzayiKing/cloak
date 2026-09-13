import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { GroupOperationError, resolveJoinRequest } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; requestId: string }> };

/** Approve or decline a join request (spec §10, admin approval required). */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId, requestId } = await params;

  let approve: boolean;
  try {
    const raw = (await req.json()) as { approve?: unknown };
    if (typeof raw.approve !== "boolean") throw new Error("bad");
    approve = raw.approve;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const result = await resolveJoinRequest({
      conversationId,
      requestId,
      actorId: user.id,
      actorName: user.displayName,
      approve,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
