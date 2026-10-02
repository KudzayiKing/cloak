import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  ATTACHMENT_ID_RE,
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  purgeExpiredAttachments,
} from "@/lib/cloak/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Store ONE encrypted attachment payload.
 *
 * The body is raw ciphertext bytes — the client has already sealed the blob
 * under the conversation key (see `encryptBlob`), so this route never sees a
 * plaintext byte and has no key material of any kind. `ciphertext` is the only
 * column that holds payload.
 *
 * The ID is CLIENT-MINTED and sent as `x-cloak-attachment-id`, because the
 * client needs it *before* encrypting: the AAD binds the attachment id, so the
 * id has to exist before the ciphertext does. The id is therefore a primary key
 * the caller controls — which is safe only because we `create` (never upsert)
 * and reject a collision, so a guessed id cannot overwrite somebody's blob.
 *
 * `x-cloak-key-version` records which conversation key version sealed it, so a
 * recipient can pick the right root out of its own keyring.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;

  /* Membership is the authorization: you may only attach to a conversation you
     are still an active participant of. Same predicate the message routes use. */
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      participations: { some: { userId: user.id, removedAt: null } },
    },
    select: { id: true, ghostSeconds: true },
  });
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const attachmentId = req.headers.get("x-cloak-attachment-id") ?? "";
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return NextResponse.json({ ok: false, error: "bad_attachment_id" }, { status: 400 });
  }

  /* Cheap pre-check on the declared length, so an oversized body is refused
     before we buffer it. The real check is on the bytes we actually read. */
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "empty_attachment" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  const versionHeader = Number(req.headers.get("x-cloak-key-version") ?? "");
  const keyVersion = Number.isFinite(versionHeader) ? Math.max(0, Math.trunc(versionHeader)) : 0;

  /* Ghost conversations must not leave their media behind: the blob expires
     with the message rather than outliving it by the default TTL. */
  const expiresAt = conversation.ghostSeconds
    ? new Date(Date.now() + conversation.ghostSeconds * 1000)
    : new Date(Date.now() + ATTACHMENT_TTL_MS);

  await purgeExpiredAttachments();

  try {
    const created = await db.attachmentBlob.create({
      data: {
        id: attachmentId,
        conversationId,
        authorId: user.id,
        ciphertext: Buffer.from(bytes),
        byteSize: bytes.byteLength,
        keyVersion,
        expiresAt,
      },
      select: { id: true, byteSize: true, createdAt: true },
    });
    return NextResponse.json({
      ok: true,
      id: created.id,
      byteSize: created.byteSize,
      storedAt: created.createdAt.getTime(),
    });
  } catch (error) {
    /* P2002 = that id already exists. We never upsert, so a collision (or a
       caller trying to guess an id) is a conflict, not an overwrite. */
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ ok: false, error: "duplicate_attachment" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });
  }
}
