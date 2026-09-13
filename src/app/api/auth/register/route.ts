import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  clientIp,
  createSession,
  hashToken,
  hashPassword,
  isSecureRequest,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/cloak/server/auth";
import {
  ensureReservePasses,
  entitlementForUser,
  grantMembership,
  hashInviteTokenServer,
  lazyExpireInvites,
} from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/auth/register — account creation (pricing spec §9, §41-§43).
 *
 * Access model: account creation is membership-gated. A new user can create
 * a Cloak ID only after a verified USDC payment claim or a valid Reserve
 * guest invitation. The wallet never becomes the identity; the setup token
 * is one-time and hash-stored.
 */

interface RegisterBody {
  handle?: string;
  password?: string;
  displayName?: string;
  inviteToken?: string;
  paymentClaimToken?: string;
  // Dagger device registry binding (dagger codex §16)
  deviceId?: string;
  deviceName?: string;
  deviceToken?: string;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let body: RegisterBody = {};
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    body = {};
  }

  /* Cloak IDs: stored without "@", lowercase, 3-24 chars of a-z/0-9/_ —
   * same normalization the login route applies when looking up. */
  const rawHandle = (body.handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  const password = body.password ?? "";
  const handleError = validateHandle(rawHandle);
  if (handleError) {
    return NextResponse.json({ ok: false, error: "bad_handle", message: handleError }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json(
      { ok: false, error: "bad_password", message: "Passphrases are 8-256 characters." },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { handle: rawHandle }, select: { id: true } });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "handle_taken", message: "That Cloak ID is already taken." },
      { status: 409 }
    );
  }

  /* Invitation (optional): validated BEFORE the account exists; a race on
   * redemption inside the transaction is reported honestly. */
  const inviteToken = (body.inviteToken ?? "").trim() || null;
  const paymentClaimToken = (body.paymentClaimToken ?? "").trim() || null;
  if (inviteToken && paymentClaimToken) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "Use one account setup method at a time." },
      { status: 400 }
    );
  }

  let invite: { id: string; passId: string } | null = null;
  let paymentClaim: { id: string; membership: string } | null = null;
  if (inviteToken) {
    await lazyExpireInvites();
    const found = await db.guestPassInvite.findUnique({
      where: { tokenHash: hashInviteTokenServer(inviteToken) },
      select: { id: true, status: true, passId: true, pass: { select: { status: true } } },
    });
    if (found && found.status === "pending" && found.pass.status === "issued") {
      invite = { id: found.id, passId: found.passId };
    }
  }
  if (paymentClaimToken) {
    const found = await db.membershipClaim.findUnique({
      where: { setupTokenHash: hashToken(paymentClaimToken) },
      select: {
        id: true,
        status: true,
        membership: true,
        setupExpiresAt: true,
        redeemedByUserId: true,
      },
    });
    if (
      found &&
      found.status === "issued" &&
      !found.redeemedByUserId &&
      found.setupExpiresAt &&
      found.setupExpiresAt.getTime() > Date.now()
    ) {
      paymentClaim = { id: found.id, membership: found.membership };
    }
  }

  if (!invite && !paymentClaim) {
    return NextResponse.json(
      {
        ok: false,
        error: paymentClaimToken ? "payment_claim_invalid" : "membership_required",
        message: paymentClaimToken
          ? "That payment setup link is invalid or expired."
          : "Create an account after payment verification or with a valid invitation.",
      },
      { status: 403 }
    );
  }

  const passwordHash = await hashPassword(password);
  const displayName = (body.displayName ?? "").trim() || rawHandle;

  try {
    const { user, membership } = await db.$transaction(async (txDb) => {
      const user = await txDb.user.create({
        data: { handle: rawHandle, displayName, passwordHash },
        select: {
          id: true,
          handle: true,
          displayName: true,
          about: true,
          membershipTier: true,
          membershipOrigin: true,
          membershipGrantedAt: true,
        },
      });
      if (invite) {
        const updated = await txDb.guestPassInvite.updateMany({
          where: { id: invite.id, status: "pending" }, // optimistic guard: one redemption wins
          data: { status: "redeemed", redeemedAt: new Date() },
        });
        if (updated.count !== 1) throw new Error("invite_race");
        await txDb.guestPass.update({
          where: { id: invite.passId },
          data: { status: "redeemed", redeemedByUserId: user.id, redeemedAt: new Date() },
        });
        await grantMembership(txDb, user.id, "private", "reserve_guest_pass");
      }
      if (paymentClaim) {
        const updated = await txDb.membershipClaim.updateMany({
          where: {
            id: paymentClaim.id,
            status: "issued",
            redeemedByUserId: null,
            setupExpiresAt: { gt: new Date() },
          },
          data: {
            status: "redeemed",
            redeemedByUserId: user.id,
            redeemedAt: new Date(),
            setupTokenHash: null,
            setupExpiresAt: null,
          },
        });
        if (updated.count !== 1) throw new Error("claim_race");
        await grantMembership(txDb, user.id, paymentClaim.membership, "direct_usdc");
        if (paymentClaim.membership === "reserve") {
          await ensureReservePasses(txDb, user.id);
        }
      }
      const fresh = await txDb.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          handle: true,
          displayName: true,
          about: true,
          membershipTier: true,
          membershipOrigin: true,
          membershipGrantedAt: true,
        },
      });
      const { about: _about, ...rest } = fresh;
      return { user: rest, membership: entitlementForUser(fresh) };
    });

    clearLoginRateLimit(ip);
    const { token } = await createSession(
      user.id,
      typeof body.deviceId === "string" && body.deviceId.length >= 8 ? body.deviceId.slice(0, 128) : undefined,
      typeof body.deviceName === "string" && body.deviceName.trim() ? body.deviceName.trim().slice(0, 64) : undefined,
      typeof body.deviceToken === "string" && body.deviceToken.length >= 16 ? body.deviceToken.slice(0, 128) : undefined
    );
    const res = NextResponse.json({ ok: true, user, membership });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(req)));
    return res;
  } catch (err) {
    if (err instanceof Error && err.message === "invite_race") {
      return NextResponse.json(
        { ok: false, error: "invite_race", message: "That invitation was just redeemed." },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === "claim_race") {
      return NextResponse.json(
        { ok: false, error: "payment_claim_invalid", message: "That payment setup link was just used." },
        { status: 409 }
      );
    }
    console.error("[auth/register] failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

function validateHandle(handle: string): string | null {
  if (handle.length < 3 || handle.length > 24) {
    return "Cloak IDs are 3-24 characters.";
  }
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return "Cloak IDs use letters, numbers, and underscores.";
  }
  return null;
}
