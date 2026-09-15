-- Founding Adviser invitations and optional account email metadata.

ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "AdviserInvitation" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'founding_adviser',
  "recipientName" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "membershipSku" TEXT NOT NULL DEFAULT 'private',
  "membershipOrigin" TEXT NOT NULL DEFAULT 'founding_adviser',
  "tokenHash" TEXT NOT NULL,
  "emailBindingRequired" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "redeemedAt" TIMESTAMP(3),
  "redeemedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedByAdminId" TEXT,
  "internalNote" TEXT,

  CONSTRAINT "AdviserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdviserInvitationEvent" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "event" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdviserInvitationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdviserInvitation_tokenHash_key" ON "AdviserInvitation"("tokenHash");
CREATE INDEX "AdviserInvitation_status_expiresAt_idx" ON "AdviserInvitation"("status", "expiresAt");
CREATE INDEX "AdviserInvitation_recipientEmail_idx" ON "AdviserInvitation"("recipientEmail");
CREATE INDEX "AdviserInvitation_createdByAdminId_idx" ON "AdviserInvitation"("createdByAdminId");
CREATE INDEX "AdviserInvitation_redeemedByUserId_idx" ON "AdviserInvitation"("redeemedByUserId");
CREATE INDEX "AdviserInvitationEvent_invitationId_createdAt_idx" ON "AdviserInvitationEvent"("invitationId", "createdAt");
CREATE INDEX "AdviserInvitationEvent_actorUserId_idx" ON "AdviserInvitationEvent"("actorUserId");

ALTER TABLE "AdviserInvitation"
  ADD CONSTRAINT "AdviserInvitation_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdviserInvitation"
  ADD CONSTRAINT "AdviserInvitation_redeemedByUserId_fkey"
  FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdviserInvitation"
  ADD CONSTRAINT "AdviserInvitation_revokedByAdminId_fkey"
  FOREIGN KEY ("revokedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdviserInvitationEvent"
  ADD CONSTRAINT "AdviserInvitationEvent_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "AdviserInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdviserInvitationEvent"
  ADD CONSTRAINT "AdviserInvitationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
