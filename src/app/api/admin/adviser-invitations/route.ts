import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, clientIp } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  checkInviteRateLimit,
  createAdviserInvitation,
  isAdminUser,
  listAdviserInvitations,
  requireSameOrigin,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  recipientName?: string;
  recipientEmail?: string;
  expiryDays?: number;
  customExpiresAt?: string;
  emailBindingRequired?: boolean;
  internalNote?: string;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ ok: false, error: user ? "forbidden" : "unauthenticated" }, { status: user ? 403 : 401, headers: adviserNoStoreHeaders() });
  }
  return NextResponse.json({ ok: true, invitations: await listAdviserInvitations() }, { headers: adviserNoStoreHeaders() });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ ok: false, error: user ? "forbidden" : "unauthenticated" }, { status: user ? 403 : 401, headers: adviserNoStoreHeaders() });
  }
  if (!requireSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: adviserNoStoreHeaders() });
  }
  const limit = checkInviteRateLimit(`admin:${clientIp(req)}:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }) }
    );
  }

  let body: CreateBody = {};
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    body = {};
  }

  const expiryDays = Number.isFinite(body.expiryDays) ? Number(body.expiryDays) : 7;
  const expiresAt = body.customExpiresAt
    ? new Date(body.customExpiresAt)
    : new Date(Date.now() + Math.min(Math.max(expiryDays, 1), 90) * 24 * 3600 * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    return NextResponse.json({ ok: false, error: "bad_expiry" }, { status: 400, headers: adviserNoStoreHeaders() });
  }

  try {
    const result = await createAdviserInvitation({
      recipientName: body.recipientName ?? "",
      recipientEmail: body.recipientEmail ?? "",
      expiresAt,
      emailBindingRequired: body.emailBindingRequired !== false,
      internalNote: body.internalNote,
      adminUserId: user.id,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: adviserNoStoreHeaders() });
  } catch (err) {
    const error = err instanceof Error ? err.message : "server_error";
    const status = error.startsWith("bad_") ? 400 : 500;
    return NextResponse.json({ ok: false, error }, { status, headers: adviserNoStoreHeaders() });
  }
}
