import { db } from "@/lib/db";

/*
 * Attachment transport limits.
 *
 * These live here rather than in a route module because Next.js validates the
 * exports of `route.ts` — an extra `export const` there is a build error.
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

/**
 * Lazy purge, the same shape as `purgeExpiredMessages`: called on the
 * attachment paths rather than from a timer, because a serverless deployment
 * has nowhere to run a timer. The `expiresAt` index makes it a range scan, so
 * it stays cheap even as the table grows.
 */
export async function purgeExpiredAttachments(): Promise<void> {
  await db.attachmentBlob.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
