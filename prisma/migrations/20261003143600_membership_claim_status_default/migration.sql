-- MembershipClaim.status: make the database agree with schema.prisma.
--
-- `20260913120000_init_postgres` created this column with DEFAULT 'redeemed',
-- but schema.prisma declares @default("issued"). The schema file was edited
-- without a migration, so the two have disagreed ever since.
--
-- It has never been exercised, because both call sites pass `status`
-- explicitly — `payments/verify` writes "issued" when a payment lands before an
-- account exists, and "redeemed" when it is consumed immediately. That is
-- exactly why it is worth fixing now: a future `membershipClaim.create()`
-- written without `status` would silently produce a claim marked REDEEMED that
-- was never redeemed, and nothing would flag it.
--
-- 'issued' is the safe default: an unconsumed claim must not read as consumed.
-- This is a default change on a table with zero rows, so it is instant and
-- non-blocking in Postgres (no table rewrite).

ALTER TABLE "MembershipClaim" ALTER COLUMN "status" SET DEFAULT 'issued';
