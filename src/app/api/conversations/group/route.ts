import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { loadConversationDetail, GHOST_SECONDS_ALLOWED } from "@/lib/cloak/server/conversations";
import {
  GroupOperationError,
  createGroup,
  mapMembers,
  resolveHandles,
} from "@/lib/cloak/server/groups";
import { entitlementForUser } from "@/lib/cloak/server/membership-server";
import { defaultAiAccessFor } from "@/lib/cloak/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  handles: z.array(z.string().max(64)).max(50).optional(),
  /** Ghost group: TTL seconds (30/300/3600/86400/604800). */
  ghostSeconds: z.number().int().refine((s) => (GHOST_SECONDS_ALLOWED as readonly number[]).includes(s) && s > 0).optional(),
});

/**
 * Create a private group (groups spec §1, §44).
 * The creator becomes owner; invited handles become members.
 * Groups are never discoverable — only members see them.
 */
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

  try {
    const { users } = await resolveHandles(body.handles ?? []);
    const conversation = await createGroup({
      creatorId: user.id,
      creatorName: user.displayName,
      title: body.title,
      description: body.description,
      memberIds: users.map((u) => u.id),
      // Real server-authoritative tier (dev fallback included) — the old
      // hardcoded "private" silently capped Reserve owners at 20 groups.
      tier: entitlementForUser(user).membership,
      ghostSeconds: body.ghostSeconds,
      // §74: standalone groups honor the creator's default AI access.
      // (Circle-created groups inherit the Circle policy instead, §44.)
      aiAccess: await defaultAiAccessFor(user.id),
    });

    const detail = await loadConversationDetail(conversation.id, user.id);
    const full = await db.conversation.findUnique({
      where: { id: conversation.id },
      include: { participations: { include: { user: true } } },
    });
    return NextResponse.json({
      ok: true,
      conversation: detail,
      members: full ? mapMembers(full.participations, user.id) : [],
      unknownHandles: (() => {
        const requested = new Set(
          (body.handles ?? []).map((h) => h.trim().replace(/^@+/, "").toLowerCase())
        );
        for (const u of users) requested.delete(u.handle);
        return [...requested];
      })(),
    });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
