import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  getPrivacySettings,
  savePrivacySettings,
} from "@/lib/cloak/server/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Groups & Circles privacy settings (spec §74) — server-backed so the
 *  enforcement happens where the decision is made (§80). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const settings = await getPrivacySettings(user.id);
  return NextResponse.json({ ok: true, settings });
}

const putSchema = z.object({
  groupInvitePolicy: z.enum(["trusted", "valid_invite", "nobody"]).optional(),
  circleInvitePolicy: z.enum(["trusted", "valid_invite", "nobody"]).optional(),
  defaultAiAccess: z.enum(["disabled", "current_request", "allowed"]).optional(),
});

export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const settings = await savePrivacySettings(user.id, body);
  return NextResponse.json({ ok: true, settings });
}
