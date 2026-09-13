import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { isParticipant } from "@/lib/cloak/server/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mark the conversation read for the caller (drives the peer's read ticks). */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  await db.participation.updateMany({
    where: { conversationId, userId: user.id },
    data: { lastReadAt: new Date(), lastDeliveredAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
