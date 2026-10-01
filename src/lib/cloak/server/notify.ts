import { db } from "@/lib/db";
import { sendPushToUser } from "./push";

/*
 * Server-side notification engine (groups & circles spec §62).
 *
 * Scope: STRUCTURAL events only — membership, roles, policy, join
 * requests. Notification copy never carries message content, AI prompts,
 * or cryptographic material (the §63 audit discipline applies here too).
 *
 * One exception, and it is push-only: notifyNewMessage (round 23) sends the
 * OS notification for a chat message without writing an in-app row. The
 * structural inbox stays structural; see that function for the copy rules.
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

/**
 * New-message push (round 23) — the OS surface for a chat message.
 *
 * Deliberately NOT routed through notifyUser. That engine IS the structural
 * inbox: it writes a UserNotification row per event, and one row per chat
 * message would turn the notifications centre into a second, worse message
 * list. A new message is therefore a PUSH-ONLY event — no inbox row.
 *
 * Copy discipline: the server is E2EE-blind, so there is no content to send
 * — and no sender name either. Cloak Mode is a device-side setting that can
 * hide previews, and the server cannot evaluate it, so anything identifying
 * would leak past a privacy mode the user believes is on. The notification
 * says only that a message exists; the recipient opens the app to find out
 * who and what. (`conversationId` travels for the device-side collapse key
 * only — see sw.js tagFor.)
 *
 * Never throws: sendPushToUser already absorbs its own failures, and a push
 * must never break the send that triggered it.
 */
export async function notifyNewMessage(input: {
  userId: string;
  conversationId: string;
}): Promise<void> {
  try {
    await sendPushToUser(input.userId, {
      type: "message.new",
      title: "New message",
      body: "Open Cloak Dagger to read it",
      conversationId: input.conversationId,
    });
  } catch {
    // Nothing to do — see the contract above.
  }
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
