import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  clientIp,
  createSession,
  hashPassword,
  isSecureRequest,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/cloak/server/auth";
import {
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
 * Access model: anyone may create an identity, but the APP is gated by the
 * paywall — without a payment or an invitation the account holds no
 * membership. The invite path is the Reserve guest flow: a valid pending
 * invitation token redeems atomically at registration, so a guest goes
 * from "no account" to "full Cloak Private" in one step (origin
 * reserve_guest_pass). An invalid/expired token does NOT block account
 * creation — the account simply lands on the paywall honestly, and the
 * pass is never silently wasted.
 */

interface RegisterBody {
  handle?: string;
  password?: string;
  displayName?: string;
  inviteToken?: string;
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
  let invite: { id: string; passId: string } | null = null;
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
