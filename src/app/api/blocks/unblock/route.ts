import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { listBlocks, unblockUser } from "@/lib/cloak/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unblockSchema = z.object({ userId: z.string().min(1).max(64) });

/** Unblock (spec §75) — by userId from the blocker's own list. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof unblockSchema>;
  try {
    body = unblockSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  await unblockUser(user.id, body.userId);
  const blocked = await listBlocks(user.id);
  return NextResponse.json({ ok: true, blocked });
}
