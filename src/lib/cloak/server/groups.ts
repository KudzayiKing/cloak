import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { notifyMany, notifyUser } from "./notify";
import { assertDirectedAddAllowed, BlockOperationError as BlockOpErr } from "./blocks";

/*
 * Server-side group engine (groups & circles spec §4-§12, §58, §80).
 *
 * Everything here is backend-authoritative: membership, roles, invite
 * status, join approvals and revocation live in the database — the client
 * mirrors state but never decides it (spec §80).
 *
 * v1 role model (spec §6 — deliberately small):
 *   owner  — full control incl. roles, transfer, removal
 *   admin  — invite, approve joins, remove ordinary members
 *   member — send messages, leave
 */

export type GroupRole = "owner" | "admin" | "member";

export type GroupPermission =
  | "group.message.send"
  | "group.member.invite"
  | "group.member.remove"
  | "group.member.approve"
  | "group.role.manage"
  | "group.settings.manage"
  | "group.invite.manage"
  | "group.leave";

/** Capability matrix (spec §7) — never scatter role checks through routes. */
export function canGroup(role: GroupRole, permission: GroupPermission): boolean {
  switch (permission) {
    case "group.message.send":
    case "group.leave":
      return true; // every role may speak and leave
    case "group.member.invite":
    case "group.member.approve":
    case "group.invite.manage":
      return role === "owner" || role === "admin";
    case "group.member.remove":
      return role === "owner" || role === "admin";
    case "group.role.manage":
    case "group.settings.manage":
      return role === "owner";
    default:
      return false;
  }
}

/** Entitlement-tier group limits (spec §58). Numbers are config defaults.
 *  Keyed by the CURRENT tier vocabulary — "black" was renamed "reserve"
 *  (Task 27); Reserve owners previously fell through to Private limits. */
export const GROUP_LIMITS = {
  none: { maxGroupsOwned: 0, maxMembersPerGroup: 0 },
  private: { maxGroupsOwned: 20, maxMembersPerGroup: 50 },
  reserve: { maxGroupsOwned: 100, maxMembersPerGroup: 200 },
  private_circle: { maxGroupsOwned: 250, maxMembersPerGroup: 500 },
  office: { maxGroupsOwned: 250, maxMembersPerGroup: 500 },
  sovereign: { maxGroupsOwned: 250, maxMembersPerGroup: 500 },
} as const;

export type MembershipTier = keyof typeof GROUP_LIMITS;

export function limitsForTier(tier: string | null | undefined) {
  return GROUP_LIMITS[(tier ?? "private") as MembershipTier] ?? GROUP_LIMITS.private;
}

/* ---------- Payload shapes (client contract) ---------- */

export interface GroupMemberPayload {
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  role: GroupRole;
  joinedAt: number;
  isYou: boolean;
}

export interface GroupJoinRequestPayload {
  id: string;
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  createdAt: number;
}

export interface GroupInvitePayload {
  id: string;
  type: string;
  status: string;
  maxUses: number | null;
  useCount: number;
  requiresApproval: boolean;
  expiresAt: number | null;
  createdAt: number;
  /** Present only right after creation — the raw token is never stored. */
  token?: string;
  url?: string;
}

export function initialsOfName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function roleOf(role: string | null | undefined): GroupRole {
  return role === "owner" || role === "admin" ? role : "member";
}

/* ---------- Internals ---------- */

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateGroupInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Append an audit-style system message; never throws into the caller. */
export async function addSystemMessage(conversationId: string, body: string): Promise<void> {
  await db.message.create({
    data: { conversationId, authorId: null, kind: "system", body },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

export async function getParticipation(conversationId: string, userId: string) {
  return db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const p = await getParticipation(conversationId, userId);
  return !!p;
}

export async function conversationById(conversationId: string) {
  return db.conversation.findUnique({
    where: { id: conversationId },
    include: { participations: { include: { user: true } }, circle: { select: { id: true, name: true, aiDefault: true } } },
  });
}

/** Load members as the client contract expects. */
export function mapMembers(
  participations: { userId: string; role: string; createdAt: Date; user: { id: string; handle: string; displayName: string } }[],
  viewerId: string
): GroupMemberPayload[] {
  return participations
    .map((p) => ({
      userId: p.userId,
      name: p.user.displayName,
      cloakId: `@${p.user.handle}`,
      avatarInitials: initialsOfName(p.user.displayName),
      role: roleOf(p.role),
      joinedAt: p.createdAt.getTime(),
      isYou: p.userId === viewerId,
    }))
    .sort((a, b) => {
      const order = { owner: 0, admin: 1, member: 2 } as const;
      if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
      return a.joinedAt - b.joinedAt;
    });
}

/** Resolve a list of "@handles" (or bare handles) to existing users. */
export async function resolveHandles(handles: string[]) {
  const normalized = [
    ...new Set(
      handles
        .map((h) => h.trim().replace(/^@+/, "").toLowerCase())
        .filter((h) => h.length > 0 && h.length <= 64)
    ),
  ];
  if (normalized.length === 0) return { users: [], unknown: [] as string[] };
  const users = await db.user.findMany({ where: { handle: { in: normalized } } });
  const found = new Set(users.map((u) => u.handle));
  return { users, unknown: normalized.filter((h) => !found.has(h)) };
}

/* ---------- Mutations ---------- */

export class GroupOperationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function createGroup(params: {
  creatorId: string;
  creatorName: string;
  title: string;
  description?: string;
  memberIds: string[];
  tier: string | null | undefined;
  /** Ghost group: TTL seconds for messages sent while the mode is on. */
  ghostSeconds?: number;
  /** History-sharing policy (spec §11/§38): circle-created groups inherit
   *  the circle default; standalone groups keep the "none" default. */
  historyPolicy?: "none" | "all";
  /** Group AI permission (spec §64): creator's §74 default for standalone
   *  groups; circle groups inherit the circle policy instead (§44). */
  aiAccess?: "allowed" | "blocked";
}) {
  const limits = limitsForTier(params.tier);

  const owned = await db.conversation.count({
    where: { isGroup: true, ownerId: params.creatorId },
  });
  if (owned >= limits.maxGroupsOwned) {
    throw new GroupOperationError("group_limit_reached");
  }

  const memberIds = [...new Set(params.memberIds.filter((id) => id !== params.creatorId))];
  if (memberIds.length + 1 > limits.maxMembersPerGroup) {
    throw new GroupOperationError("member_limit_reached");
  }

  const conversation = await db.conversation.create({
    data: {
      isGroup: true,
      title: params.title,
      description: params.description ?? null,
      ownerId: params.creatorId,
      historyPolicy: params.historyPolicy ?? "none", // spec §11 default
      aiAccess: params.aiAccess ?? "allowed",
      ...(params.ghostSeconds ? { ghostSeconds: params.ghostSeconds } : {}),
    },
  });

  await db.participation.create({
    data: { conversationId: conversation.id, userId: params.creatorId, role: "owner" },
  });
  if (memberIds.length > 0) {
    await db.participation.createMany({
      data: memberIds.map((userId) => ({
        conversationId: conversation.id,
        userId,
        role: "member",
        // Members added at creation were chosen by the owner — they see the
        // conversation from its beginning, exactly like the owner does.
        historyFrom: new Date(Date.now() - 1000),
      })),
    });
  }

  await addSystemMessage(conversation.id, `${params.creatorName} created the group`);
  return conversation;
}

export async function addMembers(params: {
  conversationId: string;
  actorId: string;
  actorName: string;
  userIds: string[];
}) {
  const conv = await conversationById(params.conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");

  const limits = limitsForTier(null); // v1: single dev tier — generous default
  const active = conv.participations.filter((p) => !p.removedAt);
  if (active.length + params.userIds.length > limits.maxMembersPerGroup) {
    throw new GroupOperationError("member_limit_reached");
  }

  const existing = new Set(active.map((p) => p.userId));
  const toAdd = [...new Set(params.userIds)].filter((id) => !existing.has(id));

  /* §75/§74 enforcement (all-or-nothing): every directed add must pass the
     target's block state and invite policy BEFORE any membership row is
     written. Callers surface a single generic refusal — never which. */
  for (const userId of toAdd) {
    try {
      await assertDirectedAddAllowed({
        actorId: params.actorId,
        targetUserId: userId,
        kind: conv.circleId ? "circle" : "group",
        ...(conv.circleId ? { circleId: conv.circleId } : {}),
      });
    } catch (err) {
      /* Bridge to the engine's error vocabulary so routes map it. */
      if (err instanceof BlockOpErr) throw new GroupOperationError("invite_not_allowed");
      throw err;
    }
  }

  for (const userId of toAdd) {
    const historyFrom = conv.historyPolicy === "all" ? null : new Date();
    const prev = conv.participations.find((p) => p.userId === userId);
    if (prev) {
      // Re-joining former member: fresh identity, fresh history window.
      await db.participation.update({
        where: { id: prev.id },
        data: { removedAt: null, role: "member", historyFrom, lastReadAt: null, lastDeliveredAt: null },
      });
    } else {
      await db.participation.create({
        data: { conversationId: conv.id, userId, role: "member", historyFrom },
      });
    }
  }

  if (toAdd.length > 0) {
    const users = await db.user.findMany({ where: { id: { in: toAdd } } });
    const names = users.map((u) => u.displayName).join(", ");
    await addSystemMessage(
      conv.id,
      toAdd.length === 1
        ? `${params.actorName} added ${names}`
        : `${params.actorName} added ${names}`
    );
    /* §62 "Group added": the added person learns where they now are. */
    await notifyMany(toAdd, {
      type: "group.added",
      title: `${params.actorName} added you to ${conv.title ?? "a group"}`,
      body: conv.circle?.name ? `Circle: ${conv.circle.name}` : undefined,
      groupId: conv.id,
      actorName: params.actorName,
    });
  }
  return toAdd.length;
}

export async function removeMember(params: {
  conversationId: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
}) {
  const conv = await conversationById(params.conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");

  const target = conv.participations.find((p) => p.userId === params.targetUserId && !p.removedAt);
  if (!target) throw new GroupOperationError("not_a_member");
  if (target.role === "owner") throw new GroupOperationError("cannot_remove_owner");

  await db.participation.update({
    where: { id: target.id },
    data: { removedAt: new Date() },
  });
  // Revocation includes pending invites the removed member could misuse.
  await db.groupInvite.updateMany({
    where: { conversationId: conv.id, createdByUserId: params.targetUserId, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  // E2EE: strip every conversation-key wrap addressed to the removed
  // member. The actor's client rotates the key right after, so future
  // traffic is unreadable to them regardless.
  await db.conversationKeyWrap.deleteMany({
    where: { conversationId: conv.id, userId: params.targetUserId },
  });

  const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
  await addSystemMessage(conv.id, `${params.actorName} removed ${targetUser?.displayName ?? "a member"}`);
  /* §62 "Removed from group". */
  await notifyUser({
    userId: params.targetUserId,
    type: "group.removed",
    title: `${params.actorName} removed you from ${conv.title ?? "a group"}`,
    groupId: conv.id,
    actorName: params.actorName,
  });
}

export async function leaveGroup(conversationId: string, userId: string, userName: string) {
  const conv = await conversationById(conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");

  const mine = conv.participations.find((p) => p.userId === userId && !p.removedAt);
  if (!mine) throw new GroupOperationError("not_a_member");

  const active = conv.participations.filter((p) => !p.removedAt);
  if (mine.role === "owner" && active.length > 1) {
    // Ownership must move before leaving (spec §76).
    throw new GroupOperationError("transfer_ownership_first");
  }

  await db.participation.update({ where: { id: mine.id }, data: { removedAt: new Date() } });
  await db.groupInvite.updateMany({
    where: { conversationId: conv.id, createdByUserId: userId, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  // E2EE: the leaver loses access to every wrap addressed to them; the
  // remaining members' client rotates the key so future traffic excludes
  // them cryptographically.
  await db.conversationKeyWrap.deleteMany({
    where: { conversationId: conv.id, userId },
  });
  await addSystemMessage(conv.id, `${userName} left`);

  // Last person out archives the group record by leaving it empty (kept for audit).
}

export async function setMemberRole(params: {
  conversationId: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  role: GroupRole;
}) {
  const conv = await conversationById(params.conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");

  const target = conv.participations.find((p) => p.userId === params.targetUserId && !p.removedAt);
  if (!target) throw new GroupOperationError("not_a_member");

  if (params.role === "owner") {
    // Ownership transfer (spec §76): current owner promotes target, then steps down.
    const mine = conv.participations.find((p) => p.userId === params.actorId);
    if (mine?.role !== "owner") throw new GroupOperationError("forbidden");
    if (params.targetUserId === params.actorId) throw new GroupOperationError("forbidden");
    await db.participation.update({ where: { id: mine.id }, data: { role: "admin" } });
    await db.participation.update({ where: { id: target.id }, data: { role: "owner" } });
    await db.conversation.update({
      where: { id: conv.id },
      data: { ownerId: params.targetUserId },
    });
    const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
    await addSystemMessage(conv.id, `${params.actorName} made ${targetUser?.displayName ?? "a member"} the owner`);
    return;
  }

  const mine = await getParticipation(conv.id, params.actorId);
  if (roleOf(mine?.role) !== "owner") throw new GroupOperationError("forbidden");
  if (target.role === "owner") throw new GroupOperationError("cannot_change_owner_role");

  await db.participation.update({ where: { id: target.id }, data: { role: params.role } });
  const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
  const label = params.role === "admin" ? "an admin" : "a member";
  await addSystemMessage(conv.id, `${params.actorName} made ${targetUser?.displayName ?? "a member"} ${label}`);
}

export async function renameGroup(params: {
  conversationId: string;
  actorId: string;
  title: string;
}) {
  const conv = await conversationById(params.conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");
  const mine = conv.participations.find((p) => p.userId === params.actorId && !p.removedAt);
  if (!mine) throw new GroupOperationError("forbidden");

  const oldTitle = conv.title ?? "Group";
  await db.conversation.update({
    where: { id: conv.id },
    data: { title: params.title, updatedAt: new Date() },
  });
  const actor = await db.user.findUnique({ where: { id: params.actorId } });
  await addSystemMessage(conv.id, `${actor?.displayName ?? "Someone"} renamed the group from ${oldTitle} to ${params.title}`);
}

/* ---------- Invites (spec §8-§10) ---------- */

export async function createGroupInvite(params: {
  conversationId: string;
  createdByUserId: string;
  type?: "link" | "qr" | "single_use";
  maxUses?: number | null;
  expiresInDays?: number | null;
  requiresApproval?: boolean;
}): Promise<{ invite: NonNullable<Awaited<ReturnType<typeof db.groupInvite.findUnique>>>; token: string }> {
  const token = generateGroupInviteToken();
  const expiresAt =
    params.expiresInDays && params.expiresInDays > 0
      ? new Date(Date.now() + params.expiresInDays * 24 * 3600 * 1000)
      : null;
  const invite = await db.groupInvite.create({
    data: {
      conversationId: params.conversationId,
      createdByUserId: params.createdByUserId,
      tokenHash: hashInviteToken(token),
      type: params.type ?? "link",
      status: "active",
      maxUses: params.maxUses ?? null,
      requiresApproval: params.requiresApproval ?? false,
      expiresAt,
    },
  });
  return { invite, token };
}

export function inviteEffectiveStatus(invite: {
  status: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}): "active" | "redeemed" | "expired" | "revoked" {
  if (invite.status === "revoked") return "revoked";
  if (invite.status === "redeemed") return "redeemed";
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return "expired";
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return "expired";
  return invite.status === "active" ? "active" : (invite.status as "expired");
}

export async function markInviteUse(inviteId: string) {
  const invite = await db.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite) return;
  const useCount = invite.useCount + 1;
  const exhausted = invite.maxUses !== null && useCount >= invite.maxUses;
  await db.groupInvite.update({
    where: { id: inviteId },
    data: { useCount, status: exhausted ? "redeemed" : invite.status },
  });
}

/** Join a group through an invite; enforces approval + history policy. */
export async function joinThroughInvite(params: {
  invite: { id: string; conversationId: string; requiresApproval: boolean };
  userId: string;
  userName: string;
}): Promise<"joined" | "requested"> {
  const conv = await conversationById(params.invite.conversationId);
  if (!conv || !conv.isGroup) throw new GroupOperationError("not_found");

  const active = conv.participations.filter((p) => !p.removedAt);
  const limits = limitsForTier(null);
  if (active.length >= limits.maxMembersPerGroup) throw new GroupOperationError("member_limit_reached");

  const prev = conv.participations.find((p) => p.userId === params.userId);
  if (prev && !prev.removedAt) throw new GroupOperationError("already_member");

  if (params.invite.requiresApproval) {
    const existingRequest = await db.groupJoinRequest.findUnique({
      where: { conversationId_userId: { conversationId: conv.id, userId: params.userId } },
    });
    if (existingRequest?.status === "pending") throw new GroupOperationError("request_pending");
    if (existingRequest?.status === "approved") throw new GroupOperationError("already_member");
    await db.groupJoinRequest.upsert({
      where: { conversationId_userId: { conversationId: conv.id, userId: params.userId } },
      update: { status: "pending", inviteId: params.invite.id, resolvedAt: null, resolvedByUserId: null },
      create: { conversationId: conv.id, userId: params.userId, inviteId: params.invite.id },
    });
    return "requested";
  }

  const historyFrom = conv.historyPolicy === "all" ? null : new Date();
  if (prev) {
    await db.participation.update({
      where: { id: prev.id },
      data: { removedAt: null, role: "member", historyFrom, lastReadAt: null, lastDeliveredAt: null },
    });
  } else {
    await db.participation.create({
      data: { conversationId: conv.id, userId: params.userId, role: "member", historyFrom },
    });
  }
  await markInviteUse(params.invite.id);
  await addSystemMessage(conv.id, `${params.userName} joined via invite`);
  return "joined";
}

export async function resolveJoinRequest(params: {
  conversationId: string;
  requestId: string;
  actorId: string;
  actorName: string;
  approve: boolean;
}): Promise<"approved" | "declined"> {
  const request = await db.groupJoinRequest.findUnique({
    where: { id: params.requestId },
    include: { user: true },
  });
  if (!request || request.conversationId !== params.conversationId) {
    throw new GroupOperationError("not_found");
  }
  if (request.status !== "pending") throw new GroupOperationError("not_pending");

  if (params.approve) {
    const conv = await conversationById(params.conversationId);
    const limits = limitsForTier(null);
    const active = conv?.participations.filter((p) => !p.removedAt) ?? [];
    if (active.length >= limits.maxMembersPerGroup) throw new GroupOperationError("member_limit_reached");

    const prev = conv?.participations.find((p) => p.userId === request.userId);
    const historyFrom = conv && conv.historyPolicy === "all" ? null : new Date();
    if (prev) {
      await db.participation.update({
        where: { id: prev.id },
        data: { removedAt: null, role: "member", historyFrom, lastReadAt: null, lastDeliveredAt: null },
      });
    } else {
      await db.participation.create({
        data: { conversationId: params.conversationId, userId: request.userId, role: "member", historyFrom },
      });
    }
  }

  await db.groupJoinRequest.update({
    where: { id: request.id },
    data: {
      status: params.approve ? "approved" : "declined",
      resolvedAt: new Date(),
      resolvedByUserId: params.actorId,
    },
  });

  await addSystemMessage(
    params.conversationId,
    params.approve
      ? `${params.actorName} approved ${request.user.displayName}'s join request`
      : `${params.actorName} declined ${request.user.displayName}'s join request`
  );
  /* §62 "Join approved". */
  if (params.approve) {
    const convTitle = (
      await db.conversation.findUnique({
        where: { id: params.conversationId },
        select: { title: true },
      })
    )?.title;
    await notifyUser({
      userId: request.userId,
      type: "group.join_approved",
      title: `${params.actorName} approved your join request`,
      body: convTitle ? `Group: ${convTitle}` : undefined,
      groupId: params.conversationId,
      actorName: params.actorName,
    });
  }
  return params.approve ? "approved" : "declined";
}

/** Expire stale invites lazily on read (SQLite has no scheduler). */
export async function expireStaleInvites(conversationId: string) {
  await db.groupInvite.updateMany({
    where: {
      conversationId,
      status: "active",
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired" },
  });
}
