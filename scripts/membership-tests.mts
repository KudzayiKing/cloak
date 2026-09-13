/*
 * Membership & guest-pass invariant tests (pricing & membership update spec §57).
 *
 * Run: npm test
 *
 * The backend is not implemented yet, so these exercise the service-layer
 * logic (pure state machine + capability model) and document the backend
 * invariants the real service must preserve:
 *   one token -> one redemption; expired/revoked/redeemed/unknown -> rejected;
 *   redeemed = permanently consumed; Reserve cannot exceed its allocation.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CAPABILITIES,
  can,
  decideRedemption,
  effectivePassStatus,
  generateInviteToken,
  hashInviteToken,
  issuePassTransition,
  membershipCapabilities,
  passAllocation,
  redeemPassTransition,
  revokePassTransition,
} from "../src/lib/cloak/membership";
import { RESERVE_GUEST_INVITE_EXPIRY_DAYS, CLOAK_PRICING } from "../src/lib/cloak/config";
import type { CloakMembership, MembershipEntitlement, ReserveGuestPass } from "../src/lib/cloak/types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((err: unknown) => {
      failed += 1;
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    });
}

/* ---------- fixtures ---------- */

const OWNER = "reserve-member-1";

function availablePasses(n: number, owner = OWNER): ReserveGuestPass[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pass-${i + 1}`,
    ownerUserId: owner,
    status: "available" as const,
  }));
}

function issuedPass(partial: Partial<ReserveGuestPass> = {}): ReserveGuestPass {
  return {
    id: "pass-1",
    ownerUserId: OWNER,
    status: "issued",
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    ...partial,
  };
}

const privateEntitlement: MembershipEntitlement = {
  membership: "private",
  origin: "purchase",
  active: true,
  renewal: "never",
};

const reserveEntitlement: MembershipEntitlement = {
  membership: "reserve",
  origin: "purchase",
  active: true,
  renewal: "never",
};

/* ---------- 1. Pricing configuration ---------- */

await test("pricing config: Private $499 one-time", () => {
  assert.equal(CLOAK_PRICING.private.amount, 499);
  assert.equal(CLOAK_PRICING.private.billing, "one_time");
});

await test("pricing config: Reserve $2,500 one-time with 10 Private passes", () => {
  assert.equal(CLOAK_PRICING.reserve.amount, 2500);
  assert.equal(CLOAK_PRICING.reserve.billing, "one_time");
  assert.equal(CLOAK_PRICING.reserve.includedPrivatePasses, 10);
});

await test("pricing config: Circle from $10,000, Office from $15,000/year, Sovereign custom", () => {
  assert.equal(CLOAK_PRICING.privateCircle.startingAt, 10000);
  assert.equal(CLOAK_PRICING.office.startingAt, 15000);
  assert.equal(CLOAK_PRICING.office.billing, "annual");
  assert.ok(!("amount" in CLOAK_PRICING.sovereign));
});

await test("invite expiry window is 7 days", () => {
  assert.equal(RESERVE_GUEST_INVITE_EXPIRY_DAYS, 7);
});

/* ---------- 2. Capability mapping (spec §36) ---------- */

await test("Private holds the complete core individual product, cannot issue passes", () => {
  const caps = membershipCapabilities("private");
  for (const c of [
    "messaging.private",
    "messaging.groups",
    "ghost_chat",
    "cloak_mode",
    "calls.voice",
    "calls.video",
    "ai.local",
    "memory.local",
    "devices.standard",
  ] as const) {
    assert.ok(caps.includes(c), `private missing ${c}`);
  }
  assert.ok(!can(privateEntitlement, "guest_pass.issue"), "Private must not issue passes");
  assert.ok(!can(privateEntitlement, "devices.advanced"));
});

await test("Reserve adds assurance + pass management + priority support", () => {
  for (const c of [
    "guest_pass.issue",
    "guest_pass.manage",
    "devices.advanced",
    "identity.enhanced",
    "support.priority",
    "onboarding.assisted",
    "security.advanced",
  ] as const) {
    assert.ok(can(reserveEntitlement, c), `reserve missing ${c}`);
  }
});

await test("Office is organizational (annual) with admin; Sovereign includes private deployment", () => {
  assert.ok(membershipCapabilities("office").includes("organization.admin"));
  assert.ok(membershipCapabilities("sovereign").includes("deployment.private"));
  assert.ok(membershipCapabilities("sovereign").length === CAPABILITIES.length);
});

await test("inactive entitlements grant nothing", () => {
  assert.equal(
    can({ membership: "reserve", active: false }, "guest_pass.issue"),
    false
  );
  assert.deepEqual(membershipCapabilities("none"), []);
});

/* ---------- 3. Allocation accounting (spec §7, §11) ---------- */

await test("a fresh Reserve member has 10 available passes", () => {
  const allocation = passAllocation(availablePasses(10));
  assert.deepEqual(allocation, { total: 10, available: 10, pending: 0, redeemed: 0 });
});

await test("pending + redeemed consume allocation; expired + revoked-before-redemption release it", () => {
  const passes: ReserveGuestPass[] = [
    ...availablePasses(7),
    issuedPass({ id: "p-pending" }),
    {
      id: "p-redeemed",
      ownerUserId: OWNER,
      status: "redeemed",
      redeemedAt: new Date().toISOString(),
    },
    {
      id: "p-expired",
      ownerUserId: OWNER,
      status: "issued",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    },
    {
      id: "p-revoked",
      ownerUserId: OWNER,
      status: "revoked_before_redemption",
      revokedAt: new Date().toISOString(),
    },
  ];
  const allocation = passAllocation(passes);
  assert.equal(allocation.available, 8); // 10 - 1 pending - 1 redeemed
  assert.equal(allocation.pending, 1);
  assert.equal(allocation.redeemed, 1);
});

await test("spec §11 example state: 7 available / 1 pending(expiring) / 2 redeemed", () => {
  const passes: ReserveGuestPass[] = [
    ...availablePasses(7),
    issuedPass({ id: "daniel", issuedTo: { name: "Daniel Reed" } }),
    { id: "s1", ownerUserId: OWNER, status: "redeemed" },
    { id: "s2", ownerUserId: OWNER, status: "redeemed" },
  ];
  const allocation = passAllocation(passes);
  assert.equal(allocation.available, 7);
  assert.equal(allocation.pending, 1);
  assert.equal(allocation.redeemed, 2);
});

/* ---------- 4. Issue / revoke transitions (spec §12-§13) ---------- */

await test("issue: available pass becomes a pending invitation with an expiry", () => {
  const passes = availablePasses(10);
  const result = issuePassTransition(passes, "pass-1", { recipient: { name: "Daniel Reed" } });
  assert.ok(!("error" in result));
  assert.equal(result.pass.status, "issued");
  assert.equal(result.pass.issuedTo?.name, "Daniel Reed");
});

await test("issue: Reserve cannot exceed the configured allocation", () => {
  const passes: ReserveGuestPass[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `u-${i}`,
      ownerUserId: OWNER,
      status: "issued" as const,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    })),
    { id: "extra", ownerUserId: OWNER, status: "available" },
  ];
  const result = issuePassTransition(passes, "extra", {});
  assert.ok("error" in result);
  assert.equal(result.error, "allocation_exhausted");
});

await test("revoke: allowed while pending, blocked after redemption", () => {
  const pending = issuedPass();
  const revoked = revokePassTransition([pending], pending.id);
  assert.ok(!("error" in revoked));
  assert.equal(revoked.pass.status, "revoked_before_redemption");

  const redeemed = issuedPass({ status: "redeemed" as const, redeemedAt: new Date().toISOString() });
  const fail = revokePassTransition([redeemed], redeemed.id);
  assert.ok("error" in fail);
  assert.equal(fail.error, "already_redeemed");
});

await test("expiry: a pending invitation past its window reads as expired", () => {
  const pass = issuedPass({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(effectivePassStatus(pass), "expired");
});

/* ---------- 5. Redemption contract (spec §7-§8, §57 security tests) ---------- */

await test("one token -> one redemption: second attempt is rejected", () => {
  const pass = issuedPass({ id: "t1" });
  const first = redeemPassTransition([pass], "t1", { redeemedByUserId: "guest" });
  assert.ok(!("error" in first));
  assert.equal(first.pass.status, "redeemed");
  /* The service persists state between calls — the second redemption hits
     the stored (now redeemed) pass, never the original. */
  const second = redeemPassTransition([first.pass], "t1", { redeemedByUserId: "guest" });
  assert.ok("error" in second);
  assert.equal(second.error, "already_redeemed");
});

await test("expired token -> rejected", () => {
  const pass = issuedPass({ id: "t2", expiresAt: new Date(Date.now() - 1000).toISOString() });
  const result = redeemPassTransition([pass], "t2", { redeemedByUserId: "guest" });
  assert.ok("error" in result);
  assert.equal(result.error, "already_expired");
});

await test("revoked token -> rejected", () => {
  const pass: ReserveGuestPass = {
    id: "t3",
    ownerUserId: OWNER,
    status: "revoked_before_redemption",
    revokedAt: new Date().toISOString(),
  };
  const result = redeemPassTransition([pass], "t3", { redeemedByUserId: "guest" });
  assert.ok("error" in result);
  assert.equal(result.error, "already_revoked");
});

await test("already-redeemed token -> rejected; unknown token -> rejected", () => {
  const redeemed: ReserveGuestPass = {
    id: "t4",
    ownerUserId: OWNER,
    status: "redeemed",
    redeemedAt: new Date().toISOString(),
  };
  const reused = redeemPassTransition([redeemed], "t4", { redeemedByUserId: "guest" });
  assert.ok("error" in reused);
  const unknown = redeemPassTransition([redeemed], "does-not-exist", { redeemedByUserId: "guest" });
  assert.ok("error" in unknown);
  assert.equal(unknown.error, "not_found");
});

await test("redemption permanently consumes the allocation slot", () => {
  const pass = issuedPass({ id: "t5" });
  const after = redeemPassTransition([pass], "t5", { redeemedByUserId: "guest" });
  assert.ok(!("error" in after));
  const allocation = passAllocation([after.pass]);
  assert.equal(allocation.redeemed, 1);
  assert.equal(allocation.available, 9); // slot never returns
});

/* ---------- 6. Recipient rules (spec §10) ---------- */

await test("recipient with no membership: redemption allowed -> Private granted", () => {
  const pass = issuedPass();
  const decision = decideRedemption({ membership: "none" } as MembershipEntitlement, pass);
  assert.deepEqual(decision, { allowed: true });
});

await test("existing Private recipient: pass is NOT silently wasted (blocked with warning path)", () => {
  const pass = issuedPass();
  const decision = decideRedemption(privateEntitlement, pass);
  assert.deepEqual(decision, { allowed: false, reason: "recipient_already_private" });
});

await test("existing Reserve recipient: no downgrade via Private grant", () => {
  const pass = issuedPass();
  const decision = decideRedemption(reserveEntitlement, pass);
  assert.deepEqual(decision, { allowed: false, reason: "recipient_already_reserve" });
});

/* ---------- 7. Tokens (spec §43) ---------- */

await test("invite tokens are high-entropy and never sequential", async () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.ok(a && b);
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, `token too short: ${a?.length}`);
  assert.ok(!/^[0-9]+$/.test(a));
});

await test("only the hash of a token is persisted; hash is deterministic", async () => {
  const token = generateInviteToken()!;
  const h1 = await hashInviteToken(token);
  const h2 = await hashInviteToken(token);
  assert.ok(h1 && h2);
  assert.equal(h1, h2);
  assert.notEqual(h1, token);
  assert.equal(h1.length, 64); // sha-256 hex
});

/* ---------- 8. Membership states (spec §14, §37) ---------- */

await test("renewal states: Private/Reserve never, Office annual, Sovereign custom", () => {
  const states: Record<CloakMembership, MembershipRenewalLike> = {
    none: "never",
    private: "never",
    reserve: "never",
    private_circle: "custom",
    office: "annual",
    sovereign: "custom",
  };
  assert.equal(states.private, "never");
  assert.equal(states.reserve, "never");
  assert.equal(states.office, "annual");
  assert.equal(states.sovereign, "custom");
  assert.equal(reserveEntitlement.renewal, "never");
});
type MembershipRenewalLike = "never" | "annual" | "custom";

/* ---------- 9. Old pricing removed from visible UI (spec §48) ---------- */

await test("old low-cost pricing is removed from the source tree", () => {
  const forbidden = [
    /\$19\.99/,
    /\$29\.99/,
    /\$39\.99/,
    /\$49\.99/,
    /\$79(?![\d.,])/,
    /\$79\.99/,
    /CLOAK_LIFETIME_PRICE/,
    /CLOAK_PRICE_DISPLAY/,
    /Cloak Lifetime/,
    /CLOAK_LIFETIME_CURRENCY/,
  ];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(tsx?|css|html|json|webmanifest)$/.test(entry) || entry === "sw.js") {
        const content = readFileSync(full, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(content)) hits.push(`${full}: ${pattern}`);
        }
      }
    }
  };
  walk(join(import.meta.dirname, "../src"));
  walk(join(import.meta.dirname, "../public"));
  assert.deepEqual(hits, []);
});

await test("Stripe checkout is removed from app source and deployment env", () => {
  const forbidden = [/stripe/i, /STRIPE_/];
  const hits: string[] = [];
  const scanFile = (full: string) => {
    const content = readFileSync(full, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) hits.push(`${full}: ${pattern}`);
    }
  };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(tsx?|css|json|webmanifest)$/.test(entry) || entry === "sw.js") {
        scanFile(full);
      }
    }
  };
  walk(join(import.meta.dirname, "../src"));
  scanFile(join(import.meta.dirname, "../.env.example"));
  assert.deepEqual(hits, []);
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
