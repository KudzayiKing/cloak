import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { purgeExpiredAttachments } from "@/lib/cloak/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Fetch ONE encrypted attachment payload.
 *
 * Returns raw ciphertext — the route has no key material and cannot read what
 * it serves. Authorization is folded into the query rather than checked after
 * the fetch, so an unauthorized caller cannot even learn whether an id exists:
 * the `participations.some` predicate makes the row invisible to anyone who is
 * not an active member of the owning conversation.
 *
 * Expired blobs are treated as absent, and `no-store` keeps a private payload
 * out of any shared cache on the way back.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  await purgeExpiredAttachments();

  const blob = await db.attachmentBlob.findFirst({
    where: {
      id,
      conversation: { participations: { some: { userId: user.id, removedAt: null } } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { ciphertext: true, keyVersion: true, byteSize: true },
  });
  if (!blob) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(blob.ciphertext), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(blob.byteSize),
      "Cache-Control": "private, no-store",
      "X-Cloak-Key-Version": String(blob.keyVersion),
    },
  });
}
