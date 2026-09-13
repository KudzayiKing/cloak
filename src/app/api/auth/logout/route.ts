import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  destroySession,
  isSecureRequest,
} from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await destroySession(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 0,
  });
  return res;
}
