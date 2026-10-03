/*
 * Guards the operator overview panel.
 *
 * What this exists to prevent — the ways an admin dashboard goes wrong on a
 * private messenger:
 *
 *  1. IT BECOMES A DIRECTORY. The server holds `Participation`, `Conversation`
 *     and `CircleMember` rows from which a social graph could be derived. The
 *     moment a metrics module reads one of those tables, "aggregate counts" is
 *     a description of the current UI rather than a property of the system —
 *     and the next feature request writes the graph out. So the assertion is
 *     on the *queries*: the module may not name those models at all.
 *
 *  2. IT BECOMES WRITE-CAPABLE. Entitlements come only from payment
 *     verification and invite redemption; removal is a data-owner power (the
 *     user over their own account, the circle owner over their own circle).
 *     A panel with a "grant" or "delete" button would contradict the product,
 *     so the absence of every mutation call is asserted structurally.
 *
 *  3. IT IS RENDERED BEFORE THE CHECK. `isAdminUser` is a doorway, not a gate:
 *     the page must decide authorization *before* it reads a single aggregate,
 *     and the API route must re-decide for itself rather than trusting the
 *     page that linked to it.
 *
 *  4. FIXTURES INFLATE THE NUMBERS. `@admin` is a real `User` row. Counting it
 *     as a signup is how a growth figure starts lying, so the operator and
 *     seeded-dev handles are subtracted — and the subtraction has to come from
 *     the same constants that decide access and seeding, or it drifts.
 *
 *  5. UNKNOWN GETS ATTRIBUTED TO SOMEONE. A NULL `membershipOrigin` used to
 *     answer `admin_grant`, which would have manufactured phantom operator
 *     grants in the one chart built to detect them. The honest answer is
 *     `unattributed`, and this suite pins both the type and the fallback.
 *
 * Run: node_modules/.bin/tsx scripts/verify-admin-overview.mts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { label: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  checks.push({
    label,
    pass: actual === expected,
    detail: `got ${String(actual)}, want ${String(expected)}`,
  });
}

/* Comments are stripped because these files carry prose describing the very
   defects being asserted against — a header comment naming `db.message` or
   `deleteMany` would otherwise satisfy a check on its own. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const metrics = stripComments(read("src/lib/cloak/server/admin-metrics.ts"));
const route = stripComments(read("src/app/api/admin/overview/route.ts"));
const page = stripComments(read("src/app/admin/page.tsx"));
const screen = stripComments(read("src/app/admin/overview-screen.tsx"));
const component = stripComments(read("src/components/cloak/admin/admin-overview.tsx"));
const gate = read("src/components/cloak/admin/admin-gate.tsx");
const invitationsScreen = stripComments(read("src/app/admin/invitations/invitations-admin-screen.tsx"));
const membershipServer = stripComments(read("src/lib/cloak/server/membership-server.ts"));
const types = stripComments(read("src/lib/cloak/types.ts"));
const settings = stripComments(read("src/components/cloak/settings/settings-page.tsx"));
const sw = read("public/sw.js");

const at = (haystack: string, needle: string): number => haystack.indexOf(needle);

/* ---------------- 1. aggregate only: the graph tables are never read -------- */

for (const model of ["message", "conversation", "participation", "circleMember", "blockedUser", "userPrivacySettings"]) {
  check(
    `the metrics module never reads db.${model} (social graph / content)`,
    new RegExp(`db\\.${model}\\b`).test(metrics),
    false
  );
}

check(
  "the metrics module never names ciphertext, message bodies or key material",
  /ciphertext|encryptedBody|identityKeyBackup|ConversationKeyWrap/.test(metrics),
  false
);

/* Asserted on the call's *content* rather than its exact formatting: the point
   is that the one per-row user read takes a timestamp and no identifying field,
   so a reformat must not be able to satisfy this while widening the select. */
const userFindMany = metrics.match(/db\.user\.findMany\(\{[^)]*\}\)/)?.[0] ?? "";

check(
  "the only per-row user read selects the signup timestamp and nothing else",
  userFindMany.length > 0 &&
    /select:\s*\{\s*createdAt:\s*true\s*\}/.test(userFindMany) &&
    !/handle|email|displayName|membershipTier|identity/.test(userFindMany),
  true
);

check(
  "the push reach figure is a distinct-account count, not a subscriber list",
  /distinct:\s*\["userId"\]/.test(metrics) && /pushAccountRows\.length/.test(metrics),
  true
);

/* ---------------- 2. read only: no mutation call exists -------------------- */

check(
  "the metrics module performs no create/update/upsert/delete of any kind",
  /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(metrics),
  false
);

check(
  "the metrics module runs no raw SQL and opens no transaction",
  /\$queryRaw|\$executeRaw|\$transaction/.test(metrics),
  false
);

check(
  "the metrics module does not import the erasure service",
  /account-lifecycle/.test(metrics),
  false
);

check(
  "the overview route exports GET and no mutating handler",
  /export async function GET/.test(route) &&
    !/export async function (POST|PUT|PATCH|DELETE)/.test(route),
  true
);

check(
  "the panel component is a server component (no client bundle)",
  /"use client"/.test(component),
  false
);

check(
  "the panel component renders no interactive control and issues no request",
  /onClick|onChange|onSubmit|<button|fetch\(/.test(component),
  false
);

check(
  "the shared admin gate is also a server component",
  /"use client"/.test(gate),
  false
);

/* ---------------- 3. authorization: decided before any data is read ------- */

check(
  "the API route resolves the session and re-checks isAdminUser itself",
  /getSessionUser\(req\)/.test(route) && /isAdminUser\(user\)/.test(route),
  true
);

check(
  "the API route distinguishes unauthenticated (401) from forbidden (403)",
  /status:\s*user\s*\?\s*403\s*:\s*401/.test(route),
  true
);

check(
  "the API route rate-limits through the shared bucket implementation",
  /checkOverviewRateLimit\(/.test(route) && /new RateLimitBuckets\(\)/.test(metrics),
  true
);

check(
  "the API route never caches an operator payload",
  /adviserNoStoreHeaders\(\)/.test(route),
  true
);

check(
  "the page screen checks isAdminUser BEFORE it reads any aggregate",
  at(screen, "if (!isAdminUser(user))") >= 0 &&
    at(screen, "if (!isAdminUser(user))") < at(screen, "await getAdminOverview()"),
  true
);

check(
  "the page screen renders the shared gate on the negative branch",
  /if \(!isAdminUser\(user\)\)\s*\{\s*return <AdminGate \/>;/.test(screen),
  true
);

check(
  "the invitations screen renders the same shared gate (no duplicated copy)",
  /<AdminGate \/>/.test(invitationsScreen) && /Admin access required/.test(invitationsScreen),
  false
);

check(
  "the page is marked noindex and forces dynamic rendering",
  /index:\s*false/.test(page) && /dynamic = "force-dynamic"/.test(page),
  true
);

/* ---------------- 4. fixtures are not users ------------------------------- */

check(
  "operator handles come from the same env var that decides admin access",
  /import \{ adminHandles \} from "@\/lib\/cloak\/server\/adviser-invitations"/.test(metrics) &&
    /adminHandles\(\)/.test(metrics),
  true
);

check(
  "seeded dev identities are subtracted too",
  /DEV_ACCOUNT_HANDLES/.test(metrics) &&
    /import \{ DEV_ACCOUNT_HANDLES \} from "@\/lib\/cloak\/server\/auth"/.test(metrics),
  true
);

check(
  "the excluded rows are counted and reported, not silently dropped",
  /db\.user\.count\(\{\s*where:\s*\{\s*handle:\s*\{\s*in:\s*reserved\s*\}\s*\}\s*\}\)/.test(metrics) &&
    /counted:\s*totalUsers - excludedUsers/.test(metrics),
  true
);

check(
  "the signup trend buckets whole UTC days so it cannot shift by hour",
  /Math\.floor\(\(nowMs - \(TREND_DAYS - 1\) \* DAY_MS\) \/ DAY_MS\) \* DAY_MS/.test(metrics),
  true
);

/* ---------------- 5. an unrecorded origin is not an operator grant -------- */

check(
  "the entitlement fallback no longer answers admin_grant for a NULL origin",
  /user\.membershipOrigin \?\? "unattributed"/.test(membershipServer) &&
    !/user\.membershipOrigin \?\? "admin_grant"/.test(membershipServer),
  true
);

check(
  "MembershipOrigin has a first-class unattributed member",
  /\|\s*"unattributed"/.test(types),
  true
);

check(
  "the panel reports a NULL origin as unattributed, not as a grant",
  /row\.membershipOrigin \?\? "unattributed"/.test(metrics) &&
    !/row\.membershipOrigin \?\? "admin_grant"/.test(metrics),
  true
);

check(
  "the origin chart is restricted to entitled accounts so NULL means unrecorded",
  /where:\s*\{\s*membershipTier:\s*\{\s*not:\s*null\s*\}\s*\}/.test(metrics),
  true
);

/* ---------------- 6. the absence is stated, not merely true --------------- */

check(
  "the panel names what it deliberately omits",
  /Deliberately absent/.test(component) &&
    /who talks to whom/.test(component) &&
    /per-account message counts/.test(component),
  true
);

check(
  "the panel states that it performs no actions",
  /performs no actions/.test(component),
  true
);

check(
  "the tier chart prints the denominator beside the proportion",
  /hold a tier/.test(component),
  true
);

/* ---------------- 7. reachable, and cache-busted ------------------------- */

check(
  "Settings links to the overview with a real anchor (it is outside the hash router)",
  /<a href="\/admin">Open overview<\/a>/.test(settings),
  true
);

check(
  "the invitations screen links back to the overview",
  /href="\/admin"/.test(read("src/components/cloak/admin/adviser-invitations-admin.tsx")),
  true
);

check("the service worker version was bumped for the new client bundle", /cloak-shell-v46/.test(sw), true);

/* ------------------------------- report ----------------------------- */

let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`PASS  ${c.label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.label}  (${c.detail})`);
  }
}
console.log(`\n=== ${checks.length - failed}/${checks.length} admin-overview checks passed ===`);
process.exit(failed === 0 ? 0 : 1);
