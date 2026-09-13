import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "@/lib/cloak/server/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** In-app notifications (spec §62) — the viewer's own structural events. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const [notifications, unread] = await Promise.all([
    listNotifications(user.id),
    unreadNotificationCount(user.id),
  ]);
  return NextResponse.json({ ok: true, notifications, unread });
}

const readSchema = z.object({ id: z.string().min(1).max(64).optional(), all: z.boolean().optional() });

/** Mark read: one notification ({id}) or everything ({all: true}). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof readSchema>;
  try {
    body = readSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  await markNotificationsRead(user.id, body.all ? undefined : body.id);
  const unread = await unreadNotificationCount(user.id);
  return NextResponse.json({ ok: true, unread });
}
