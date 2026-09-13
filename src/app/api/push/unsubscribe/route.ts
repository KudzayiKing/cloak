import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { removePushSubscription } from "@/lib/cloak/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

/** Forget this device — fired when the client unsubscribes itself. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof unsubscribeSchema>;
  try {
    body = unsubscribeSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  await removePushSubscription(user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
