import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * E2EE identity key directory + encrypted backup vault. The server is an
 * UNTRUSTED directory: it stores the public key so co-members can wrap
 * conversation keys for this user, and an opaque passphrase-wrapped backup
 * of the private key so a NEW device can restore the identity. It can never
 * unwrap the backup or derive any conversation key.
 *
 * GET  -> { publicKey, backup }   (nulls when not provisioned yet)
 * PUT  -> provision/replace { publicKey, backup } (both required)
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { identityPublicKey: true, identityKeyBackup: true },
  });
  return NextResponse.json({
    ok: true,
    publicKey: row?.identityPublicKey ?? null,
    backup: row?.identityKeyBackup ?? null,
  });
}

const putSchema = z.object({
  publicKey: z.string().min(1).max(255),
  backup: z.string().min(1).max(4096),
});

export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let parsed: z.infer<typeof putSchema>;
  try {
    parsed = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  await db.user.update({
    where: { id: user.id },
    data: {
      identityPublicKey: parsed.publicKey,
      identityKeyBackup: parsed.backup,
    },
  });
  return NextResponse.json({ ok: true });
}
