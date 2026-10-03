-- Extend the existing Reserve grant registry to support Founding Adviser
-- Trusted Invites while preserving every existing Reserve allocation.
ALTER TABLE "GuestPass" ADD COLUMN "program" TEXT NOT NULL DEFAULT 'reserve';
DROP INDEX "GuestPass_ownerUserId_slotIndex_key";
CREATE UNIQUE INDEX "GuestPass_ownerUserId_program_slotIndex_key" ON "GuestPass"("ownerUserId", "program", "slotIndex");
DROP INDEX "GuestPass_ownerUserId_idx";
CREATE INDEX "GuestPass_ownerUserId_program_idx" ON "GuestPass"("ownerUserId", "program");

CREATE TABLE "TrustedInviteAdminEvent" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustedInviteAdminEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrustedInviteAdminEvent_ownerUserId_createdAt_idx" ON "TrustedInviteAdminEvent"("ownerUserId", "createdAt");
CREATE INDEX "TrustedInviteAdminEvent_actorUserId_idx" ON "TrustedInviteAdminEvent"("actorUserId");
ALTER TABLE "TrustedInviteAdminEvent" ADD CONSTRAINT "TrustedInviteAdminEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrustedInviteAdminEvent" ADD CONSTRAINT "TrustedInviteAdminEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
