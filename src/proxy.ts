import { NextRequest, NextResponse } from "next/server";
import { RateLimitBuckets } from "@/lib/cloak/rate-limit";
import { trustedClientIp } from "@/lib/cloak/trusted-ip";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RatePolicy = {
  name: string;
  max: number;
  windowMs: number;
};

/* Shared with the route-level limiters so there is one bucket implementation
   to reason about, and so the sweep lives in one place. */
const rateBuckets = new RateLimitBuckets();

const RATE_POLICIES: Array<{ test: RegExp; policy: RatePolicy }> = [
  { test: /^\/api\/auth\/(?:login|register)$/, policy: { name: "auth", max: 20, windowMs: 5 * 60_000 } },
  { test: /^\/api\/admin\//, policy: { name: "admin", max: 80, windowMs: 5 * 60_000 } },
  { test: /^\/api\/payments\//, policy: { name: "payments", max: 30, windowMs: 5 * 60_000 } },
  { test: /\/(?:invite|invitation|invites)(?:\/|$)/, policy: { name: "invites", max: 80, windowMs: 5 * 60_000 } },
  { test: /^\/api\/conversations\//, policy: { name: "conversations", max: 240, windowMs: 60_000 } },
  { test: /^\/api\/circles\//, policy: { name: "circles", max: 180, windowMs: 60_000 } },
];

const DEFAULT_WRITE_POLICY: RatePolicy = { name: "write", max: 120, windowMs: 60_000 };

export async function proxy(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  if (!hasAllowedWriteOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 });
  }

  const limit = await checkWriteRateLimit(req);
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

async function checkWriteRateLimit(req: NextRequest): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const sharedLimit = await checkSharedWriteRateLimit(req);
  if (sharedLimit) return sharedLimit;

  const policy = policyForPath(req.nextUrl.pathname);
  const key = `${policy.name}:${clientIp(req)}`;
  return rateBuckets.take(key, policy.max, policy.windowMs);
}

async function checkSharedWriteRateLimit(
  req: NextRequest
): Promise<{ allowed: boolean; retryAfterSec: number } | null> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return null;

  const now = Date.now();
  const policy = policyForPath(req.nextUrl.pathname);
  const bucket = Math.floor(now / policy.windowMs);
  const key = `cloak:rate:${policy.name}:${clientIp(req)}:${bucket}`;
  const retryAfterSec = Math.max(1, Math.ceil(((bucket + 1) * policy.windowMs - now) / 1000));

  try {
    const res = await fetch(`${redisUrl.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, Math.ceil(policy.windowMs / 1000) + 5],
      ]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(payload[0]?.result ?? 0);
    if (!Number.isFinite(count) || count <= 0) return null;
    return count <= policy.max ? { allowed: true, retryAfterSec: 0 } : { allowed: false, retryAfterSec };
  } catch (err) {
    console.warn("[proxy/rate-limit] shared limiter unavailable; falling back to local bucket", err);
    return null;
  }
}

function policyForPath(pathname: string): RatePolicy {
  return RATE_POLICIES.find(({ test }) => test.test(pathname))?.policy ?? DEFAULT_WRITE_POLICY;
}

/*
 * The caller's address, as far as it can be trusted.
 *
 * Previously this read the LEFTMOST `x-forwarded-for` entry, which is whatever
 * the caller sent — see `src/lib/cloak/trusted-ip.ts`. Note this is also the
 * key for the shared Upstash limiter, so a spoofable key defeated that too.
 */
function clientIp(req: NextRequest): string {
  return trustedClientIp(req.headers);
}

/* Still used for the forwarded HOST and PROTO, which are single-valued in
   practice and feed the write-origin allowlist rather than a rate-limit key. */
function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}
