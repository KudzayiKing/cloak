/*
 * Founding Adviser invitation tests (adviser invitation spec §47).
 *
 * Run: npm test
 *
 * These are BEHAVIOURAL: the real service functions are driven against an
 * in-memory double of the Prisma client, so the redemption state machine,
 * the admin controls and the token handling are actually executed rather
 * than asserted by grepping source text. A handful of source-level checks
 * remain at the end for things that are genuinely static (route wiring,
 * redirect configuration) — those are labelled as such.
 *
 * No database is contacted. Nothing here touches the owner's data.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/* Dev activation would hand a membership to ANY user and mask the real
   entitlement logic, so it is forced off before the module is imported. */
process.env.CLOAK_ALLOW_DEV_ACTIVATION = "0";

import { APP_URL, BRAND, appUrl } from "../src/lib/cloak/config";
import {
  ADVISER_INVITE_MEMBERSHIP_ORIGIN,
  ADVISER_INVITE_MEMBERSHIP_SKU,
  ADVISER_INVITE_TYPE,
  buildAdviserInvitationLink,
  checkInviteRateLimit,
  createAdviserInvitation,
  emailCopy,
  extendAdviserInvitation,
  firstNameOf,
  getAdviserInvitationByToken,
  invitationError,
  isAdminUser,
  maskEmail,
  normalizeEmail,
  redeemAdviserInvitation,
  redeemAdviserInvitationInTransaction,
  revokeAdviserInvitation,
} from "../src/lib/cloak/server/adviser-invitations";
import {
  generateInviteTokenServer,
  hashInviteTokenServer,
  FOUNDING_ADVISER_TRUSTED_INVITES,
  ensureReservePasses,
} from "../src/lib/cloak/server/membership-server";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  assert.deepEqual(actual, expected, `FAILED: ${label}`);
}

/* ==================================================================
 * In-memory Prisma double
 * ================================================================== */

interface InviteRow {
  id: string;
  type: string;
  recipientName: string;
  recipientEmail: string;
  membershipSku: string;
  membershipOrigin: string;
  tokenHash: string;
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
}

interface EventRow {
  id: string;
  invitationId: string;
  actorUserId: string | null;
  event: string;
  detail: string | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  handle: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  membershipTier: string | null;
  membershipOrigin: string | null;
  membershipGrantedAt: Date | null;
}

/** Minimal `where` matcher: equality, null, {gt}, {lte}, {in}. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition && typeof condition === "object") {
      const ops = condition as { gt?: Date; gte?: Date; lt?: Date; lte?: Date; in?: unknown[] };
      if (ops.gt !== undefined && !(value instanceof Date && value.getTime() > ops.gt.getTime())) return false;
      if (ops.gte !== undefined && !(value instanceof Date && value.getTime() >= ops.gte.getTime())) return false;
      if (ops.lt !== undefined && !(value instanceof Date && value.getTime() < ops.lt.getTime())) return false;
      if (ops.lte !== undefined && !(value instanceof Date && value.getTime() <= ops.lte.getTime())) return false;
      if (ops.in !== undefined && !ops.in.includes(value)) return false;
      return true;
    }
    return value === condition;
  });
}

class FakeDb {
  invitations: InviteRow[] = [];
  events: EventRow[] = [];
  users: UserRow[] = [];
  guestPasses: { id: string; ownerUserId: string; program: string; slotIndex: number; status: string }[] = [];
  private seq = 0;

  /**
   * When set, the guarded `updateMany` reports zero rows affected while the
   * stored row still reads as `pending`. That is exactly the interleaving a
   * concurrent redemption produces: both transactions read pending, only one
   * wins the conditional write. It lets the race be tested deterministically
   * without real concurrency.
   */
  forceGuardMiss = false;

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  get guestPass() {
    const self = this;
    return {
      async count({ where }: { where: Record<string, unknown> }) {
        return self.guestPasses.filter((row) => matches(row, where)).length;
      },
      async createMany({ data }: { data: Record<string, unknown>[] }) {
        for (const entry of data) {
          self.guestPasses.push({
            id: self.nextId("pass"),
            ownerUserId: String(entry.ownerUserId),
            program: String(entry.program),
            slotIndex: Number(entry.slotIndex),
            status: "available",
          });
        }
        return { count: data.length };
      },
    };
  }

  get adviserInvitation() {
    const self = this;
    return {
      async create({ data }: { data: Record<string, unknown> }) {
        const row: InviteRow = {
          id: self.nextId("inv"),
          type: String(data.type ?? "founding_adviser"),
          recipientName: String(data.recipientName),
          recipientEmail: String(data.recipientEmail),
          membershipSku: String(data.membershipSku ?? "private"),
          membershipOrigin: String(data.membershipOrigin ?? "founding_adviser"),
          tokenHash: String(data.tokenHash),
          emailBindingRequired: Boolean(data.emailBindingRequired),
          status: "pending",
          createdByAdminId: String(data.createdByAdminId),
          createdAt: new Date(),
          expiresAt: data.expiresAt as Date,
          redeemedAt: null,
          redeemedByUserId: null,
          revokedAt: null,
          revokedByAdminId: null,
          internalNote: (data.internalNote as string | null) ?? null,
        };
        self.invitations.push(row);
        return { ...row };
      },
      async findUnique({ where, include }: { where: Record<string, unknown>; include?: unknown }) {
        const row = self.invitations.find((item) => matches(item as unknown as Record<string, unknown>, where));
        if (!row) return null;
        if (include) {
          return {
            ...row,
            events: self.events.filter((event) => event.invitationId === row.id),
          };
        }
        return { ...row };
      },
      async findUniqueOrThrow({ where }: { where: Record<string, unknown> }) {
        const row = self.invitations.find((item) => matches(item as unknown as Record<string, unknown>, where));
        if (!row) throw new Error("not_found");
        return { ...row };
      },
      async findMany({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc" }; take?: number } = {}) {
        const rows = [...self.invitations];
        if (orderBy?.createdAt === "desc") rows.reverse();
        return rows.map((row) => ({ ...row }));
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = self.invitations.find((item) => item.id === where.id);
        if (!row) throw new Error("not_found");
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        const rows = self.invitations.filter((item) =>
          matches(item as unknown as Record<string, unknown>, where)
        );
        if (self.forceGuardMiss) return { count: 0 };
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    };
  }

  get adviserInvitationEvent() {
    const self = this;
    return {
      async create({ data }: { data: Record<string, unknown> }) {
        const row: EventRow = {
          id: self.nextId("evt"),
          invitationId: String(data.invitationId),
          actorUserId: (data.actorUserId as string | null) ?? null,
          event: String(data.event),
          detail: (data.detail as string | null) ?? null,
          createdAt: new Date(),
        };
        self.events.push(row);
        return { ...row };
      },
    };
  }

  get user() {
    const self = this;
    return {
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const row = self.users.find((item) => item.id === where.id);
        if (!row) throw new Error("not_found");
        return { ...row };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = self.users.find((item) => item.id === where.id);
        if (!row) throw new Error("not_found");
        Object.assign(row, data);
        return { ...row };
      },
    };
  }

  async $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const asClient = (fake: FakeDb) => fake as any;

function seedUser(fake: FakeDb, overrides: Partial<UserRow> & { id: string }): UserRow {
  const user: UserRow = {
    handle: overrides.id,
    email: null,
    emailVerifiedAt: null,
    membershipTier: null,
    membershipOrigin: null,
    membershipGrantedAt: null,
    ...overrides,
  };
  fake.users.push(user);
  return user;
}

const futureDate = (days = 7) => new Date(Date.now() + days * 24 * 3600 * 1000);

/** Creates an invitation through the real service and returns its raw token. */
async function seedInvitation(
  fake: FakeDb,
  overrides: Partial<{ recipientName: string; recipientEmail: string; expiresAt: Date; emailBindingRequired: boolean; internalNote: string }> = {}
) {
  const created = await createAdviserInvitation(
    {
      recipientName: overrides.recipientName ?? "Jennifer Beckage",
      recipientEmail: overrides.recipientEmail ?? "jennifer@example.com",
      expiresAt: overrides.expiresAt ?? futureDate(),
      emailBindingRequired: overrides.emailBindingRequired ?? true,
      internalNote: overrides.internalNote,
      adminUserId: "admin_1",
    },
    asClient(fake)
  );
  return created;
}

/* ==================================================================
 * §1, §44, §45 — brand and canonical domain
 * ================================================================== */

check("brand name", BRAND.name, "Cloak Dagger");
check("brand uppercase", BRAND.uppercaseName, "CLOAK DAGGER");
check("canonical base url", APP_URL, "https://cloakdagger.app");
check(
  "invitation links are built on the canonical origin",
  buildAdviserInvitationLink("abc123"),
  "https://cloakdagger.app/invite/adviser/abc123"
);
check("appUrl keeps the canonical origin", appUrl("/settings/membership"), "https://cloakdagger.app/settings/membership");

const nextConfigSrc = read("next.config.ts");
check(
  "cloakdagger.com is redirected, permanently, preserving the path",
  /DEFENSIVE_HOSTS[\s\S]*statusCode: 301/.test(nextConfigSrc) &&
    /"cloakdagger\.com"/.test(nextConfigSrc) &&
    /destination: `https:\/\/\$\{CANONICAL_HOST\}\/:path\*`/.test(nextConfigSrc),
  true
);

/* ==================================================================
 * §12 — token generation and hashing
 * ================================================================== */

const tokenA = generateInviteTokenServer();
const tokenB = generateInviteTokenServer();
check("tokens are URL-safe base64url", /^[A-Za-z0-9_-]+$/.test(tokenA), true);
check("tokens carry 256 bits (43 base64url chars)", tokenA.length, 43);
check("tokens are not sequential", tokenA === tokenB, false);
check(
  "the stored hash is SHA-256 of the token, not the token",
  hashInviteTokenServer(tokenA),
  createHash("sha256").update(tokenA).digest("hex")
);
check("the raw token is never equal to its hash", hashInviteTokenServer(tokenA) === tokenA, false);

/* ==================================================================
 * §6, §7, §13, §15 — creation
 * ================================================================== */

const createFake = new FakeDb();
const createdInvite = await seedInvitation(createFake, { internalNote: "Family office security adviser — Priority A" });
const storedInvite = createFake.invitations[0]!;

check("creation stores the type", storedInvite.type, ADVISER_INVITE_TYPE);
check("creation grants Private", storedInvite.membershipSku, ADVISER_INVITE_MEMBERSHIP_SKU);
check("creation records the founding_adviser origin", storedInvite.membershipOrigin, ADVISER_INVITE_MEMBERSHIP_ORIGIN);
check("creation stores the binding policy", storedInvite.emailBindingRequired, true);
check("creation stores the admin-only note", storedInvite.internalNote, "Family office security adviser — Priority A");
check("creation starts pending", storedInvite.status, "pending");
check(
  "ONLY the hash is persisted — the raw token is absent from the row",
  Object.values(storedInvite).includes(createdInvite.token),
  false
);
check(
  "the returned token is the one the stored hash belongs to",
  storedInvite.tokenHash,
  hashInviteTokenServer(createdInvite.token)
);
check("creation returns the link exactly once", createdInvite.link, buildAdviserInvitationLink(createdInvite.token));
check("creation records a 'created' event", createFake.events.map((e) => e.event), ["created"]);

const listed = await (await import("../src/lib/cloak/server/adviser-invitations")).listAdviserInvitations(
  asClient(createFake)
);
check("a listed invitation cannot re-display its link", listed[0]!.link, undefined);
check("a listed invitation never exposes its token hash", "tokenHash" in (listed[0] as object), false);

/* Expiry: stored as given, and a past expiry is refused. */
const expiryFake = new FakeDb();
const explicitExpiry = futureDate(14);
await seedInvitation(expiryFake, { expiresAt: explicitExpiry });
check("creation stores the chosen expiry", expiryFake.invitations[0]!.expiresAt.getTime(), explicitExpiry.getTime());

await assert.rejects(
  () => seedInvitation(new FakeDb(), { expiresAt: new Date(Date.now() - 1000) }),
  /bad_expiry/,
  "FAILED: an already-past expiry must be refused"
);
checks += 1;

await assert.rejects(
  () => seedInvitation(new FakeDb(), { recipientName: "   " }),
  /bad_recipient_name/,
  "FAILED: a blank recipient name must be refused"
);
checks += 1;

await assert.rejects(
  () => seedInvitation(new FakeDb(), { recipientEmail: "not-an-email" }),
  /bad_recipient_email/,
  "FAILED: a malformed recipient email must be refused"
);
checks += 1;

/* Binding mode is honoured in both directions (§9). */
const openFake = new FakeDb();
await seedInvitation(openFake, { emailBindingRequired: false });
check("the 'any holder may redeem' mode is stored", openFake.invitations[0]!.emailBindingRequired, false);

/* Email normalization is case-insensitive and trimmed (§6). */
check("emails normalize to lowercase and trim", normalizeEmail("  Jennifer@Example.COM "), "jennifer@example.com");
check("a blank email normalizes to null", normalizeEmail("   "), null);

/* ==================================================================
 * §18 — recipient masking
 * ================================================================== */

check("the spec's masking example is reproduced exactly", maskEmail("jennifer@example.com"), "j•••••••@example.com");
check("a one-character local part still masks", maskEmail("j@example.com"), "j•@example.com");
check(
  "a long local part does not leak its length",
  maskEmail("averyveryverylongname@example.com"),
  "a••••••••@example.com"
);
check("the greeting uses the first name only", firstNameOf("Jennifer Beckage"), "Jennifer");
check("a single-word recipient name is used whole", firstNameOf("Kudzayi"), "Kudzayi");

/* ==================================================================
 * §16 — the personalised email
 * ================================================================== */

const email = emailCopy({ recipientName: "Jennifer Beckage", expiresAt: new Date("2026-10-08T00:00:00Z") }, buildAdviserInvitationLink("TOK"));
check("email subject", email.subject, "Private invitation to experience Cloak Dagger");
check("email greets by first name", email.body.startsWith("Hi Jennifer,"), true);
check("email carries the invitation link", email.body.includes("https://cloakdagger.app/invite/adviser/TOK"), true);
check("email carries the expiry date", email.body.includes("expires on 8 October 2026"), true);
check("email is signed by the founder", email.body.includes("Kudzayi\nFounder, Cloak Dagger"), true);
check("email signature carries the canonical domain", email.body.includes("https://cloakdagger.app"), true);
check("email never references the defensive .com domain", email.body.includes("cloakdagger.com"), false);

/* ==================================================================
 * §23 — validation, and enumeration resistance
 * ================================================================== */

const lookupFake = new FakeDb();
const lookupInvite = await seedInvitation(lookupFake);

const validView = await getAdviserInvitationByToken(lookupInvite.token, asClient(lookupFake));
check("a valid token resolves", validView.found, true);
check("a valid token reads pending", validView.status, "pending");
check("the public view names the recipient", validView.recipientName, "Jennifer Beckage");
check("the public view masks the email", validView.maskedRecipientEmail, "j•••••••@example.com");
check("the public view names the membership", validView.membershipName, BRAND.cloakPrivate);
check("the public view never carries the internal note", "internalNote" in validView, false);
check("the public view never carries the admin id", "createdByAdminId" in validView, false);
check("the public view never carries the token hash", "tokenHash" in validView, false);

const unknownView = await getAdviserInvitationByToken(generateInviteTokenServer(), asClient(lookupFake));
const malformedView = await getAdviserInvitationByToken("nope", asClient(lookupFake));
check("an unknown token is not found", unknownView.found, false);
check("a malformed token is not found", malformedView.found, false);
check(
  "unknown and malformed are indistinguishable (no enumeration oracle)",
  JSON.stringify(unknownView),
  JSON.stringify(malformedView)
);

/* Expiry is reflected without a write, then materialised lazily. */
const expiredFake = new FakeDb();
const expiredInvite = await seedInvitation(expiredFake, { expiresAt: futureDate(1) });
expiredFake.invitations[0]!.expiresAt = new Date(Date.now() - 60_000);
check(
  "a lapsed invitation reads expired",
  (await getAdviserInvitationByToken(expiredInvite.token, asClient(expiredFake))).status,
  "expired"
);

const revokedFake = new FakeDb();
const revokedInvite = await seedInvitation(revokedFake);
await revokeAdviserInvitation(revokedFake.invitations[0]!.id, "admin_1", asClient(revokedFake));
check(
  "a revoked invitation reads revoked",
  (await getAdviserInvitationByToken(revokedInvite.token, asClient(revokedFake))).status,
  "revoked"
);

/* ==================================================================
 * §25-§29 — redemption
 * ================================================================== */

const redeemFake = new FakeDb();
const redeemInvite = await seedInvitation(redeemFake);
seedUser(redeemFake, { id: "adviser_1", email: "jennifer@example.com", emailVerifiedAt: new Date() });

const redeemed = await redeemAdviserInvitation(
  { token: redeemInvite.token, userId: "adviser_1", email: "jennifer@example.com" },
  asClient(redeemFake)
);
check("a valid redemption succeeds", redeemed.ok, true);
check("redemption grants Private", redeemFake.users[0]!.membershipTier, "private");
check("redemption records the founding_adviser origin", redeemFake.users[0]!.membershipOrigin, "founding_adviser");
check("adviser redemption provisions exactly three Trusted Invites", redeemFake.guestPasses.length, FOUNDING_ADVISER_TRUSTED_INVITES);
check("all adviser grant slots use the adviser program", redeemFake.guestPasses.every((pass) => pass.program === "founding_adviser"), true);
check("Founding Adviser slots start available", redeemFake.guestPasses.every((pass) => pass.status === "available"), true);
await ensureReservePasses(asClient(redeemFake), "reserve_1");
check("Reserve still provisions ten grant slots", redeemFake.guestPasses.filter((pass) => pass.ownerUserId === "reserve_1" && pass.program === "reserve").length, 10);
check("redemption marks the invitation redeemed", redeemFake.invitations[0]!.status, "redeemed");
check("redemption records who redeemed it", redeemFake.invitations[0]!.redeemedByUserId, "adviser_1");
check("redemption records when", redeemFake.invitations[0]!.redeemedAt instanceof Date, true);
check("redemption records a 'redeemed' event", redeemFake.events.map((e) => e.event), ["created", "redeemed"]);
check(
  "the returned entitlement reports the founding_adviser origin",
  redeemed.ok ? redeemed.entitlement.origin : null,
  "founding_adviser"
);
check("the granted membership is never renewed", redeemed.ok ? redeemed.entitlement.renewal : null, "never");

/* Re-redeeming by the same account is idempotent, not a second grant (§27). */
const grantedAt = redeemFake.users[0]!.membershipGrantedAt;
const again = await redeemAdviserInvitation(
  { token: redeemInvite.token, userId: "adviser_1", email: "jennifer@example.com" },
  asClient(redeemFake)
);
check("re-redeeming by the same account is idempotent", again.ok, true);
check("re-redeeming does not re-grant (timestamp unchanged)", redeemFake.users[0]!.membershipGrantedAt, grantedAt);
check("re-redeeming adds no second redeemed event", redeemFake.events.filter((e) => e.event === "redeemed").length, 1);

/* A different account cannot take an already-redeemed invitation. */
seedUser(redeemFake, { id: "adviser_2", email: "jennifer@example.com", emailVerifiedAt: new Date() });
const stolen = await redeemAdviserInvitation(
  { token: redeemInvite.token, userId: "adviser_2", email: "jennifer@example.com" },
  asClient(redeemFake)
);
check("another account cannot redeem a used invitation", stolen.ok ? null : stolen.error, "already_redeemed");

/* The conditional write is what makes the grant single (§27). */
const raceFake = new FakeDb();
const raceInvite = await seedInvitation(raceFake);
seedUser(raceFake, { id: "adviser_3", email: "jennifer@example.com", emailVerifiedAt: new Date() });
raceFake.forceGuardMiss = true;
const raceResult = await redeemAdviserInvitation(
  { token: raceInvite.token, userId: "adviser_3", email: "jennifer@example.com" },
  asClient(raceFake)
);
check("losing the guarded write fails the redemption", raceResult.ok ? null : raceResult.error, "already_redeemed");
check("losing the guarded write grants NO membership", raceFake.users[0]!.membershipTier, null);
check("losing the guarded write leaves the invitation pending", raceFake.invitations[0]!.status, "pending");

/* Terminal states are refused (§20-§22). */
const terminalCases: { label: string; setup: (fake: FakeDb) => Promise<string>; expected: string }[] = [
  {
    label: "an expired invitation cannot be redeemed",
    setup: async (fake) => {
      const invite = await seedInvitation(fake, { expiresAt: futureDate(1) });
      fake.invitations[0]!.expiresAt = new Date(Date.now() - 60_000);
      return invite.token;
    },
    expected: "already_expired",
  },
  {
    label: "a revoked invitation cannot be redeemed",
    setup: async (fake) => {
      const invite = await seedInvitation(fake);
      await revokeAdviserInvitation(fake.invitations[0]!.id, "admin_1", asClient(fake));
      return invite.token;
    },
    expected: "already_revoked",
  },
];

for (const scenario of terminalCases) {
  const fake = new FakeDb();
  seedUser(fake, { id: "adviser_x", email: "jennifer@example.com", emailVerifiedAt: new Date() });
  const token = await scenario.setup(fake);
  const result = await redeemAdviserInvitation(
    { token, userId: "adviser_x", email: "jennifer@example.com" },
    asClient(fake)
  );
  check(scenario.label, result.ok ? null : result.error, scenario.expected);
  check(`  ... and no membership is granted`, fake.users[0]!.membershipTier, null);
}

/* An unknown token is refused without revealing that it is unknown. */
const unknownRedeemFake = new FakeDb();
seedUser(unknownRedeemFake, { id: "adviser_y" });
const unknownRedeem = await redeemAdviserInvitation(
  { token: generateInviteTokenServer(), userId: "adviser_y" },
  asClient(unknownRedeemFake)
);
check("an unknown token cannot be redeemed", unknownRedeem.ok ? null : unknownRedeem.error, "unknown_token");

/* Email binding (§9, §25). */
const bindFake = new FakeDb();
const bindInvite = await seedInvitation(bindFake, { recipientEmail: "jennifer@example.com" });
seedUser(bindFake, { id: "adviser_wrong", email: "someone.else@example.com", emailVerifiedAt: new Date() });
const wrongEmail = await redeemAdviserInvitation(
  { token: bindInvite.token, userId: "adviser_wrong", email: "someone.else@example.com" },
  asClient(bindFake)
);
check("a different verified email is refused", wrongEmail.ok ? null : wrongEmail.error, "email_binding_required");
check("  ... and no membership is granted", bindFake.users[0]!.membershipTier, null);
check("  ... and the invitation stays pending", bindFake.invitations[0]!.status, "pending");

/* A brand-new account has no address on the row yet, so the supplied one is
   the only thing to compare against. Both outcomes are covered here because
   the two branches are what a single-check binding actually rests on. */
const newAcctWrongFake = new FakeDb();
const newAcctWrongInvite = await seedInvitation(newAcctWrongFake, { recipientEmail: "jennifer@example.com" });
seedUser(newAcctWrongFake, { id: "fresh_wrong" });
const freshWrong = await redeemAdviserInvitation(
  { token: newAcctWrongInvite.token, userId: "fresh_wrong", email: "someone.else@example.com" },
  asClient(newAcctWrongFake)
);
check("a new account supplying the wrong email is refused", freshWrong.ok ? null : freshWrong.error, "email_binding_required");
check("  ... and no membership is granted", newAcctWrongFake.users[0]!.membershipTier, null);

const newAcctRightFake = new FakeDb();
const newAcctRightInvite = await seedInvitation(newAcctRightFake, { recipientEmail: "jennifer@example.com" });
seedUser(newAcctRightFake, { id: "fresh_right" });
const freshRight = await redeemAdviserInvitation(
  { token: newAcctRightInvite.token, userId: "fresh_right", email: "Jennifer@Example.com" },
  asClient(newAcctRightFake)
);
check("a new account supplying the invited email succeeds", freshRight.ok, true);
check("  ... and the invited address is recorded on the account", newAcctRightFake.users[0]!.email, "jennifer@example.com");
check("  ... and it is recorded as verified", newAcctRightFake.users[0]!.emailVerifiedAt instanceof Date, true);

/* Addresses are compared after normalization, so an account whose stored
   address differs only in case is the same recipient (spec §6: email matching
   must not be case-sensitive). */
const caseFake = new FakeDb();
const caseInvite = await seedInvitation(caseFake, { recipientEmail: "jennifer@example.com" });
seedUser(caseFake, { id: "case_user", email: "Jennifer@Example.COM", emailVerifiedAt: new Date() });
const caseResult = await redeemAdviserInvitation(
  { token: caseInvite.token, userId: "case_user", email: "jennifer@example.com" },
  asClient(caseFake)
);
check("an address differing only in case is the same recipient", caseResult.ok, true);
check("  ... and the membership is granted", caseFake.users[0]!.membershipTier, "private");

/* With binding OFF, a holder may redeem (§9). */
const openBindFake = new FakeDb();
const openBindInvite = await seedInvitation(openBindFake, { emailBindingRequired: false });
seedUser(openBindFake, { id: "adviser_open" });
const openRedeem = await redeemAdviserInvitation(
  { token: openBindInvite.token, userId: "adviser_open" },
  asClient(openBindFake)
);
check("with binding off, any holder may redeem", openRedeem.ok, true);

/* An existing Private member is not duplicated (§28). */
const privateFake = new FakeDb();
const privateInvite = await seedInvitation(privateFake);
seedUser(privateFake, {
  id: "already_private",
  email: "jennifer@example.com",
  emailVerifiedAt: new Date(),
  membershipTier: "private",
  membershipOrigin: "direct_usdc",
  membershipGrantedAt: new Date(),
});
const privateResult = await redeemAdviserInvitation(
  { token: privateInvite.token, userId: "already_private", email: "jennifer@example.com" },
  asClient(privateFake)
);
check("an existing Private member is refused", privateResult.ok ? null : privateResult.error, "recipient_already_private");
check("  ... their origin is untouched", privateFake.users[0]!.membershipOrigin, "direct_usdc");
check("  ... and the invitation is not consumed", privateFake.invitations[0]!.status, "pending");

/* A Reserve member is never downgraded (§28). */
const reserveFake = new FakeDb();
const reserveInvite = await seedInvitation(reserveFake);
seedUser(reserveFake, {
  id: "already_reserve",
  email: "jennifer@example.com",
  emailVerifiedAt: new Date(),
  membershipTier: "reserve",
  membershipOrigin: "direct_usdc",
  membershipGrantedAt: new Date(),
});
const reserveResult = await redeemAdviserInvitation(
  { token: reserveInvite.token, userId: "already_reserve", email: "jennifer@example.com" },
  asClient(reserveFake)
);
check("a Reserve member is refused", reserveResult.ok ? null : reserveResult.error, "recipient_already_reserve");
check("  ... and is NEVER downgraded to Private", reserveFake.users[0]!.membershipTier, "reserve");
check("  ... and the invitation is not consumed", reserveFake.invitations[0]!.status, "pending");

/* ==================================================================
 * §32-§35 — admin controls
 * ================================================================== */

const controlFake = new FakeDb();
const controlInvite = await seedInvitation(controlFake);
const controlId = controlFake.invitations[0]!.id;

const newExpiry = futureDate(21);
const extended = await extendAdviserInvitation(controlId, newExpiry, "admin_1", asClient(controlFake));
check("a pending invitation can be extended", extended.expiresAt, newExpiry.toISOString());
check("  ... and the extension is recorded", controlFake.events.map((e) => e.event), ["created", "extended"]);

await assert.rejects(
  () => extendAdviserInvitation(controlId, new Date(Date.now() - 1000), "admin_1", asClient(controlFake)),
  /bad_expiry/,
  "FAILED: extending into the past must be refused"
);
checks += 1;

const revokedView = await revokeAdviserInvitation(controlId, "admin_1", asClient(controlFake));
check("a pending invitation can be revoked", revokedView.status, "revoked");
check("  ... and the revocation is recorded", controlFake.events.map((e) => e.event), ["created", "extended", "revoked"]);
check(
  "  ... and the token immediately stops validating",
  (await getAdviserInvitationByToken(controlInvite.token, asClient(controlFake))).status,
  "revoked"
);

const revokedRedeemFake = new FakeDb();
seedUser(revokedRedeemFake, { id: "adviser_z", email: "jennifer@example.com", emailVerifiedAt: new Date() });
revokedRedeemFake.invitations.push({ ...controlFake.invitations[0]! });
const revokedRedeem = await redeemAdviserInvitation(
  { token: controlInvite.token, userId: "adviser_z", email: "jennifer@example.com" },
  asClient(revokedRedeemFake)
);
check("  ... and a revoked token cannot be redeemed", revokedRedeem.ok ? null : revokedRedeem.error, "already_revoked");

await assert.rejects(
  () => revokeAdviserInvitation(controlId, "admin_1", asClient(controlFake)),
  /not_pending/,
  "FAILED: a revoked invitation must not be revocable twice"
);
checks += 1;

/* A redeemed invitation cannot be recycled, and revocation cannot undo it (§35). */
const recycleFake = new FakeDb();
const recycleInvite = await seedInvitation(recycleFake);
seedUser(recycleFake, { id: "adviser_r", email: "jennifer@example.com", emailVerifiedAt: new Date() });
await redeemAdviserInvitation(
  { token: recycleInvite.token, userId: "adviser_r", email: "jennifer@example.com" },
  asClient(recycleFake)
);
await assert.rejects(
  () => revokeAdviserInvitation(recycleFake.invitations[0]!.id, "admin_1", asClient(recycleFake)),
  /not_pending/,
  "FAILED: a redeemed invitation must not be recyclable"
);
checks += 1;
await assert.rejects(
  () => extendAdviserInvitation(recycleFake.invitations[0]!.id, futureDate(30), "admin_1", asClient(recycleFake)),
  /not_pending/,
  "FAILED: a redeemed invitation must not be extendable"
);
checks += 1;
check(
  "the membership granted by a redeemed invitation survives (it is independent)",
  recycleFake.users[0]!.membershipTier,
  "private"
);

/* ==================================================================
 * §4, §37, §47 — admin authorization
 * ================================================================== */

const originalEnv = { ...process.env };
function withAdminEnv(env: Record<string, string | undefined>, fn: () => void) {
  delete process.env.CLOAK_ADMIN_HANDLES;
  delete process.env.CLOAQ_ADMIN_HANDLES;
  delete process.env.ADMIN_HANDLES;
  delete process.env.CLOAK_ADMIN_USER_IDS;
  delete process.env.CLOAQ_ADMIN_USER_IDS;
  delete process.env.ADMIN_USER_IDS;
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    fn();
  } finally {
    process.env = { ...originalEnv };
  }
}

check("an anonymous visitor is not an admin", isAdminUser(null), false);

withAdminEnv({}, () => {
  check("with no admin configuration, nobody is an admin", isAdminUser({ id: "u1", handle: "kudzayi" }), false);
});

withAdminEnv({ CLOAK_ADMIN_HANDLES: "kudzayi, founder" }, () => {
  check("a listed handle is an admin", isAdminUser({ id: "u1", handle: "kudzayi" }), true);
  check("handle matching is case-insensitive", isAdminUser({ id: "u2", handle: "KUDZAYI" }), true);
  check("unlisted handles are not admins", isAdminUser({ id: "u3", handle: "jennifer" }), false);
});

withAdminEnv({ CLOAK_ADMIN_USER_IDS: "user_123" }, () => {
  check("a listed user id is an admin", isAdminUser({ id: "user_123", handle: "anyone" }), true);
  check("an unlisted id is not an admin", isAdminUser({ id: "user_999", handle: "kudzayi" }), false);
});

withAdminEnv({ CLOAQ_ADMIN_HANDLES: "legacyadmin" }, () => {
  check("the legacy CLOAQ handle variable still works", isAdminUser({ id: "u4", handle: "legacyadmin" }), true);
});

/* ==================================================================
 * §38 — rate limiting
 * ================================================================== */

const rateKey = `test:${Math.random()}`;
let allowed = 0;
for (let i = 0; i < 40; i += 1) {
  if (checkInviteRateLimit(rateKey).allowed) allowed += 1;
}
check("the first 40 attempts in the window are allowed", allowed, 40);
const limited = checkInviteRateLimit(rateKey);
check("the 41st is blocked", limited.allowed, false);
check("  ... with a retry hint", limited.retryAfterSec > 0, true);
check("a different key is unaffected", checkInviteRateLimit(`other:${Math.random()}`).allowed, true);

/* ==================================================================
 * Error mapping
 * ================================================================== */

check("a plain Error maps to its message", invitationError(new Error("already_redeemed")), {
  ok: false,
  error: "already_redeemed",
});
check("an unknown throw maps to server_error", invitationError("boom"), { ok: false, error: "server_error" });

/* ==================================================================
 * Static wiring (not behavioural — route and config shape)
 * ================================================================== */

const adminListRoute = read("src/app/api/admin/adviser-invitations/route.ts");
check("the admin list/create route authorizes with isAdminUser", /isAdminUser\(user\)/.test(adminListRoute), true);
check("  ... and rejects cross-site posts", /requireSameOrigin\(req\)/.test(adminListRoute), true);

const adminDetailRoute = read("src/app/api/admin/adviser-invitations/[id]/route.ts");
check("the admin detail route authorizes with isAdminUser", /isAdminUser\(user\)/.test(adminDetailRoute), true);

const extendRoute = read("src/app/api/admin/adviser-invitations/[id]/extend/route.ts");
const revokeRoute = read("src/app/api/admin/adviser-invitations/[id]/revoke/route.ts");
check("the extend route authorizes with isAdminUser", /isAdminUser\(user\)/.test(extendRoute), true);
check("the revoke route authorizes with isAdminUser", /isAdminUser\(user\)/.test(revokeRoute), true);

const publicTokenRoute = read("src/app/api/adviser-invitations/[token]/route.ts");
check("the public lookup route requires no session (token is the capability)", /getSessionUser/.test(publicTokenRoute), false);

const redeemRouteSrc = read("src/app/api/adviser-invitations/[token]/redeem/route.ts");
check("the redeem route requires a session", /getSessionUser\(req\)/.test(redeemRouteSrc), true);
check("  ... and rejects cross-site posts", /requireSameOrigin\(req\)/.test(redeemRouteSrc), true);

const passListRoute = read("src/app/api/membership/passes/route.ts");
const passInviteRoute = read("src/app/api/membership/passes/invite/route.ts");
const passRedeemRoute = read("src/app/api/membership/invite-redeem/route.ts");
const trustedInvitePage = read("src/app/invite/trusted/[token]/page.tsx");
check("shared grants are authorized for Reserve and Founding Adviser origins", /membershipOrigin === \"founding_adviser\"/.test(passListRoute) && /membershipOrigin === \"founding_adviser\"/.test(passInviteRoute), true);
check("Founding Adviser links use the canonical .app trusted route", /https:\/\/cloakdagger\.app\/invite\/trusted\//.test(passInviteRoute), true);
check("QR generation encodes the secure invitation URL", /QRCode\.toDataURL\(link/.test(passInviteRoute), true);
check("trusted invite redemption uses its distinct membership origin", /founding_adviser_trusted_invite/.test(passRedeemRoute), true);
check("the trusted invitation has a direct recipient page route", /InvitePage token=\{token\}/.test(trustedInvitePage), true);

const adviserWelcome = read("src/components/cloak/membership/adviser-invite-page.tsx");
const membershipCard = read("src/components/cloak/settings/membership-page.tsx");
check("Founding Adviser welcome screen includes three Trusted Invites", /You also have 3 Trusted Invites/.test(adviserWelcome), true);
check("Founding Adviser welcome CTA opens Membership settings", /#\/app\/settings\/membership/.test(adviserWelcome), true);
check("Founding Adviser membership card uses the shared grant manager", /ReservePassManager program=\"founding_adviser\"/.test(membershipCard), true);
check("the Reserve card retains ten included Private grants", /includedPrivatePasses: 10/.test(read("src/lib/cloak/config.ts")), true);

const adminTrustedRoute = read("src/app/api/admin/founding-advisers/[userId]/trusted-invites/route.ts");
const adminTrustedUi = read("src/components/cloak/admin/adviser-invitations-admin.tsx");
check("only allowlisted admins can inspect and increase Trusted Invite capacity", /isAdminUser\(actor\)/.test(adminTrustedRoute), true);
check("additional Trusted Invite capacity is audit logged", /trustedInviteAdminEvent\.create/.test(adminTrustedRoute), true);
check("admin invitation detail provides the grant capacity control", /Grant More Invites/.test(adminTrustedUi), true);

/* Asserted on the real serialized objects rather than on source text: the
   service legitimately mentions `tokenHash` in `where` and `data` clauses, so
   a grep would prove nothing either way. */
check(
  "the admin serialization never carries a token hash",
  Object.keys(createdInvite.invitation).includes("tokenHash"),
  false
);
check(
  "the public serialization never carries a token hash",
  Object.keys(validView).includes("tokenHash"),
  false
);
check(
  "the admin serialization never carries the raw token",
  Object.keys(createdInvite.invitation).includes("token"),
  false
);

const serviceSrc = read("src/lib/cloak/server/adviser-invitations.ts");
check("the invitation page sends no referrer", /Referrer-Policy": "no-referrer"/.test(serviceSrc), true);
check("the invitation API is uncacheable", /Cache-Control": "no-store, max-age=0"/.test(serviceSrc), true);
check(
  "the invitation page itself is no-store and no-referrer",
  /source: "\/invite\/:path\*"/.test(nextConfigSrc),
  true
);
/* Next lets the LAST matching header rule win, so the broad catch-all must
   be declared BEFORE the invitation override. Swapped, the catch-all's
   Referrer-Policy silently defeats the invitation page's no-referrer — which
   it did, and which was caught by probing the running server. */
const catchAllAt = nextConfigSrc.indexOf('source: "/(.*)"');
const inviteAt = nextConfigSrc.indexOf('source: "/invite/:path*"');
check("both header rules are declared", catchAllAt > -1 && inviteAt > -1, true);
check("the catch-all header rule precedes the invitation override", catchAllAt < inviteAt, true);

const schemaSrc = read("prisma/schema.prisma");
check("the schema stores a unique token hash", /model AdviserInvitation[\s\S]*?tokenHash\s+String\s+@unique/.test(schemaSrc), true);
check("the schema has no raw token column", /model AdviserInvitation[\s\S]*?\n\s+token\s+String/.test(schemaSrc), false);
check("the schema keeps an invitation event log", /model AdviserInvitationEvent/.test(schemaSrc), true);

console.log(`  ok  adviser invitations (${checks} checks)`);
