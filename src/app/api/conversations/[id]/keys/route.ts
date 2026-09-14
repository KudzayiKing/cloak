import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * E2EE conversation-key surface. The server stores opaque wrapped-key
 * blobs only — it can never derive a conversation key.
 *
 * GET  -> { keyVersion, members: [{ userId, publicKey }], myWraps: [...] }
 *          Active members + their public keys (for wrapping), and every
 *          wrap addressed to ME (all versions, so history stays readable
 *          across rotations I lived through).
 * POST -> upload wraps { version, wraps: [{ userId, nonce, wrapped }],
 *          expectVersion? } — participants only; recipients must be active
 *          members. CAS: expectVersion rejects on membership races; a
 *          version above the current one rotates the conversation key.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  const conv = await db.conversation.findFirst({
    where: {
      id: conversationId,
      participations: { some: { userId: user.id, removedAt: null } },
    },
    select: { keyVersion: true, keyVersionAt: true, participations: { include: { user: true } } },
  });
  if (!conv) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  /* Who already holds a wrap for the CURRENT version (server-side boolean
     only — no key material). The client's heal pass targets exactly these
     members; without it the heal would re-wrap everyone every pass. */
  const wrapOwners = await db.conversationKeyWrap.findMany({
    where: { conversationId, version: conv.keyVersion },
    select: { userId: true },
  });
  const holders = new Set(wrapOwners.map((w) => w.userId));

  const members = conv.participations
    .filter((p) => !p.removedAt)
    .map((p) => ({
      userId: p.userId,
      publicKey: p.user.identityPublicKey,
      hasKey: holders.has(p.userId),
    }));

  const myWraps = await db.conversationKeyWrap.findMany({
    where: { conversationId, userId: user.id },
    select: {
      version: true,
      nonce: true,
      wrapped: true,
      wrappedBy: true,
      createdAt: true,
    },
    orderBy: { version: "asc" },
  });

  return NextResponse.json({
    ok: true,
    keyVersion: conv.keyVersion,
    keyVersionAt: conv.keyVersionAt.getTime(),
    members,
    /* Epoch ms (not ISO strings) — the client does numeric age math. */
    myWraps: myWraps.map((w) => ({
      version: w.version,
      nonce: w.nonce,
      wrapped: w.wrapped,
      wrappedBy: w.wrappedBy,
      createdAt: w.createdAt.getTime(),
    })),
  });
}

const wrapSchema = z.object({
  userId: z.string().min(1).max(64),
  nonce: z.string().min(1).max(64),
  wrapped: z.string().min(1).max(255),
});

const postSchema = z.object({
  version: z.number().int().min(1).max(1_000_000),
  expectVersion: z.number().int().min(0).max(1_000_000).optional(),
  wraps: z.array(wrapSchema).min(1).max(256),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  if (!(await participant(conversationId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  let parsed: z.infer<typeof postSchema>;
  try {
    parsed = postSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { keyVersion: true },
  });
  if (!conv) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  /* CAS: two clients racing to rotate (member add/remove) — the loser
     retries with the winner's version. Stale uploads are rejected. */
  if (parsed.expectVersion !== undefined && conv.keyVersion !== parsed.expectVersion) {
    return NextResponse.json(
      { ok: false, error: "version_conflict", keyVersion: conv.keyVersion },
      { status: 409 }
    );
  }
  if (parsed.version < conv.keyVersion) {
    return NextResponse.json(
      { ok: false, error: "stale_version", keyVersion: conv.keyVersion },
      { status: 409 }
    );
  }

  /* Recipients must be ACTIVE participants — never wrap for removed
     members or outsiders. */
  const active = await db.participation.findMany({
    where: { conversationId, removedAt: null },
    select: { userId: true },
  });
  const activeIds = new Set(active.map((p) => p.userId));
  const valid = parsed.wraps.filter((w) => activeIds.has(w.userId));
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "no_valid_recipients" }, { status: 400 });
  }

  await db.$transaction(
    valid.map((w) =>
      db.conversationKeyWrap.upsert({
        where: {
          conversationId_userId_version_wrappedBy: {
            conversationId,
            userId: w.userId,
            version: parsed.version,
            wrappedBy: user.id,
          },
        },
        create: {
          conversationId,
          userId: w.userId,
          version: parsed.version,
          nonce: w.nonce,
          wrapped: w.wrapped,
          wrappedBy: user.id,
        },
        update: { nonce: w.nonce, wrapped: w.wrapped },
      })
    )
  );

  let keyVersion = conv.keyVersion;
  if (parsed.version > keyVersion) {
    const updated = await db.conversation.updateMany({
      where: { id: conversationId, keyVersion },
      data: { keyVersion: parsed.version, keyVersionAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await db.conversation.findUnique({
        where: { id: conversationId },
        select: { keyVersion: true },
      });
      keyVersion = current?.keyVersion ?? parsed.version;
    } else {
      keyVersion = parsed.version;
    }
  }

  return NextResponse.json({ ok: true, keyVersion });
}

/**
 * DELETE — forward-secrecy retirement of OLD key versions. Removes every
 * wrap for the requested versions (all recipients). Only versions strictly
 * BELOW the current keyVersion are deletable — the current version's wraps
 * can never be destroyed through this endpoint.
 * Body: { versions: number[] }
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  if (!(await participant(conversationId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  let parsed: { versions?: unknown };
  try {
    parsed = (await req.json()) as { versions?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const versions = Array.isArray(parsed.versions)
    ? parsed.versions
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000)
        .slice(0, 100)
    : [];
  if (versions.length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { keyVersion: true },
  });
  if (!conv) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  /* Never allow the current (or future) version's wraps to be removed. */
  const deletable = versions.filter((v) => v < conv.keyVersion);
  if (deletable.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }
  const result = await db.conversationKeyWrap.deleteMany({
    where: { conversationId, version: { in: deletable } },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}

async function participant(conversationId: string, userId: string): Promise<boolean> {
  const p = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  return !!p && !p.removedAt;
}
