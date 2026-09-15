import { NextRequest, NextResponse } from "next/server";
import { clientIp, getSessionUser } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  checkInviteRateLimit,
  extendAdviserInvitation,
  isAdminUser,
  requireSameOrigin,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ ok: false, error: user ? "forbidden" : "unauthenticated" }, { status: user ? 403 : 401, headers: adviserNoStoreHeaders() });
  }
  if (!requireSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: adviserNoStoreHeaders() });
  }
  const limit = checkInviteRateLimit(`admin:${clientIp(req)}:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }) });
  }
  let body: { expiryDays?: number; expiresAt?: string } = {};
  try {
    body = (await req.json()) as { expiryDays?: number; expiresAt?: string };
  } catch {
    body = {};
  }
  const expiryDays = Number.isFinite(body.expiryDays) ? Number(body.expiryDays) : 7;
  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt)
    : new Date(Date.now() + Math.min(Math.max(expiryDays, 1), 90) * 24 * 3600 * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    return NextResponse.json({ ok: false, error: "bad_expiry" }, { status: 400, headers: adviserNoStoreHeaders() });
  }
  const { id } = await params;
  try {
    const invitation = await extendAdviserInvitation(id, expiresAt, user.id);
    return NextResponse.json({ ok: true, invitation }, { headers: adviserNoStoreHeaders() });
  } catch (err) {
    const error = err instanceof Error ? err.message : "server_error";
    return NextResponse.json({ ok: false, error }, { status: error.startsWith("bad_") ? 400 : error === "not_pending" ? 409 : 500, headers: adviserNoStoreHeaders() });
  }
}
