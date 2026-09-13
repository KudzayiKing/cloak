import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  BlockOperationError,
  blockUser,
  listBlocks,
} from "@/lib/cloak/server/blocks";
import { resolveHandles } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Blocked users (spec §75) — the blocker's own list. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const blocked = await listBlocks(user.id);
  return NextResponse.json({ ok: true, blocked });
}

const blockSchema = z.object({ handle: z.string().trim().min(1).max(64) });

/** Block a Cloak ID (spec §75). Idempotent. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof blockSchema>;
  try {
    body = blockSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const { users } = await resolveHandles([body.handle]);
    if (users.length === 0) {
      return NextResponse.json({ ok: false, error: "unknown_handle" }, { status: 404 });
    }
    await blockUser(user.id, users[0]!.id);
    const blocked = await listBlocks(user.id);
    return NextResponse.json({ ok: true, blocked });
  } catch (err) {
    if (err instanceof BlockOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
