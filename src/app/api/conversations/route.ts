import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  findOrCreateDm,
  loadConversationDetail,
  loadConversationsForUser,
  mapConversation,
  purgeExpiredMessages,
  GHOST_SECONDS_ALLOWED,
} from "@/lib/cloak/server/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  await purgeExpiredMessages();
  const payload = await loadConversationsForUser(user.id);
  return NextResponse.json({ ok: true, ...payload });
}

const createSchema = z.object({
  handle: z.string().min(1).max(64),
  /** Ghost chat: TTL seconds for messages sent in this conversation
   *  (30/300/3600/86400/604800). Present = apply, including to an
   *  existing DM ("New ghost chat" over an existing thread). */
  ghostSeconds: z.number().int().refine((s) => (GHOST_SECONDS_ALLOWED as readonly number[]).includes(s)).optional(),
});

/** Open (find-or-create) a 1:1 conversation with the given @handle. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const handle = body.handle.trim().replace(/^@+/, "").toLowerCase();
  const peer = await db.user.findUnique({ where: { handle } });
  if (!peer || peer.id === user.id) {
    return NextResponse.json({ ok: false, error: "unknown_handle" }, { status: 404 });
  }
  const conv = await findOrCreateDm(user.id, peer.id, body.ghostSeconds);
  const detail = await loadConversationDetail(conv.id, user.id);
  const conversation = detail ?? mapConversation(conv, user.id);
  return NextResponse.json({
    ok: true,
    conversation,
    contact: {
      id: peer.id,
      name: peer.displayName,
      cloakId: `@${peer.handle}`,
      avatarInitials: peer.displayName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]!.toUpperCase())
        .join(""),
      verification: "verified" as const,
      about: peer.about ?? undefined,
    },
  });
}
