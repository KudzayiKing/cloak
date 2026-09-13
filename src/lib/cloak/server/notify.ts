import { db } from "@/lib/db";
import { sendPushToUser } from "./push";

/*
 * Server-side notification engine (groups & circles spec §62).
 *
 * Scope: STRUCTURAL events only — membership, roles, policy, join
 * requests. Notification copy never carries message content, AI prompts,
 * or cryptographic material (the §63 audit discipline applies here too).
 *
 * Two transports, one copy source:
 * - In-app row (UserNotification) — rendered by the notifications centre.
 * - Web Push (PushSubscription) — OS notification surface while the app
 *   is closed. Same structural copy; the server is E2EE-blind so push
 *   can never leak message content, and device-side Cloak Mode stays a
 *   device-side decision.
 *
 * Failure posture: notifyUser NEVER throws into its caller. A broken
 * notification (either transport) must not roll back the membership
 * change it observes.
 */

export type NotificationType =
  | "circle.added"
  | "circle.removed"
  | "circle.role_changed"
  | "circle.policy_changed"
  | "circle.join_requested"
  | "circle.join_approved"
  | "circle.join_denied"
  | "group.added"
  | "group.removed"
  | "group.join_approved";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  circleId?: string;
  groupId?: string;
  actorName?: string;
}

export async function notifyUser(input: NotifyInput): Promise<void> {
  try {
    await db.userNotification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        circleId: input.circleId ?? null,
        groupId: input.groupId ?? null,
        actorName: input.actorName ?? null,
      },
    });
    // Web-push fan-out for the same event. sendPushToUser absorbs its own
    // failures (and prunes dead subscriptions), so this never throws.
    await sendPushToUser(input.userId, {
      type: input.type,
      title: input.title,
      body: input.body,
      circleId: input.circleId,
      groupId: input.groupId,
    });
  } catch {
    // Never break the parent operation because a notification failed.
  }
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, "userId">): Promise<void> {
  const unique = [...new Set(userIds)];
  await Promise.all(unique.map((userId) => notifyUser({ ...input, userId })));
}

/* ---------- Payload shape for the notifications centre ---------- */

export interface ServerNotificationPayload {
  id: string;
  type: string;
  title: string;
  body?: string;
  circleId?: string;
  groupId?: string;
  actorName?: string;
  read: boolean;
  createdAt: number;
}

export async function listNotifications(userId: string, take = 100): Promise<ServerNotificationPayload[]> {
  const rows = await db.userNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" as const },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? undefined,
    circleId: r.circleId ?? undefined,
    groupId: r.groupId ?? undefined,
    actorName: r.actorName ?? undefined,
    read: !!r.readAt,
    createdAt: r.createdAt.getTime(),
  }));
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return db.userNotification.count({ where: { userId, readAt: null } });
}

/** Mark one notification, or everything when id is omitted. */
export async function markNotificationsRead(userId: string, id?: string): Promise<void> {
  await db.userNotification.updateMany({
    where: { userId, ...(id ? { id } : {}), readAt: null },
    data: { readAt: new Date() },
  });
}
