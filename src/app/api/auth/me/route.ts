import { NextRequest, NextResponse } from "next/server";
import { ensureDevAccounts, getSessionUser } from "@/lib/cloak/server/auth";
import { entitlementForUser } from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDevAccounts();
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, user, membership: entitlementForUser(user) });
}
