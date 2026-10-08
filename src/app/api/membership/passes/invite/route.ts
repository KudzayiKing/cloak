import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  allocationFromPasses,
  ensureGrantPasses,
  grantProgramAllowance,
  generateInviteTokenServer,
  hashInviteTokenServer,
  lazyExpireInvites,
  serializePass,
  type MembershipGrantProgram,
} from "@/lib/cloak/server/membership-server";
import type { IssueGuestPassInput } from "@/lib/cloak/membership";
import { RESERVE_GUEST_INVITE_EXPIRY_DAYS } from "@/lib/cloak/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/membership/passes/invite — issue one shared membership grant as a pending
 * invitation (pricing spec §12, §43). Only two delivery methods exist:
 * "secure_link" and "qr" — a pre-payment guest cannot have a Cloak Dagger ID, and
 * email/phone collection is not part of the flow. The raw token is returned
 * ONCE, inside the invite link / QR payload; the server keeps only the
 * SHA-256 hash (§43). Pending invites expire in 7 days (§13).
 */

interface InviteBody {
  passId?: string;
  method?: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const full = await db.user.findUnique({
    where: { id: user.id },
    select: { membershipTier: true, membershipOrigin: true },
  });
  const program: MembershipGrantProgram | null = full?.membershipTier === "reserve"
    ? "reserve"
    : full?.membershipTier === "private" && full.membershipOrigin === "founding_adviser"
      ? "founding_adviser"
      : null;
  if (!program) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: InviteBody = {};
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    body = {};
  }
  const method: IssueGuestPassInput["method"] =
    body.method === "qr" ? "qr" : "secure_link"; // secure link is the default; no other methods exist

  await lazyExpireInvites(user.id);
  await ensureGrantPasses(db, user.id, program, grantProgramAllowance(program));

  const rows = await db.guestPass.findMany({
    where: { ownerUserId: user.id, program },
    include: { invites: { where: { status: "pending" }, take: 1 } },
    orderBy: { slotIndex: "asc" },
  });
  const passes = rows.map((row) => serializePass(row));
  const allocation = allocationFromPasses(passes, rows.length);
  if (allocation.available <= 0) {
    return NextResponse.json(
      { ok: false, error: "allocation_exhausted", message: "All membership grants are used." },
      { status: 409 }
    );
  }

  const target =
    (body.passId && rows.find((r) => r.id === body.passId && r.program === program)) ||
    rows.find((r) => r.status === "available");
  if (!target || target.status !== "available" || target.invites.length > 0) {
    return NextResponse.json({ ok: false, error: "not_pending" }, { status: 409 });
  }

  const token = generateInviteTokenServer();
  if (!token) {
    return NextResponse.json({ ok: false, error: "token_unavailable" }, { status: 500 });
  }
  const tokenHash = hashInviteTokenServer(token);
  const expiresAt = new Date(Date.now() + RESERVE_GUEST_INVITE_EXPIRY_DAYS * 24 * 3600 * 1000);

  const { pass, invite } = await db.$transaction(async (txDb) => {
    const reserved = await txDb.guestPass.updateMany({
      where: { id: target.id, ownerUserId: user.id, program, status: "available" },
      data: { status: "issued", issuedAt: new Date() },
    });
    if (reserved.count !== 1) throw new Error("allocation_race");
    const invite = await txDb.guestPassInvite.create({
      data: { passId: target.id, tokenHash, method, expiresAt },
    });
    const fresh = await txDb.guestPass.findUniqueOrThrow({
      where: { id: target.id },
      include: { invites: { where: { status: "pending" }, take: 1 } },
    });
    return { pass: serializePass(fresh), invite };
  });

  const link = program === "founding_adviser"
    ? `https://cloakdagger.app/invite/trusted/${encodeURIComponent(token)}`
    : `${req.nextUrl.origin}/invite/${token}`;
  let qrDataUrl: string | null = null;
  if (method === "qr") {
    try {
      qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 512, errorCorrectionLevel: "M" });
    } catch {
      qrDataUrl = null; // the raw link stays copyable
    }
  }

  return NextResponse.json({
    ok: true,
    pass,
    invite: {
      id: invite.id,
      passId: pass.id,
      method: invite.method,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
      slotIndex: target.slotIndex,
    },
    token, // returned exactly once — never stored raw
    link,
    qrDataUrl,
  });
}
