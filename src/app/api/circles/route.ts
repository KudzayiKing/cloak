import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  CircleOperationError,
  createCircle,
  listMyCircles,
} from "@/lib/cloak/server/circles";
import { CIRCLE_TEMPLATES } from "@/lib/cloak/server/circles";
import { entitlementForUser } from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  templateId: z.string().trim().max(40).optional(),
});

/** My circles (spec §28/§50): everything the viewer is an active member of.
 *  Summary counts follow the §26 visibility model — members never see
 *  hidden group names, only the count. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const circles = await listMyCircles(user.id);
  return NextResponse.json({ ok: true, circles });
}

/** Create a Circle (spec §30/§32/§34). Tier-gated server-side: Private
 *  accounts may NOT create circles; Reserve gets one personal Circle;
 *  managed tiers get the configured pool (spec §32/§58/§59). */
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

  if (body.templateId && !CIRCLE_TEMPLATES.some((t) => t.id === body.templateId)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const circle = await createCircle({
      ownerId: user.id,
      ownerName: user.displayName,
      name: body.name,
      description: body.description,
      tier: entitlementForUser(user).membership,
      templateId: body.templateId ?? null,
    });
    return NextResponse.json({ ok: true, circleId: circle.id });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
