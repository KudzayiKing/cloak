import { Prisma, type PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appUrl, BRAND } from "@/lib/cloak/config";
import { entitlementForUser, generateInviteTokenServer, grantMembership, hashInviteTokenServer } from "@/lib/cloak/server/membership-server";
import type { SessionUser } from "@/lib/cloak/server/auth";

type Db = Prisma.TransactionClient | PrismaClient;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_HANDLE_ENV = ["CLOAQ_ADMIN_HANDLES", "CLOAK_ADMIN_HANDLES", "ADMIN_HANDLES"];
const ADMIN_ID_ENV = ["CLOAQ_ADMIN_USER_IDS", "CLOAK_ADMIN_USER_IDS", "ADMIN_USER_IDS"];

export const ADVISER_INVITE_TYPE = "founding_adviser";
export const ADVISER_INVITE_MEMBERSHIP_SKU = "private";
export const ADVISER_INVITE_MEMBERSHIP_ORIGIN = "founding_adviser";

export type AdviserInvitationStatus = "pending" | "redeemed" | "expired" | "revoked";

export interface AdviserInvitationView {
  id: string;
  type: typeof ADVISER_INVITE_TYPE;
  recipientName: string;
  recipientEmail: string;
  maskedRecipientEmail: string;
  membershipSku: typeof ADVISER_INVITE_MEMBERSHIP_SKU;
  membershipOrigin: typeof ADVISER_INVITE_MEMBERSHIP_ORIGIN;
  membershipName: string;
  emailBindingRequired: boolean;
  status: AdviserInvitationStatus;
  createdByAdminId: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedByUserId?: string;
  revokedAt?: string;
  revokedByAdminId?: string;
  internalNote?: string;
  link?: string;
  emailSubject?: string;
  emailBody?: string;
}

export interface AdviserInvitationPublicView {
  found: boolean;
  status?: AdviserInvitationStatus;
  recipientName?: string;
  maskedRecipientEmail?: string;
  membershipName?: string;
  emailBindingRequired?: boolean;
  expiresAt?: string;
}

function csvEnv(names: string[]): Set<string> {
  const values = names.flatMap((name) => (process.env[name] ?? "").split(","));
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function isAdminUser(user: Pick<SessionUser, "id" | "handle"> | null): boolean {
  if (!user) return false;
  const handles = csvEnv(ADMIN_HANDLE_ENV);
  const ids = csvEnv(ADMIN_ID_ENV);
  return ids.has(user.id.toLowerCase()) || handles.has(user.handle.toLowerCase());
}

export function normalizeEmail(input: string | undefined | null): string | null {
  const normalized = (input ?? "").trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  const visible = name.length <= 2 ? name[0] ?? "" : `${name.slice(0, 2)}...${name.slice(-1)}`;
  return `${visible || "..."}@${domain}`;
}

export function adviserNoStoreHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    ...extra,
  };
}

export function requireSameOrigin(req: NextRequest): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return allowedRequestOrigins(req).has(origin);
}

function allowedRequestOrigins(req: NextRequest): Set<string> {
  const origins = new Set([req.nextUrl.origin]);
  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) ?? req.headers.get("host");
  const proto = firstHeaderValue(req.headers.get("x-forwarded-proto")) ?? req.nextUrl.protocol.replace(/:$/, "");

  if (host) origins.add(`${proto}://${host}`);

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredAppUrl) {
    try {
      origins.add(new URL(configuredAppUrl).origin);
    } catch {
      // Invalid deployment configuration should not relax origin checks.
    }
  }

  return origins;
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

const inviteRateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkInviteRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = inviteRateLimits.get(key);
  if (!entry || entry.resetAt < now) {
    inviteRateLimits.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > 40) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function lazyExpireAdviserInvitations(tx: Db = db): Promise<void> {
  await tx.adviserInvitation.updateMany({
    where: { status: "pending", expiresAt: { lte: new Date() } },
    data: { status: "expired" },
  });
}

function effectiveStatus(invitation: { status: string; expiresAt: Date }): AdviserInvitationStatus {
  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now()) return "expired";
  if (invitation.status === "redeemed" || invitation.status === "revoked" || invitation.status === "expired") {
    return invitation.status;
  }
  return "pending";
}

function emailCopy(invitation: { recipientName: string; expiresAt: Date }, link: string) {
  const subject = `Private invitation to experience ${BRAND.name}`;
  const body = [
    `Hi ${invitation.recipientName},`,
    "",
    `I would like to personally invite you to experience ${BRAND.name} as a Founding Adviser.`,
    "",
    `${BRAND.name} is being built for private communications and private intelligence. I am inviting a small group of people whose judgment I trust to use it directly and tell me where the product should be sharper, calmer, or more useful.`,
    "",
    `Your complimentary ${BRAND.cloakPrivate} membership is already provided. There is no payment required and no renewal required.`,
    "",
    `Accept your invitation here:`,
    link,
    "",
    `This invitation expires on ${invitation.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
    "",
    "Thank you,",
    "Kudzayi",
    "",
    BRAND.baseUrl,
  ].join("\n");
  return { subject, body };
}

export function buildAdviserInvitationLink(token: string): string {
  return appUrl(`/invite/adviser/${encodeURIComponent(token)}`);
}

function serializeInvitation(invitation: {
  id: string;
  type: string;
  recipientName: string;
  recipientEmail: string;
  membershipSku: string;
  membershipOrigin: string;
  emailBindingRequired: boolean;
  status: string;
  createdByAdminId: string;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
  revokedAt: Date | null;
  revokedByAdminId: string | null;
  internalNote: string | null;
}, token?: string): AdviserInvitationView {
  const link = token ? buildAdviserInvitationLink(token) : undefined;
  const copy = link ? emailCopy(invitation, link) : undefined;
  return {
    id: invitation.id,
    type: ADVISER_INVITE_TYPE,
    recipientName: invitation.recipientName,
    recipientEmail: invitation.recipientEmail,
    maskedRecipientEmail: maskEmail(invitation.recipientEmail),
    membershipSku: ADVISER_INVITE_MEMBERSHIP_SKU,
    membershipOrigin: ADVISER_INVITE_MEMBERSHIP_ORIGIN,
    membershipName: BRAND.cloakPrivate,
    emailBindingRequired: invitation.emailBindingRequired,
    status: effectiveStatus(invitation),
    createdByAdminId: invitation.createdByAdminId,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    redeemedAt: invitation.redeemedAt?.toISOString(),
    redeemedByUserId: invitation.redeemedByUserId ?? undefined,
    revokedAt: invitation.revokedAt?.toISOString(),
    revokedByAdminId: invitation.revokedByAdminId ?? undefined,
    internalNote: invitation.internalNote ?? undefined,
    link,
    emailSubject: copy?.subject,
    emailBody: copy?.body,
  };
}

export async function listAdviserInvitations(): Promise<AdviserInvitationView[]> {
  await lazyExpireAdviserInvitations();
  const invitations = await db.adviserInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return invitations.map((invitation) => serializeInvitation(invitation));
}

export async function createAdviserInvitation(input: {
  recipientName: string;
  recipientEmail: string;
  expiresAt: Date;
  emailBindingRequired: boolean;
  internalNote?: string;
  adminUserId: string;
}): Promise<{ invitation: AdviserInvitationView; token: string; link: string; emailSubject: string; emailBody: string }> {
  const recipientName = input.recipientName.trim().slice(0, 120);
  const recipientEmail = normalizeEmail(input.recipientEmail);
  if (!recipientName) throw new Error("bad_recipient_name");
  if (!recipientEmail) throw new Error("bad_recipient_email");
  if (input.expiresAt.getTime() <= Date.now() + 60_000) throw new Error("bad_expiry");

  let token = "";
  let tokenHash = "";
  for (let i = 0; i < 4; i += 1) {
    token = generateInviteTokenServer();
    tokenHash = hashInviteTokenServer(token);
    const existing = await db.adviserInvitation.findUnique({ where: { tokenHash }, select: { id: true } });
    if (!existing) break;
  }
  if (!token || !tokenHash) throw new Error("token_unavailable");

  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.adviserInvitation.create({
      data: {
        recipientName,
        recipientEmail,
        tokenHash,
        emailBindingRequired: input.emailBindingRequired,
        expiresAt: input.expiresAt,
        createdByAdminId: input.adminUserId,
        internalNote: input.internalNote?.trim().slice(0, 1000) || null,
      },
    });
    await tx.adviserInvitationEvent.create({
      data: {
        invitationId: created.id,
        actorUserId: input.adminUserId,
        event: "created",
        detail: JSON.stringify({ expiresAt: input.expiresAt.toISOString(), emailBindingRequired: input.emailBindingRequired }),
      },
    });
    return created;
  });

  const view = serializeInvitation(invitation, token);
  return {
    invitation: view,
    token,
    link: view.link!,
    emailSubject: view.emailSubject!,
    emailBody: view.emailBody!,
  };
}

export async function getAdviserInvitationByToken(token: string): Promise<AdviserInvitationPublicView> {
  if (!TOKEN_PATTERN.test(token)) return { found: false };
  await lazyExpireAdviserInvitations();
  const invitation = await db.adviserInvitation.findUnique({
    where: { tokenHash: hashInviteTokenServer(token) },
  });
  if (!invitation) return { found: false };
  return {
    found: true,
    status: effectiveStatus(invitation),
    recipientName: invitation.recipientName,
    maskedRecipientEmail: maskEmail(invitation.recipientEmail),
    membershipName: BRAND.cloakPrivate,
    emailBindingRequired: invitation.emailBindingRequired,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function revokeAdviserInvitation(id: string, adminUserId: string): Promise<AdviserInvitationView> {
  return db.$transaction(async (tx) => {
    const invitation = await tx.adviserInvitation.findUniqueOrThrow({ where: { id } });
    if (invitation.status !== "pending") throw new Error("not_pending");
    const updated = await tx.adviserInvitation.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date(), revokedByAdminId: adminUserId },
    });
    await tx.adviserInvitationEvent.create({
      data: { invitationId: id, actorUserId: adminUserId, event: "revoked" },
    });
    return serializeInvitation(updated);
  });
}

export async function extendAdviserInvitation(id: string, expiresAt: Date, adminUserId: string): Promise<AdviserInvitationView> {
  if (expiresAt.getTime() <= Date.now() + 60_000) throw new Error("bad_expiry");
  return db.$transaction(async (tx) => {
    const invitation = await tx.adviserInvitation.findUniqueOrThrow({ where: { id } });
    if (invitation.status !== "pending") throw new Error("not_pending");
    const updated = await tx.adviserInvitation.update({
      where: { id },
      data: { expiresAt, status: "pending" },
    });
    await tx.adviserInvitationEvent.create({
      data: {
        invitationId: id,
        actorUserId: adminUserId,
        event: "extended",
        detail: JSON.stringify({ expiresAt: expiresAt.toISOString() }),
      },
    });
    return serializeInvitation(updated);
  });
}

export async function redeemAdviserInvitation(input: {
  token: string;
  userId: string;
  email?: string;
}): Promise<{ ok: true; entitlement: ReturnType<typeof entitlementForUser> } | { ok: false; error: string }> {
  try {
    const entitlement = await db.$transaction((tx) => redeemAdviserInvitationInTransaction(tx, input));
    return { ok: true, entitlement };
  } catch (err) {
    return invitationError(err);
  }
}

export async function redeemAdviserInvitationInTransaction(
  tx: Prisma.TransactionClient,
  input: { token: string; userId: string; email?: string }
): Promise<ReturnType<typeof entitlementForUser>> {
  if (!TOKEN_PATTERN.test(input.token)) throw new Error("unknown_token");
  const tokenHash = hashInviteTokenServer(input.token);
  const providedEmail = normalizeEmail(input.email);

  const invitation = await tx.adviserInvitation.findUnique({ where: { tokenHash } });
  if (!invitation) throw new Error("unknown_token");
  if (invitation.status === "redeemed" && invitation.redeemedByUserId === input.userId) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { membershipTier: true, membershipOrigin: true, membershipGrantedAt: true },
    });
    return entitlementForUser(user);
  }
  if (invitation.status === "redeemed") throw new Error("already_redeemed");
  if (invitation.status === "revoked") throw new Error("already_revoked");
  if (invitation.status === "expired" || invitation.expiresAt.getTime() <= Date.now()) {
    if (invitation.status === "pending") {
      await tx.adviserInvitation.update({ where: { id: invitation.id }, data: { status: "expired" } });
    }
    throw new Error("already_expired");
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: {
      email: true,
      emailVerifiedAt: true,
      membershipTier: true,
      membershipOrigin: true,
      membershipGrantedAt: true,
    },
  });
  const current = entitlementForUser(user);
  if (current.membership === "reserve") throw new Error("recipient_already_reserve");
  if (current.membership !== "none") throw new Error("recipient_already_private");

  if (invitation.emailBindingRequired) {
    const candidate = user.email ?? providedEmail;
    if (!candidate || candidate !== invitation.recipientEmail) throw new Error("email_binding_required");
    if (user.email && user.email !== invitation.recipientEmail) throw new Error("email_binding_required");
    if (!user.email || !user.emailVerifiedAt) {
      await tx.user.update({
        where: { id: input.userId },
        data: { email: invitation.recipientEmail, emailVerifiedAt: new Date() },
      });
    }
  } else if (!user.email && providedEmail) {
    await tx.user.update({
      where: { id: input.userId },
      data: { email: providedEmail, emailVerifiedAt: new Date() },
    });
  }

  const updated = await tx.adviserInvitation.updateMany({
    where: {
      id: invitation.id,
      status: "pending",
      redeemedByUserId: null,
      expiresAt: { gt: new Date() },
    },
    data: { status: "redeemed", redeemedAt: new Date(), redeemedByUserId: input.userId },
  });
  if (updated.count !== 1) throw new Error("already_redeemed");

  await grantMembership(tx, input.userId, ADVISER_INVITE_MEMBERSHIP_SKU, ADVISER_INVITE_MEMBERSHIP_ORIGIN);
  await tx.adviserInvitationEvent.create({
    data: { invitationId: invitation.id, actorUserId: input.userId, event: "redeemed" },
  });
  const fresh = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { membershipTier: true, membershipOrigin: true, membershipGrantedAt: true },
  });
  return entitlementForUser(fresh);
}

export function invitationError(err: unknown): { ok: false; error: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "email_already_used" };
  }
  if (err instanceof Error) return { ok: false, error: err.message };
  return { ok: false, error: "server_error" };
}
