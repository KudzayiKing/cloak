import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

/*
 * Canonical origin (adviser invitation spec §1, §44, §45).
 *
 * cloakdagger.app is the ONE application origin. cloakdagger.com is purely
 * defensive: it must never run a second copy of the app, never set its own
 * cookies, and never serve duplicate content. A permanent host-level redirect
 * that preserves the path is the whole treatment.
 *
 * Declared here rather than in a host dashboard so the rule travels with the
 * code and is reviewable in the same diff as everything else. `statusCode:
 * 301` is used deliberately instead of `permanent: true`, which Next maps to
 * a 308 — the spec asks for 301 specifically.
 */
const CANONICAL_HOST = "cloakdagger.app";
const DEFENSIVE_HOSTS = ["cloakdagger.com", "www.cloakdagger.com"] as const;

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  devIndicators: false,
  async redirects() {
    return DEFENSIVE_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      statusCode: 301 as const,
    }));
  },
  async headers() {
    /*
     * ORDER IS LOAD-BEARING. Next applies every matching rule and lets the
     * LAST one win for a given header key, so the broad catch-all has to come
     * first and the narrow override second.
     *
     * With the two swapped, the catch-all's `Referrer-Policy:
     * strict-origin-when-cross-origin` silently beat the invitation page's
     * `no-referrer` — verified against the running production server, which
     * returned strict-origin for /invite/adviser/*. That is exactly the leak
     * spec §19 exists to prevent: a token-bearing URL travelling out in a
     * Referer header.
     */
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        /* Invitation pages are sensitive: a live token sits in the path, so
           the URL must not travel anywhere as a referrer, and no shared cache
           may retain the page (spec §19). */
        source: "/invite/adviser/:path*",
        headers: [
          ...securityHeaders.filter((header) => header.key !== "Referrer-Policy"),
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
  reactStrictMode: false,
};

export default nextConfig;
