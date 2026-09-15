/*
 * Founding Adviser invitation contract checks.
 *
 * These are static guards for the pieces that should not drift: Cloaq brand
 * config, production invite URL, hash-only storage, protected routes, and the
 * membership origin used by redemption.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_URL, BRAND, appUrl } from "../src/lib/cloak/config";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

assert.equal(BRAND.name, "Cloaq");
assert.equal(BRAND.uppercaseName, "CLOAQ");
assert.equal(APP_URL, "https://cloaq.app");
assert.equal(appUrl("/invite/adviser/token-test"), "https://cloaq.app/invite/adviser/token-test");

const schema = read("prisma/schema.prisma");
assert.match(schema, /model AdviserInvitation/);
assert.match(schema, /tokenHash\s+String\s+@unique/);
assert.doesNotMatch(schema, /model AdviserInvitation[\s\S]*\n\s+token\s+String/);
assert.match(schema, /membershipOrigin\s+String\s+@default\("founding_adviser"\)/);

const service = read("src/lib/cloak/server/adviser-invitations.ts");
assert.match(service, /generateInviteTokenServer\(\)/);
assert.match(service, /hashInviteTokenServer\(token\)/);
assert.match(service, /ADVISER_INVITE_MEMBERSHIP_ORIGIN = "founding_adviser"/);
assert.match(service, /Referrer-Policy": "no-referrer"/);
assert.match(service, /Cache-Control": "no-store, max-age=0"/);
assert.match(service, /isAdminUser/);
assert.match(service, /updateMany\(\{\s*where:\s*\{[\s\S]*status: "pending"[\s\S]*redeemedByUserId: null/);

const adminRoute = read("src/app/api/admin/adviser-invitations/route.ts");
assert.match(adminRoute, /isAdminUser\(user\)/);
assert.match(adminRoute, /requireSameOrigin\(req\)/);

const redeemRoute = read("src/app/api/adviser-invitations/[token]/redeem/route.ts");
assert.match(redeemRoute, /getSessionUser\(req\)/);
assert.match(redeemRoute, /requireSameOrigin\(req\)/);

const nextConfig = read("next.config.ts");
assert.match(nextConfig, /source: "\/invite\/adviser\/:path\*"/);
assert.match(nextConfig, /value: "no-referrer"/);

console.log("  ok  adviser invitation contracts");
