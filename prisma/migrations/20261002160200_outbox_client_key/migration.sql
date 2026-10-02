-- Idempotent sends: the key that makes retrying a timed-out message safe.
--
-- The offline outbox retries a send it could not confirm. A TIMEOUT is the
-- dangerous case: it does not tell us whether the server committed the message,
-- so a blind retry can duplicate it. The sending client therefore mints a key
-- per message and the route treats a second POST carrying the same key as the
-- SAME message — it returns the original row rather than creating another.
--
-- Nullable on purpose. Every message written before this migration has no key,
-- and Postgres permits any number of NULLs under a unique index, so the
-- constraint costs nothing on historical rows and only binds new ones.
--
-- The key is NOT a secret and is NOT trusted: the route only ever uses it to
-- look a message up, and it verifies that the row it finds belongs to the same
-- conversation AND the same author before replaying it. Without that check a
-- guessed key would leak another conversation's message.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_clientKey_key" ON "Message"("clientKey");
