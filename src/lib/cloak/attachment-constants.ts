/*
 * Attachment limits shared by the server routes AND the client-side cache.
 *
 * Dependency-free on purpose. `attachments.ts` imports Prisma for the lazy
 * purge, so a client module (the local cache) importing the constants from
 * there would drag the database client into the browser bundle.
 */

/**
 * Ceiling on ONE encrypted payload, measured after encryption.
 *
 * 8 MB is deliberately generous for voice notes: at the composer's 32 kbps opus
 * the 300 s recording cap is ~1.2 MB, so this leaves room for images without
 * letting a single request become a storage or memory problem. Uploads over the
 * cap fail loudly and fall back to the metadata-only state rather than being
 * silently truncated.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Retention for a blob whose conversation sets no ghost TTL. */
export const ATTACHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Client-minted attachment ids (UUIDv4 from `crypto.randomUUID`). */
export const ATTACHMENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
