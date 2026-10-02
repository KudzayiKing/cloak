import { db } from "@/lib/db";

/*
 * Attachment transport limits.
 *
 * These live here rather than in a route module because Next.js validates the
 * exports of `route.ts` — an extra `export const` there is a build error.
 *
 * The values themselves now live in `attachment-constants.ts`, which has no
 * dependencies, so the CLIENT-side cache can import the same numbers without
 * pulling this module's Prisma client into the browser bundle. They are
 * re-exported here so every existing server import keeps working.
 */

export {
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_TTL_MS,
  ATTACHMENT_ID_RE,
} from "./attachment-constants";

/**
 * Lazy purge, the same shape as `purgeExpiredMessages`: called on the
 * attachment paths rather than from a timer, because a serverless deployment
 * has nowhere to run a timer. The `expiresAt` index makes it a range scan, so
 * it stays cheap even as the table grows.
 */
export async function purgeExpiredAttachments(): Promise<void> {
  await db.attachmentBlob.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
