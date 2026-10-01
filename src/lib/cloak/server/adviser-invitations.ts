import { Prisma, type PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RateLimitBuckets } from "@/lib/cloak/rate-limit";
import { appUrl, BRAND } from "@/lib/cloak/config";
import { entitlementForUser, generateInviteTokenServer, grantMembership, hashInviteTokenServer } from "@/lib/cloak/server/membership-server";
import type { SessionUser } from "@/lib/cloak/server/auth";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The client type for entry points that open their OWN transaction.
 * `Prisma.TransactionClient` deliberately omits `$transaction`, so a union of
 * the two cannot call it. Every such entry point takes an optional client so
 * the lifecycle can be exercised against an in-memory double in tests
 * (adviser invitation spec §47) instead of only being asserted by grepping
 * source text.
 */
type DbClient = PrismaClient;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_HANDLE_ENV = ["CLOAK_ADMIN_HANDLES", "CLOAQ_ADMIN_HANDLES", "ADMIN_HANDLES"];
const ADMIN_ID_ENV = ["CLOAK_ADMIN_USER_IDS", "CLOAQ_ADMIN_USER_IDS", "ADMIN_USER_IDS"];

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

/**
 * Masks the local part, keeping only its first character (spec §18:
 * `j•••••••@example.com`). The domain is left intact — it carries no
 * personal information and the recipient needs it to recognise the address.
 *
 * The bullet run is capped so a long local part cannot leak its length.
 */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (!name) return `•••@${domain}`;
  const hidden = Math.max(1, Math.min(name.length - 1, 8));
  return `${name[0]}${"•".repeat(hidden)}@${domain}`;
}

/** First name only — the greeting in the invitation email (spec §16). */
export function firstNameOf(recipientName: string): string {
  const first = recipientName.trim().split(/\s+/)[0];
  return first || recipientName.trim();
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

/*
 * Invitation throttling.
 *
 * NOT redundant with `src/proxy.ts`: the middleware only inspects write
 * methods, so the public token lookup (a GET) is covered here and nowhere
 * else. The middleware's invites policy also does not match these paths —
 * `/api/adviser-invitations/…` contains `-invitations`, not `/invitations`.
 *
 * The previous hand-rolled Map was never pruned: an entry survived until the
 * same key happened to be checked again after expiry, so the map retained one
 * row per distinct caller for the life of the process. `RateLimitBuckets`
 * sweeps, and is shared with the login limiter so there is one implementation
 * to reason about.
 */
const inviteRateLimits = new RateLimitBuckets();

const INVITE_WINDOW_MS = 5 * 60_000;
const INVITE_MAX_ATTEMPTS = 40;

export function checkInviteRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  return inviteRateLimits.take(key, INVITE_MAX_ATTEMPTS, INVITE_WINDOW_MS);
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

/**
 * The personalised adviser email (spec §16).
 *
 * Copied to the clipboard for the founder to send personally — nothing here
 * transmits. That is deliberate: the first adviser cohort should receive a
 * human email, not a campaign blast, so this is a template and not a send
 * path (spec §40). A later phase can add "Create + Send" behind the same
 * copy (spec §41).
 *
 * The URL is always built from the configured application origin, never
 * hard-coded, so the production link cannot drift to the .com domain.
 */
/**
 * "8 October 2026" — the invitation date shape used by the email and the
 * admin surfaces (spec §11, §16, §18). en-GB is deliberate: it yields
 * day-before-month, which is what the spec's examples show, and it does not
 * drift with the server's locale.
 */
export function formatInvitationDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function emailCopy(invitation: { recipientName: string; expiresAt: Date }, link: string) {
  const expiryDate = formatInvitationDate(invitation.expiresAt);
  const subject = `Private invitation to experience ${BRAND.name}`;
  const body = [
    `Hi ${firstNameOf(invitation.recipientName)},`,
    "",
    `I’m building ${BRAND.name}, a private communications platform designed for people and organizations that place a high value on confidentiality.`,
    "",
    `${BRAND.name} combines secure messaging, trusted private Circles, device-level privacy controls, and local-first intelligence designed to process sensitive context on the user’s own device rather than treating private conversations as cloud data.`,
    "",
    `I’m inviting a small group of security, family-office, legal, privacy, and executive-protection professionals to evaluate ${BRAND.name}.`,
    "",
    `I’d like to provide you with complimentary ${BRAND.cloakPrivate} access so you can use the product properly and evaluate it for yourself.`,
    "",
    `There is no obligation to recommend ${BRAND.name}.`,
    "",
    `What I’m interested in is your perspective: what would make you trust it, what would concern you, and what would prevent you from recommending it to someone whose communications genuinely matter.`,
    "",
    "Your private invitation:",
    "",
    link,
    "",
    `The invitation is intended for you and expires on ${expiryDate}.`,
    "",
    "Best,",
    "",
    "Kudzayi",
    `Founder, ${BRAND.name}`,
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

export async function listAdviserInvitations(client: Db = db): Promise<AdviserInvitationView[]> {
  await lazyExpireAdviserInvitations(client);
  const invitations = await client.adviserInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return invitations.map((invitation) => serializeInvitation(invitation));
}

export interface AdviserInvitationEventView {
  id: string;
  event: string;
  actorUserId?: string;
  detail?: string;
  createdAt: string;
}

export interface AdviserInvitationDetailView extends AdviserInvitationView {
  events: AdviserInvitationEventView[];
}

/**
 * Admin detail read (spec §14, §32, §43) — the invitation plus its audit
 * trail. `tokenHash` is never selected, so it cannot leak through this path
 * even by accident. The raw token is unrecoverable by design: only its hash
 * is stored (spec §12), which is why a redeemed or long-lived invitation
 * cannot re-display its own link.
 */
export async function getAdviserInvitation(
  id: string,
  client: Db = db
): Promise<AdviserInvitationDetailView | null> {
  await lazyExpireAdviserInvitations(client);
  const invitation = await client.adviserInvitation.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!invitation) return null;
  return {
    ...serializeInvitation(invitation),
    events: invitation.events.map((event) => ({
      id: event.id,
      event: event.event,
      actorUserId: event.actorUserId ?? undefined,
      detail: event.detail ?? undefined,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function createAdviserInvitation(input: {
  recipientName: string;
  recipientEmail: string;
  expiresAt: Date;
  emailBindingRequired: boolean;
  internalNote?: string;
  adminUserId: string;
}, client: DbClient = db): Promise<{ invitation: AdviserInvitationView; token: string; link: string; emailSubject: string; emailBody: string }> {
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
    const existing = await client.adviserInvitation.findUnique({ where: { tokenHash }, select: { id: true } });
    if (!existing) break;
  }
  if (!token || !tokenHash) throw new Error("token_unavailable");

  const invitation = await client.$transaction(async (tx) => {
    const created = await tx.adviserInvitation.create({
      data: {
        /* Type, sku and origin are written explicitly rather than inherited
           from column defaults. These three fields decide what a redemption
           grants, so a schema default silently changing would silently change
           the entitlement — the grant must be stated at the call site. */
        type: ADVISER_INVITE_TYPE,
        membershipSku: ADVISER_INVITE_MEMBERSHIP_SKU,
        membershipOrigin: ADVISER_INVITE_MEMBERSHIP_ORIGIN,
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

export async function getAdviserInvitationByToken(
  token: string,
  client: Db = db
): Promise<AdviserInvitationPublicView> {
  if (!TOKEN_PATTERN.test(token)) return { found: false };
  await lazyExpireAdviserInvitations(client);
  const invitation = await client.adviserInvitation.findUnique({
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

export async function revokeAdviserInvitation(
  id: string,
  adminUserId: string,
  client: DbClient = db
): Promise<AdviserInvitationView> {
  return client.$transaction(async (tx) => {
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

export async function extendAdviserInvitation(
  id: string,
  expiresAt: Date,
  adminUserId: string,
  client: DbClient = db
): Promise<AdviserInvitationView> {
  if (expiresAt.getTime() <= Date.now() + 60_000) throw new Error("bad_expiry");
  return client.$transaction(async (tx) => {
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

export async function redeemAdviserInvitation(
  input: {
    token: string;
    userId: string;
    email?: string;
  },
  client: DbClient = db
): Promise<{ ok: true; entitlement: ReturnType<typeof entitlementForUser> } | { ok: false; error: string }> {
  try {
    const entitlement = await client.$transaction((tx) => redeemAdviserInvitationInTransaction(tx, input));
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
    /* The account's own address wins; a brand-new account supplies the invited
       address during registration instead. Either way it has to equal the
       address the invitation was issued to — that IS the binding (spec §9,
       §25). A single comparison, deliberately: a second equivalent check would
       be dead code that makes the branch look stronger than it is. */
    const candidate = normalizeEmail(user.email) ?? providedEmail;
    if (!candidate || candidate !== invitation.recipientEmail) throw new Error("email_binding_required");
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
