-- Encrypted attachment payloads: the transport that lets a voice note (or file,
-- or image) actually reach the recipient.
--
-- Until now attachment bytes lived ONLY in the recording device's IndexedDB and
-- only metadata travelled, so a recipient could be told the duration of a note
-- but never hear it. This table carries the payload — as CIPHERTEXT.
--
-- The client seals the blob with a key derived from the conversation root key
-- (HKDF info `cloak/blob/`, AAD bound to conversation + attachment id), so the
-- server stores bytes it cannot decrypt. There is no plaintext column here on
-- purpose; do not add one.
--
-- Cascade deletes: a blob cannot outlive its conversation or its author.
-- `expiresAt` is retention, stamped from the conversation's ghost TTL when one
-- is set, so a vanishing message does not leave its media behind.

-- CreateTable
CREATE TABLE "AttachmentBlob" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AttachmentBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttachmentBlob_conversationId_idx" ON "AttachmentBlob"("conversationId");

-- CreateIndex
CREATE INDEX "AttachmentBlob_expiresAt_idx" ON "AttachmentBlob"("expiresAt");

-- AddForeignKey
ALTER TABLE "AttachmentBlob" ADD CONSTRAINT "AttachmentBlob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentBlob" ADD CONSTRAINT "AttachmentBlob_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
