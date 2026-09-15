import webpush from "web-push";
import { db } from "@/lib/db";

/*
 * Web Push transport (spec §62) — the out-of-app layer for structural
 * events, delivered by the push service to the OS notification surface
 * (lock screen / notification shade) while Cloaq is closed.
 *
 * Discipline (mirrors notify.ts and the §63 audit rule):
 * - STRUCTURAL copy only. The server is E2EE-blind: it never sees message
 *   content, so a push can never leak it. Sender names and previews are a
 *   device-side Cloaq Mode decision the server cannot evaluate — pushes
 *   carry exactly the title/body the in-app inbox stores, which is
 *   membership/role/policy copy by construction.
 * - Failure posture: a push failure NEVER throws into the caller and
 *   never rolls back the membership change it observes.
 * - Delivery unit is the SUBSCRIPTION (one row per browser/device): a
 *   person with a laptop and a phone gets both surfaces notified.
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.warn("[push] VAPID keys missing — web push disabled (in-app inbox still works)");
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

/** The public key clients need to subscribe (safe to expose — it is public). */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  type: string;
  title: string;
  body?: string;
  circleId?: string;
  groupId?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Fan a payload out to every device the user has subscribed. Never throws. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    if (!ensureConfigured()) return;
    const rows: SubscriptionRow[] = await db.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (rows.length === 0) return;

    const body = JSON.stringify(payload);
    // Notifications are actionable the moment they arrive but stale
    // membership news is worthless — 1 hour TTL keeps the queue honest.
    const dead: string[] = [];

    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            body,
            { TTL: 3600 }
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          console.warn(`[push] send failed endpoint=${row.endpoint.slice(-10)} status=${status} msg=${(err as Error).message?.slice(0, 120)}`);
          // 404/410 = the subscription is gone (browser unregistered,
          // permission revoked, profile wiped) — prune it. Any other
          // failure (network blip, 5xx from the push service) is retried
          // by nobody; that is acceptable for structural events.
          if (status === 404 || status === 410) dead.push(row.id);
        }
      })
    );

    if (dead.length > 0) {
      await db.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    }
  } catch {
    // Never break the parent operation because a push failed.
  }
}

export interface SubscribeInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

/** Idempotent upsert — re-subscribing the same device rewrites its keys. */
export async function addPushSubscription(input: SubscribeInput): Promise<void> {
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    update: {
      userId: input.userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** How many devices this person has registered (settings page display). */
export async function countPushSubscriptions(userId: string): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}
