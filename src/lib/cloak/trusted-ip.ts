/*
 * Which client IP a rate-limit key may be built from.
 *
 * Dependency-free on purpose: this is imported by `src/proxy.ts`, which runs
 * in the edge runtime, so it must not reach for node built-ins.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST ASSUMPTION, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * Every proxy APPENDS to `x-forwarded-for`, so the LEFTMOST entry is whatever
 * the caller sent and the RIGHTMOST is the nearest trusted proxy's view. This
 * module previously read `split(",")[0]` — the spoofable end. Measured with no
 * proxy in front, rotating that header defeated the limiter completely:
 * 45/45 requests allowed, zero 429s, against 40-then-429 with a constant value.
 *
 * That was latent rather than live, because both real deployment paths
 * overwrite the header: Vercel documents that it replaces `x-forwarded-for`
 * specifically to prevent IP spoofing, and this repo's Caddyfile sets
 * `header_up X-Forwarded-For {remote_host}`. It becomes live the moment the app
 * is reachable directly, or someone puts an appending proxy in front — nginx's
 * most-copied snippet (`$proxy_add_x_forwarded_for`) does exactly that.
 *
 * So this reads the rightmost entry instead, which is correct under an
 * appending proxy and under a header-overwriting one alike (where the list has
 * a single element and it is the real address).
 *
 * WHAT THIS CANNOT FIX: a deployment with no proxy at all. There, the rightmost
 * entry is also caller-supplied, and no header-based scheme can help — the
 * answer is to terminate behind a trusted proxy and let the platform set it.
 * The limiter is a mitigation, not a substitute for that.
 */

/** One shared bucket for callers whose address cannot be established. */
export const UNKNOWN_CLIENT = "unknown";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;

function isIpv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  return value.split(".").every((octet) => {
    const n = Number(octet);
    /* Range, then canonical form: `octet === String(n)` rejects leading zeros
       ("010") and any other spelling that is not the plain decimal one, so two
       spellings of the same address can never occupy two different buckets. */
    return n >= 0 && n <= 255 && octet === String(n);
  });
}

function isIpv6(value: string): boolean {
  return value.includes(":") && IPV6.test(value);
}

/**
 * Accepts a bare address, a bracketed IPv6 (`[::1]`), or either with a port
 * (`1.2.3.4:5678`, `[::1]:443`). Returns null for anything else, so a junk
 * value can never become a rate-limit key of its own.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim();
  if (!value) return null;

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return null;
    const inner = value.slice(1, end);
    return isIpv6(inner) ? inner.toLowerCase() : null;
  }

  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (withPort) value = withPort[1]!;

  if (isIpv4(value)) return value;
  if (isIpv6(value)) return value.toLowerCase();
  return null;
}

/**
 * The caller's address, as far as it can be trusted, or `UNKNOWN_CLIENT`.
 *
 * Order: Vercel's own header, then `x-real-ip` (which this repo's Caddy sets
 * from `{remote_host}`, overwriting any caller value), then the RIGHTMOST
 * `x-forwarded-for` entry. An unidentifiable caller shares one bucket rather
 * than receiving a fresh one per request — failing open would mean no limit at
 * all for exactly the traffic that is hardest to attribute.
 */
export function trustedClientIp(headers: { get(name: string): string | null }): string {
  const vercelForwarded = normalizeIp(headers.get("x-vercel-forwarded-for"));
  if (vercelForwarded) return vercelForwarded;

  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const candidate = normalizeIp(hops[i]);
      if (candidate) return candidate;
    }
  }

  return UNKNOWN_CLIENT;
}
