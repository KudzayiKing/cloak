-- Payment-first onboarding:
-- - PaymentRequest.userId becomes nullable so new customers can pay before
--   creating a Cloak ID.
-- - MembershipClaim receives a one-time setup token for post-payment account
--   creation. The raw token is never stored.

ALTER TABLE "PaymentRequest" DROP CONSTRAINT IF EXISTS "PaymentRequest_userId_fkey";

ALTER TABLE "PaymentRequest" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "MembershipClaim"
  ADD COLUMN "setupTokenHash" TEXT,
  ADD COLUMN "setupExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "MembershipClaim_paymentRequestId_key"
  ON "MembershipClaim"("paymentRequestId");

CREATE UNIQUE INDEX "MembershipClaim_setupTokenHash_key"
  ON "MembershipClaim"("setupTokenHash");

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
