import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { vapidPublicKey } from "@/lib/cloak/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public VAPID public key for push subscription (spec §62 transport).
 * The public key is designed to be shared with every client; the private
 * key never leaves the server env.
 */
export async function GET() {
  const publicKey = vapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ ok: false, error: "push_not_configured" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, publicKey });
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

/** Register (or refresh) this device's push subscription for the signer-in. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let body: z.infer<typeof subscribeSchema>;
  try {
    body = subscribeSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { addPushSubscription } = await import("@/lib/cloak/server/push");
  await addPushSubscription({
    userId: user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
