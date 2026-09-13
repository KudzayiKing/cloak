import { db } from "@/lib/db";

/*
 * Blocked users (groups & circles spec §75) + directed-add invite policy
 * (spec §74) — server-side enforcement.
 *
 * One-directional model: if A blocked B, then B
 *   - must not be able to direct-add A to groups or Circles,
 *   - must not be able to redeem A's invite links (generic error — §75
 *     "do not silently expose block state to the blocked user").
 *
 * §74 "Who can add me to groups/Circles?" is enforced on DIRECTED adds
 * (member add / assign / approval). Link invites remain manager-
 * controlled; turning on approval-required gives the same control for
 * link-based flows. Policy values:
 *   trusted       — only people who already share a conversation or the
 *                   relevant Circle with the actor may add them
 *   valid_invite  — anyone may add them (default)
 *   nobody        — no one may direct-add them
 */

export class BlockOperationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function blockUser(actorId: string, targetUserId: string): Promise<void> {
  if (actorId === targetUserId) throw new BlockOperationError("cannot_block_yourself");
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new BlockOperationError("not_found");
  await db.blockedUser.upsert({
    where: { blockerId_blockedId: { blockerId: actorId, blockedId: targetUserId } },
    update: {},
    create: { blockerId: actorId, blockedId: targetUserId },
  });
}

export async function unblockUser(actorId: string, targetUserId: string): Promise<void> {
  await db.blockedUser.deleteMany({
    where: { blockerId: actorId, blockedId: targetUserId },
  });
}

export interface BlockedEntry {
  userId: string;
  name: string;
  cloakId: string;
  blockedAt: number;
}

export async function listBlocks(actorId: string): Promise<BlockedEntry[]> {
  const rows = await db.blockedUser.findMany({
    where: { blockerId: actorId },
    include: { blocked: true },
    orderBy: { createdAt: "desc" as const },
  });
  return rows.map((r) => ({
    userId: r.blockedId,
    name: r.blocked.displayName,
    cloakId: `@${r.blocked.handle}`,
    blockedAt: r.createdAt.getTime(),
  }));
}

/* ---------- Enforcement ---------- */

/** True when the target has blocked the actor (one direction only). */
export async function isBlockedBy(actorId: string, targetUserId: string): Promise<boolean> {
  const row = await db.blockedUser.findUnique({
    where: { blockerId_blockedId: { blockerId: targetUserId, blockedId: actorId } },
  });
  return !!row;
}

/**
 * Assert the actor may direct-add the target to a group or Circle
 * (§75 + §74). Throws BlockOperationError with codes that callers map to
 * generic client errors:
 *   blocked            — the target blocked the actor (exposed honestly to
 *                        the ACTOR as "unable to add"; the actor did the
 *                        addable action, so a refusal here is acceptable to
 *                        surface as a failure without revealing WHY)
 *   invite_not_allowed — the target's §74 policy refuses this add
 *   not_found          — target user does not exist
 */
export async function assertDirectedAddAllowed(params: {
  actorId: string;
  targetUserId: string;
  kind: "group" | "circle";
  /** Circle id, for the "trusted" policy co-member check. */
  circleId?: string;
}): Promise<void> {
  if (params.actorId === params.targetUserId) return; // self-actions never blocked
  if (await isBlockedBy(params.actorId, params.targetUserId)) {
    throw new BlockOperationError("invite_not_allowed");
  }

  const settings = await db.userPrivacySettings.findUnique({
    where: { userId: params.targetUserId },
  });
  const policy = params.kind === "circle"
    ? settings?.circleInvitePolicy ?? "valid_invite"
    : settings?.groupInvitePolicy ?? "valid_invite";
  if (policy === "valid_invite") return;

  if (policy === "nobody") {
    throw new BlockOperationError("invite_not_allowed");
  }

  // policy === "trusted": the actor must already share a conversation or
  // (for circle adds) the target Circle with the person they are adding.
  const sharedConversation = await db.participation.findFirst({
    where: { userId: params.actorId, removedAt: null },
    select: { conversationId: true },
  });
  // Cheap trusted-path: share ANY conversation whose co-participant is the
  // target. Implemented as: every conversation of the actor, check target.
  let trusted = false;
  if (sharedConversation) {
    const actorConvos = await db.participation.findMany({
      where: { userId: params.actorId, removedAt: null },
      select: { conversationId: true },
    });
    const convIds = actorConvos.map((p) => p.conversationId);
    if (convIds.length > 0) {
      const co = await db.participation.findFirst({
        where: { conversationId: { in: convIds }, userId: params.targetUserId, removedAt: null },
      });
      trusted = !!co;
    }
  }
  if (!trusted && params.circleId) {
    const circle = await db.circleMember.findUnique({
      where: { circleId_userId: { circleId: params.circleId, userId: params.actorId } },
    });
    const targetCircle = await db.circleMember.findUnique({
      where: { circleId_userId: { circleId: params.circleId, userId: params.targetUserId } },
    });
    trusted = !!circle && !circle.removedAt && !!targetCircle && !targetCircle.removedAt;
  }
  if (!trusted) throw new BlockOperationError("invite_not_allowed");
}

/* ---------- §74 settings CRUD ---------- */

export interface PrivacySettingsPayload {
  groupInvitePolicy: "trusted" | "valid_invite" | "nobody";
  circleInvitePolicy: "trusted" | "valid_invite" | "nobody";
  defaultAiAccess: "disabled" | "current_request" | "allowed";
}

const INVITE_POLICIES = ["trusted", "valid_invite", "nobody"] as const;
const AI_ACCESS_VALUES = ["disabled", "current_request", "allowed"] as const;

export async function getPrivacySettings(userId: string): Promise<PrivacySettingsPayload> {
  const row = await db.userPrivacySettings.findUnique({ where: { userId } });
  return {
    groupInvitePolicy: (INVITE_POLICIES as readonly string[]).includes(row?.groupInvitePolicy ?? "")
      ? (row!.groupInvitePolicy as PrivacySettingsPayload["groupInvitePolicy"])
      : "valid_invite",
    circleInvitePolicy: (INVITE_POLICIES as readonly string[]).includes(row?.circleInvitePolicy ?? "")
      ? (row!.circleInvitePolicy as PrivacySettingsPayload["circleInvitePolicy"])
      : "valid_invite",
    defaultAiAccess: (AI_ACCESS_VALUES as readonly string[]).includes(row?.defaultAiAccess ?? "")
      ? (row!.defaultAiAccess as PrivacySettingsPayload["defaultAiAccess"])
      : "allowed",
  };
}

export async function savePrivacySettings(
  userId: string,
  patch: Partial<PrivacySettingsPayload>
): Promise<PrivacySettingsPayload> {
  const data: Record<string, string> = {};
  if (patch.groupInvitePolicy && (INVITE_POLICIES as readonly string[]).includes(patch.groupInvitePolicy)) {
    data.groupInvitePolicy = patch.groupInvitePolicy;
  }
  if (patch.circleInvitePolicy && (INVITE_POLICIES as readonly string[]).includes(patch.circleInvitePolicy)) {
    data.circleInvitePolicy = patch.circleInvitePolicy;
  }
  if (patch.defaultAiAccess && (AI_ACCESS_VALUES as readonly string[]).includes(patch.defaultAiAccess)) {
    data.defaultAiAccess = patch.defaultAiAccess;
  }
  await db.userPrivacySettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return getPrivacySettings(userId);
}

/** The creator's default AI access for NEW standalone groups (§74). */
export async function defaultAiAccessFor(userId: string): Promise<"allowed" | "blocked"> {
  const settings = await db.userPrivacySettings.findUnique({ where: { userId } });
  return settings?.defaultAiAccess === "disabled" ? "blocked" : "allowed";
}
