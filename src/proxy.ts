import { NextRequest, NextResponse } from "next/server";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLEANUP_INTERVAL_MS = 60_000;

type RatePolicy = {
  name: string;
  max: number;
  windowMs: number;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();
let lastCleanupAt = 0;

const RATE_POLICIES: Array<{ test: RegExp; policy: RatePolicy }> = [
  { test: /^\/api\/auth\/(?:login|register)$/, policy: { name: "auth", max: 20, windowMs: 5 * 60_000 } },
  { test: /^\/api\/admin\//, policy: { name: "admin", max: 80, windowMs: 5 * 60_000 } },
  { test: /^\/api\/payments\//, policy: { name: "payments", max: 30, windowMs: 5 * 60_000 } },
  { test: /\/(?:invite|invitation|invites)(?:\/|$)/, policy: { name: "invites", max: 80, windowMs: 5 * 60_000 } },
  { test: /^\/api\/conversations\//, policy: { name: "conversations", max: 240, windowMs: 60_000 } },
  { test: /^\/api\/circles\//, policy: { name: "circles", max: 180, windowMs: 60_000 } },
];

const DEFAULT_WRITE_POLICY: RatePolicy = { name: "write", max: 120, windowMs: 60_000 };

export function proxy(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  if (!hasAllowedWriteOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 });
  }

  const limit = checkWriteRateLimit(req);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};

function hasAllowedWriteOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const allowedOrigins = getAllowedOrigins(req);
  const origin = req.headers.get("origin");
  if (origin) return allowedOrigins.has(origin);

  const referer = req.headers.get("referer");
  if (!referer) return true;

  try {
    return allowedOrigins.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

function getAllowedOrigins(req: NextRequest): Set<string> {
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

function checkWriteRateLimit(req: NextRequest): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const policy = policyForPath(req.nextUrl.pathname);
  const key = `${policy.name}:${clientIp(req)}`;
  const entry = rateBuckets.get(key);

  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  entry.count += 1;
  if (entry.count > policy.max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  return { allowed: true, retryAfterSec: 0 };
}

function policyForPath(pathname: string): RatePolicy {
  return RATE_POLICIES.find(({ test }) => test.test(pathname))?.policy ?? DEFAULT_WRITE_POLICY;
}

function clientIp(req: NextRequest): string {
  return (
    firstHeaderValue(req.headers.get("x-forwarded-for")) ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function cleanupExpiredBuckets(now: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}
