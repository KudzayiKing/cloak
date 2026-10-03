import { db } from "@/lib/db";
import { DEV_ACCOUNT_HANDLES } from "@/lib/cloak/server/auth";
import { adminHandles } from "@/lib/cloak/server/adviser-invitations";
import { RateLimitBuckets } from "@/lib/cloak/rate-limit";

/*
 * Admin overview — the numbers an operator may see about a private messenger.
 *
 * Four rules shape this module, and each is a constraint rather than a taste:
 *
 *  1. AGGREGATE ONLY. Every field below is a count or a total; not one is a
 *     row. There is deliberately no per-user message count, no "who talks to
 *     whom", no contact list and no per-user last-active. The server does hold
 *     `Participation` rows from which the social graph could be derived — that
 *     is precisely why it is not surfaced. An operator-visible adjacency list
 *     is a directory of the users the product exists to protect, and it would
 *     be the single most damaging thing this panel could render.
 *
 *  2. READ ONLY. Nothing in this file writes. The panel has no actions at all —
 *     no grant, no suspension, no delete. Entitlements come only from
 *     `/api/payments/verify` and invite redemption, and removal is a *data
 *     owner* power: the user over their own account, the circle owner over
 *     their own circle. A metrics module that could mutate would be the wrong
 *     shape for that, so the read-only property is asserted by a test.
 *
 *  3. FIXTURES ARE NOT USERS. Operator handles (`CLOAK_ADMIN_HANDLES`) and the
 *     seeded dev identities are subtracted from EVERY account-derived figure —
 *     the headline count, the signup trend and the membership split alike. An
 *     excluded row that still shows up in one panel makes the page contradict
 *     itself, and "0 accounts" printed beside "3 hold a tier" is how a dashboard
 *     teaches a reader to distrust all of it. Both lists are read from the same
 *     places that decide access and seeding, so they cannot drift from the truth
 *     they describe.
 *
 *     The subtraction is a WHERE filter, never a widened SELECT: the exclusion
 *     names handles to *match on* and returns nothing about them.
 *
 *  4. UNKNOWN IS NOT A CATEGORY OF ITS OWN. An account holding a tier with no
 *     recorded origin is reported as `unattributed` rather than being folded
 *     into a real origin. `entitlementForUser` used to answer `admin_grant` for
 *     exactly this case, which would have manufactured phantom operator grants
 *     in the one chart built to detect them.
 *
 * What the server genuinely *cannot* produce is worth stating plainly too:
 * message bodies, conversation key material and attachment contents are
 * ciphertext here. No query in this file could read them even if it tried, so
 * their absence is arithmetic rather than restraint.
 */

const DAY_MS = 24 * 3600 * 1000;
const TREND_DAYS = 30;

/** A labelled count, already sorted for display. */
export interface MetricCount {
  key: string;
  count: number;
}

export interface AdminOverview {
  generatedAt: string;
  accounts: {
    /** Every `User` row, fixtures included. */
    total: number;
    /** Operator and seeded-device rows removed from `counted`. */
    excluded: number;
    counted: number;
    newLast7Days: number;
    newLast30Days: number;
    emailVerified: number;
    /** One bucket per UTC day, oldest first, gaps filled with zero. */
    trend: { date: string; count: number }[];
    excludedHandles: string[];
  };
  membership: {
    withTier: number;
    withoutTier: number;
    byTier: MetricCount[];
    /** Entitled accounts only — so a null key means "origin unrecorded". */
    byOrigin: MetricCount[];
  };
  invites: {
    created: number;
    pending: number;
    redeemed: number;
    expired: number;
    revoked: number;
    /** `redeemed / created`, or null before the first invitation exists. */
    redemptionRate: number | null;
    medianHoursToRedeem: number | null;
    createdLast30Days: number;
    redeemedLast30Days: number;
  };
  storage: {
    blobs: number;
    bytes: number;
    /** Past their TTL and awaiting the lazy purge — a backlog, not a leak. */
    expiredBlobs: number;
    oldestBlobAgeDays: number | null;
  };
  devices: { active: number; revoked: number; seenLast7Days: number };
  sessions: { active: number; legacy: number };
  push: { subscriptions: number; accounts: number };
}

/**
 * Handles that are not users: the configured operators plus the dev fixtures.
 * Lowercased to match `User.handle`, which is stored without the leading "@".
 */
export function reservedHandles(): Set<string> {
  const reserved = adminHandles();
  for (const handle of DEV_ACCOUNT_HANDLES) reserved.add(handle.toLowerCase());
  return reserved;
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Middle value of a sorted copy; the mean of the two middles when even. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

const byCountDesc = (a: MetricCount, b: MetricCount): number =>
  b.count - a.count || a.key.localeCompare(b.key);

export async function getAdminOverview(): Promise<AdminOverview> {
  const now = new Date();
  const nowMs = now.getTime();
  const thirtyDaysAgo = new Date(nowMs - 30 * DAY_MS);
  const sevenDaysAgo = new Date(nowMs - 7 * DAY_MS);
  /* Floor to a UTC midnight so every bucket is a whole day and the series does
     not shift under a reader depending on the hour they load the page. */
  const trendStart = new Date(Math.floor((nowMs - (TREND_DAYS - 1) * DAY_MS) / DAY_MS) * DAY_MS);

  const reserved = [...reservedHandles()];

  const [
    totalUsers,
    emailVerified,
    excludedUsers,
    signupRows,
    tierRows,
    originRows,
    inviteStatusRows,
    overduePending,
    redeemedRows,
    invitesCreated30,
    invitesRedeemed30,
    blobAggregate,
    expiredBlobs,
    devicesActive,
    devicesRevoked,
    devicesSeen7,
    sessionsActive,
    sessionsLegacy,
    pushSubscriptions,
    pushAccountRows,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({
      where: { emailVerifiedAt: { not: null }, handle: { notIn: reserved } },
    }),
    reserved.length > 0 ? db.user.count({ where: { handle: { in: reserved } } }) : Promise.resolve(0),
    /* A fixture created last week is not a signup. `handle` appears here as a
       filter only — the projection stays `createdAt` alone. */
    db.user.findMany({
      where: { createdAt: { gte: trendStart }, handle: { notIn: reserved } },
      select: { createdAt: true },
    }),
    db.user.groupBy({
      by: ["membershipTier"],
      where: { handle: { notIn: reserved } },
      _count: { _all: true },
    }),
    /* Entitled accounts only: a null origin here means "holds a tier, origin
       unrecorded", never "has no membership". */
    db.user.groupBy({
      by: ["membershipOrigin"],
      where: { membershipTier: { not: null }, handle: { notIn: reserved } },
      _count: { _all: true },
    }),
    db.adviserInvitation.groupBy({ by: ["status"], _count: { _all: true } }),
    db.adviserInvitation.count({ where: { status: "pending", expiresAt: { lte: now } } }),
    db.adviserInvitation.findMany({
      where: { status: "redeemed", redeemedAt: { not: null } },
      select: { createdAt: true, redeemedAt: true },
    }),
    db.adviserInvitation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    db.adviserInvitation.count({ where: { redeemedAt: { gte: thirtyDaysAgo } } }),
    db.attachmentBlob.aggregate({
      _count: { _all: true },
      _sum: { byteSize: true },
      _min: { createdAt: true },
    }),
    db.attachmentBlob.count({ where: { expiresAt: { lte: now } } }),
    db.device.count({ where: { revokedAt: null } }),
    db.device.count({ where: { revokedAt: { not: null } } }),
    db.device.count({ where: { revokedAt: null, lastSeenAt: { gte: sevenDaysAgo } } }),
    db.session.count({ where: { expiresAt: { gt: now } } }),
    db.session.count({ where: { deviceId: null } }),
    db.pushSubscription.count(),
    db.pushSubscription.findMany({ select: { userId: true }, distinct: ["userId"] }),
  ]);

  /* -------- accounts -------- */

  /* The population every account-derived figure below is measured against:
     real rows only. Fixtures are reported as `excluded`, never as users. */
  const counted = totalUsers - excludedUsers;

  const trendBuckets = new Map<string, number>();
  for (let index = 0; index < TREND_DAYS; index += 1) {
    trendBuckets.set(utcDayKey(new Date(trendStart.getTime() + index * DAY_MS)), 0);
  }
  for (const row of signupRows) {
    const key = utcDayKey(row.createdAt);
    const current = trendBuckets.get(key);
    if (current !== undefined) trendBuckets.set(key, current + 1);
  }
  const trend = [...trendBuckets].map(([date, count]) => ({ date, count }));

  /* -------- membership -------- */

  const byTier: MetricCount[] = tierRows
    .map((row) => ({ key: row.membershipTier ?? "none", count: row._count._all }))
    .sort(byCountDesc);
  const byOrigin: MetricCount[] = originRows
    .map((row) => ({ key: row.membershipOrigin ?? "unattributed", count: row._count._all }))
    .sort(byCountDesc);

  const withTier = byTier
    .filter((entry) => entry.key !== "none")
    .reduce((sum, entry) => sum + entry.count, 0);

  /* -------- invites --------
     `pending` is reported net of rows that are past their expiry, because a
     stale pending row is an expired invitation that nothing has swept yet.
     The correction is computed, never written — this module does not mutate. */

  const rawStatus = new Map(inviteStatusRows.map((row) => [row.status, row._count._all]));
  const pending = Math.max(0, (rawStatus.get("pending") ?? 0) - overduePending);
  const expired = (rawStatus.get("expired") ?? 0) + overduePending;
  const redeemed = rawStatus.get("redeemed") ?? 0;
  const revoked = rawStatus.get("revoked") ?? 0;
  const created = pending + expired + redeemed + revoked;

  const hoursToRedeem = redeemedRows
    .filter((row) => row.redeemedAt !== null)
    .map((row) => (row.redeemedAt!.getTime() - row.createdAt.getTime()) / 3600_000);

  /* -------- storage -------- */

  const oldestBlobAt = blobAggregate._min.createdAt;
  const oldestBlobAgeDays =
    oldestBlobAt === null || oldestBlobAt === undefined
      ? null
      : Math.floor((nowMs - oldestBlobAt.getTime()) / DAY_MS);

  return {
    generatedAt: now.toISOString(),
    accounts: {
      total: totalUsers,
      excluded: excludedUsers,
      counted,
      newLast7Days: trend.slice(-7).reduce((sum, entry) => sum + entry.count, 0),
      newLast30Days: trend.reduce((sum, entry) => sum + entry.count, 0),
      emailVerified,
      trend,
      excludedHandles: reserved,
    },
    membership: {
      withTier,
      withoutTier: counted - withTier,
      byTier,
      byOrigin,
    },
    invites: {
      created,
      pending,
      redeemed,
      expired,
      revoked,
      redemptionRate: created > 0 ? redeemed / created : null,
      medianHoursToRedeem: median(hoursToRedeem),
      createdLast30Days: invitesCreated30,
      redeemedLast30Days: invitesRedeemed30,
    },
    storage: {
      blobs: blobAggregate._count._all,
      bytes: blobAggregate._sum.byteSize ?? 0,
      expiredBlobs,
      oldestBlobAgeDays,
    },
    devices: { active: devicesActive, revoked: devicesRevoked, seenLast7Days: devicesSeen7 },
    sessions: { active: sessionsActive, legacy: sessionsLegacy },
    push: { subscriptions: pushSubscriptions, accounts: pushAccountRows.length },
  };
}

/* ---------- rate limiting ---------- */

/*
 * A dashboard is cheap per request but expensive per row: every load fans out
 * into a couple of dozen aggregate scans. The limit is generous enough that no
 * human can reach it and tight enough that a refresh loop cannot hold the
 * pooler open. Shared with the rest of the admin surface via the one bucket
 * implementation (`lib/cloak/rate-limit.ts`) — never a bare `Map`.
 */
const overviewRateLimits = new RateLimitBuckets();

const OVERVIEW_WINDOW_MS = 60_000;
const OVERVIEW_MAX_ATTEMPTS = 60;

export function checkOverviewRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  return overviewRateLimits.take(key, OVERVIEW_MAX_ATTEMPTS, OVERVIEW_WINDOW_MS);
}
