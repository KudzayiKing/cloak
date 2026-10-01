/*
 * Rate-limit hardening checks.
 *
 * Run: npm test
 *
 * Covers the three defects fixed together:
 *   1. the client-IP key was read from the LEFTMOST `x-forwarded-for` entry,
 *      which is caller-supplied — measured with no proxy in front, rotating it
 *      defeated the limiter entirely (45/45 allowed, zero 429s);
 *   2. the two route-level bucket Maps were never pruned, so they retained one
 *      entry per distinct caller for the life of the process;
 *   3. login was throttled only per IP, which a caller with an IPv6 /64 can
 *      rotate for free — no header forgery required.
 *
 * No server and no database. These are the pure primitives plus the exported
 * limiters.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UNKNOWN_CLIENT, normalizeIp, trustedClientIp } from "../src/lib/cloak/trusted-ip";
import { RateLimitBuckets } from "../src/lib/cloak/rate-limit";
import {
  checkLoginHandleRateLimit,
  checkLoginRateLimit,
  clearLoginRateLimit,
} from "../src/lib/cloak/server/auth";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

/*
 * Code-shape assertions must look at CODE. These files carry long comments
 * explaining the very defect being guarded against, so a naive grep matches the
 * prose and reports a regression that is not there (this file's `split(",")[0]`
 * check failed on the comment describing it). Strip comments first.
 *
 * Line comments are removed to end-of-line only, so a `//` inside a string
 * literal can at worst truncate the rest of that one line — which would make a
 * positive assertion fail loudly rather than pass silently.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

let checks = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  assert.deepEqual(actual, expected, `FAILED: ${label}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A case-insensitive headers stand-in, as the real Headers object is. */
function headers(record: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

/* ==================================================================
 * Address normalization
 * ================================================================== */

check("a bare IPv4 is accepted", normalizeIp("203.0.113.9"), "203.0.113.9");
check("an IPv4 with a port drops the port", normalizeIp("203.0.113.9:443"), "203.0.113.9");
check("a bracketed IPv6 is unwrapped", normalizeIp("[2001:db8::1]"), "2001:db8::1");
check("a bracketed IPv6 with a port drops the port", normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
check("a bare IPv6 is lowercased", normalizeIp("2001:DB8::1"), "2001:db8::1");
check("loopback survives", normalizeIp("::1"), "::1");
check("an out-of-range octet is rejected", normalizeIp("999.1.1.1"), null);
check("a leading-zero octet is rejected", normalizeIp("010.1.1.1"), null);
check("prose is rejected", normalizeIp("not-an-ip"), null);
check("an empty value is rejected", normalizeIp("   "), null);

/* ==================================================================
 * The client-IP key — the actual defect
 * ================================================================== */

check("no forwarding headers at all yields the shared bucket", trustedClientIp(headers({})), UNKNOWN_CLIENT);
check(
  "a single forwarded value is used",
  trustedClientIp(headers({ "x-forwarded-for": "203.0.113.9" })),
  "203.0.113.9"
);

/* THE regression test. A caller sends the leftmost value; the trusted proxy
   appends the real address. Reading [0] hands the caller the bucket. */
check(
  "a caller-supplied hop is ignored in favour of the appended real address",
  trustedClientIp(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" })),
  "203.0.113.9"
);
check(
  "with several hops the rightmost wins",
  trustedClientIp(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.9, 198.51.100.1" })),
  "198.51.100.1"
);
check(
  "junk hops are skipped rather than becoming a key",
  trustedClientIp(headers({ "x-forwarded-for": "not-an-ip, also-junk, 203.0.113.9" })),
  "203.0.113.9"
);
check(
  "an entirely junk header cannot mint a key",
  trustedClientIp(headers({ "x-forwarded-for": "a, b, c" })),
  UNKNOWN_CLIENT
);

check("x-real-ip is honoured", trustedClientIp(headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
check(
  "x-vercel-forwarded-for outranks the others",
  trustedClientIp(
    headers({
      "x-vercel-forwarded-for": "203.0.113.1",
      "x-real-ip": "198.51.100.7",
      "x-forwarded-for": "9.9.9.9",
    })
  ),
  "203.0.113.1"
);
check(
  "a malformed x-real-ip falls through to the forwarded list",
  trustedClientIp(headers({ "x-real-ip": "garbage", "x-forwarded-for": "9.9.9.9, 203.0.113.9" })),
  "203.0.113.9"
);
check(
  "an unidentifiable caller shares one bucket rather than getting its own",
  trustedClientIp(headers({ "x-forwarded-for": "junk" })),
  trustedClientIp(headers({ "x-forwarded-for": "different-junk" }))
);

/* ==================================================================
 * The bucket store — bounded, and it reclaims
 * ================================================================== */

{
  const store = new RateLimitBuckets();
  let allowed = 0;
  for (let i = 0; i < 5; i += 1) if (store.take("k", 5, 60_000).allowed) allowed += 1;
  check("attempts up to the maximum are allowed", allowed, 5);
  const blocked = store.take("k", 5, 60_000);
  check("the next attempt is blocked", blocked.allowed, false);
  check("  ... and reports a retry hint", blocked.retryAfterSec > 0, true);
  check("an unrelated key is unaffected", store.take("other", 5, 60_000).allowed, true);
  check("forget() clears a key", (store.forget("k"), store.take("k", 5, 60_000).allowed), true);
}

{
  /* A window that has elapsed must not keep blocking. */
  const store = new RateLimitBuckets();
  check("first attempt in a window is allowed", store.take("w", 1, 30).allowed, true);
  check("the second is blocked", store.take("w", 1, 30).allowed, false);
  await sleep(45);
  check("after the window elapses the key is allowed again", store.take("w", 1, 30).allowed, true);
}

{
  /* Expired buckets are reclaimed — the leak this replaces. */
  const store = new RateLimitBuckets(1000, 0);
  for (let i = 0; i < 200; i += 1) store.take(`expire-${i}`, 1, 10);
  check("200 live buckets exist before expiry", store.size, 200);
  await sleep(30);
  store.take("trigger", 1, 10);
  check("expired buckets are reclaimed, not retained", store.size, 1);
}

{
  /* The hard cap holds even when nothing has expired. */
  const cap = 5;
  const store = new RateLimitBuckets(cap, 0);
  for (let i = 0; i < 200; i += 1) store.take(`live-${i}`, 1, 60_000);
  /* The sweep runs before the insert, so the steady state is cap + 1. */
  check("an unexpired burst is bounded by the cap", store.size <= cap + 1, true);
  check("  ... and never grows with the number of keys", store.size < 200, true);
}

/* ==================================================================
 * Login throttling — the IP-independent layer
 * ================================================================== */

{
  const handle = "victim";
  let allowed = 0;
  for (let i = 0; i < 10; i += 1) {
    if (checkLoginHandleRateLimit(handle).allowed) allowed += 1;
  }
  check("a handle may be attempted up to its maximum", allowed, 10);
  const blocked = checkLoginHandleRateLimit(handle);
  check("further attempts against that handle are blocked", blocked.allowed, false);
  check("  ... with a retry hint", blocked.retryAfterSec > 0, true);
  check("a different handle is unaffected", checkLoginHandleRateLimit("someone-else").allowed, true);
}

{
  /*
   * The point of the handle layer: an attacker rotating source addresses gets
   * no benefit. Ten failures from ten DIFFERENT IPs, then an eleventh from yet
   * another IP, must still be refused.
   */
  const handle = "rotated-target";
  for (let i = 0; i < 10; i += 1) {
    const ip = `198.51.100.${i}`;
    checkLoginRateLimit(ip);
    checkLoginHandleRateLimit(handle);
  }
  checkLoginRateLimit("198.51.100.200");
  check(
    "rotating the source IP does not buy extra attempts against one handle",
    checkLoginHandleRateLimit(handle).allowed,
    false
  );
}

{
  const handle = "cleared-user";
  const ip = "203.0.113.77";
  for (let i = 0; i < 10; i += 1) {
    checkLoginRateLimit(ip);
    checkLoginHandleRateLimit(handle);
  }
  check("the handle is throttled before a successful login", checkLoginHandleRateLimit(handle).allowed, false);
  clearLoginRateLimit(ip, handle);
  check("a successful login clears the handle bucket", checkLoginHandleRateLimit(handle).allowed, true);
  check("  ... and the IP bucket", checkLoginRateLimit(ip).allowed, true);
}

/* ==================================================================
 * Static wiring (not behavioural)
 * ================================================================== */

const authSrc = code(read("src/lib/cloak/server/auth.ts"));
const proxySrc = code(read("src/proxy.ts"));
const trustedIpSrc = code(read("src/lib/cloak/trusted-ip.ts"));
const loginSrc = code(read("src/app/api/auth/login/route.ts"));
const inviteSrc = code(read("src/lib/cloak/server/adviser-invitations.ts"));

check("the auth layer delegates to the shared resolver", /trustedClientIp\(req\.headers\)/.test(authSrc), true);
check("the middleware delegates to the shared resolver", /trustedClientIp\(req\.headers\)/.test(proxySrc), true);
check(
  "the resolver reads the rightmost forwarded hop",
  /for \(let i = hops\.length - 1; i >= 0; i -= 1\)/.test(trustedIpSrc),
  true
);
check(
  "the resolver no longer reads the leftmost forwarded hop",
  /split\(","\)\[0\]/.test(trustedIpSrc),
  false
);
check("login applies a per-handle throttle", /checkLoginHandleRateLimit\(handle\)/.test(loginSrc), true);
check("login clears both buckets on success", /clearLoginRateLimit\(ip, handle\)/.test(loginSrc), true);
check(
  "the invitation limiter uses the sweeping store",
  /inviteRateLimits = new RateLimitBuckets\(\)/.test(inviteSrc),
  true
);
check(
  "no route-level limiter is still a bare Map",
  /new Map<string, \{ count: number; resetAt: number \}>/.test(authSrc + proxySrc + inviteSrc),
  false
);

console.log(`  ok  rate limiting (${checks} checks)`);
