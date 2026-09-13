import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  addSystemMessage,
  createGroup,
  hashInviteToken,
  initialsOfName,
  limitsForTier,
  removeMember as removeGroupMember,
  addMembers as addGroupMembers,
  leaveGroup as leaveGroupConversation,
  type GroupRole,
  type MembershipTier,
} from "./groups";
import { notifyMany, notifyUser } from "./notify";
import { assertDirectedAddAllowed, isBlockedBy, BlockOperationError as BlockOpErr } from "./blocks";

/*
 * Server-side Circle engine (groups & circles spec §23-§46, §59-§63, §76-§81).
 *
 * A Circle is an umbrella STRUCTURE over independent group conversations:
 *   - Circle membership alone grants zero conversation access (§26). A
 *     member sees the circle shell + the groups they are ALSO a direct
 *     participant of. Managers (owner/admin) additionally see every group
 *     in the circle so they can run it — plain members never learn the
 *     names of groups they are not in (§42/§67).
 *   - Everything here is backend-authoritative (§80): membership, roles,
 *     invite status, policy, archive/delete decisions live in the DB.
 *   - Circle membership NEVER implies billing entitlement, and removing
 *     someone from a Circle never touches their Cloak membership (§61).
 *
 * v1 role model (spec §25/§27):
 *   owner  — everything incl. transfer, settings, policy, delete
 *   admin  — create/archive groups, invite, remove members, assign to groups
 *   member — see the shell + their groups; no management
 */

export type CircleRole = "owner" | "admin" | "member";

export type CirclePermission =
  | "circle.group.create"
  | "circle.group.archive"
  | "circle.member.invite"
  | "circle.member.remove"
  | "circle.member.assign_group"
  | "circle.role.manage"
  | "circle.settings.manage"
  | "circle.security.manage"
  | "circle.ai.manage"
  | "circle.delete";

/** Capability matrix (spec §27) — routes call this, never inline role checks. */
export function canCircle(role: CircleRole, permission: CirclePermission): boolean {
  switch (permission) {
    case "circle.group.create":
    case "circle.group.archive":
    case "circle.member.invite":
    case "circle.member.remove":
    case "circle.member.assign_group":
    case "circle.ai.manage":
      return role === "owner" || role === "admin";
    case "circle.role.manage":
    case "circle.settings.manage":
    case "circle.security.manage":
    case "circle.delete":
      return role === "owner";
    default:
      return false;
  }
}

/** Tier entitlement for Circles (spec §32/§34/§58/§59): Private joins but
 *  does not create; Reserve gets ONE personal Circle; managed-Circle tiers
 *  get a configurable pool. Numbers are config defaults, not marketing. */
export const CIRCLE_LIMITS = {
  none: { maxCirclesOwned: 0, maxMembersPerCircle: 0, maxGroupsPerCircle: 0 },
  private: { maxCirclesOwned: 0, maxMembersPerCircle: 0, maxGroupsPerCircle: 0 },
  reserve: { maxCirclesOwned: 1, maxMembersPerCircle: 25, maxGroupsPerCircle: 10 },
  private_circle: { maxCirclesOwned: 10, maxMembersPerCircle: 200, maxGroupsPerCircle: 50 },
  office: { maxCirclesOwned: 10, maxMembersPerCircle: 200, maxGroupsPerCircle: 50 },
  sovereign: { maxCirclesOwned: 10, maxMembersPerCircle: 200, maxGroupsPerCircle: 50 },
} as const;

export function circleLimitsForTier(tier: string | null | undefined) {
  return (
    CIRCLE_LIMITS[(tier ?? "private") as MembershipTier] ?? CIRCLE_LIMITS.private
  );
}

/** The Circle kind a tier creates (spec §32/§35): Reserve = personal,
 *  commercial Circle tiers = managed. Private/none create nothing. */
export function circleKindForTier(tier: string | null | undefined): "personal" | "managed" {
  return tier === "private_circle" || tier === "office" || tier === "sovereign"
    ? "managed"
    : "personal";
}

/** Optional starting structures (spec §31). Templates pre-create EMPTY
 *  owner-only groups; they never imply certification or compliance. */
export const CIRCLE_TEMPLATES = [
  { id: "family-office", name: "Family Office", groups: ["Principal", "Legal", "Investments", "Security", "Travel", "Family"] },
  { id: "executive-office", name: "Executive Office", groups: ["Leadership", "Operations", "Communications", "Security"] },
  { id: "legal-matter", name: "Legal Matter", groups: ["Case Team", "Documents", "Advisors"] },
  { id: "board", name: "Board", groups: ["Directors", "Committees", "Materials"] },
  { id: "security-team", name: "Security Team", groups: ["Operations", "Incidents", "Review"] },
  { id: "private-project", name: "Private Project", groups: ["Planning", "Build", "Launch"] },
] as const;

/* ---------- Payload shapes (client contract) ---------- */

export interface CircleMemberPayload {
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  role: CircleRole;
  joinedAt: number;
  isYou: boolean;
  /** Circle groups of this member the VIEWER may know about (§42/§43):
   *  managers see everyone's access; members only see co-memberships in
   *  groups they themselves belong to. */
  groupAccess?: string[];
}

export interface CircleGroupEntryPayload {
  id: string;
  title: string;
  description?: string;
  memberCount: number;
  /** Whether the viewer is an active participant of this group. */
  isMember: boolean;
  myRole?: GroupRole;
  /** Circle association context for the header (§53). */
  updatedAt: number;
}

export interface CircleInvitePayload {
  id: string;
  status: "active" | "redeemed" | "expired" | "revoked";
  groupNames: string[];
  useCount: number;
  maxUses: number;
  expiresAt: number;
  createdAt: number;
  revokedAt?: number | null;
  /** Present ONLY right after creation — the raw token is never stored. */
  token?: string;
  url?: string;
}

export interface CircleAuditPayload {
  id: string;
  event: string;
  detail?: string;
  actorName?: string;
  createdAt: number;
}

export interface CircleJoinRequestPayload {
  id: string;
  userId: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  createdAt: number;
}

export interface CircleSecurityStatusPayload {
  memberCount: number;
  groupCount: number;
  /** Members whose client has provisioned an E2EE identity key — the only
   *  honest, real "verification" signal that exists today (§68: show
   *  Protected only when derived from implemented state). */
  identityKeysProvisioned: number;
  openInvites: number;
  cloudAi: "disabled" | "current_request" | "allowed";
  newMemberHistory: "none" | "all";
  archived: boolean;
}

export interface CircleSummaryPayload {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "managed";
  myRole: CircleRole;
  memberCount: number;
  /** Groups of the circle the viewer may see (managers: all; members: theirs). */
  visibleGroupCount: number;
  totalGroupCount: number;
  hiddenGroupCount: number;
  archived: boolean;
  lastActivityAt: number | null;
}

export interface CircleDetailPayload {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "managed";
  myRole: CircleRole;
  archived: boolean;
  createdAt: number;
  ownerUserId: string;
  policy: {
    newMemberHistory: "none" | "all";
    cloudAi: "disabled" | "current_request" | "allowed";
    inviteExpiryDays: number;
  };
  members: CircleMemberPayload[];
  groups: CircleGroupEntryPayload[];
  hiddenGroupCount: number;
  invites?: CircleInvitePayload[];
  /** Pending approval-queue requests (§41) — managers only. */
  joinRequests?: CircleJoinRequestPayload[];
  audit?: CircleAuditPayload[];
  security: CircleSecurityStatusPayload;
}

export class CircleOperationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/* ---------- Internals ---------- */

export function circleRoleOf(role: string | null | undefined): CircleRole {
  return role === "owner" || role === "admin" ? role : "member";
}

function parseGroupIds(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function circleById(circleId: string) {
  return db.circle.findUnique({
    where: { id: circleId },
    include: { members: { include: { user: true } } },
  });
}

export async function circleMemberRow(circleId: string, userId: string) {
  const row = await db.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
  });
  return row && !row.removedAt ? row : null;
}

export async function auditCircle(
  circleId: string,
  event: string,
  detail?: string,
  actorUserId?: string
) {
  await db.circleAuditEvent.create({
    data: { circleId, event, detail: detail ?? null, actorUserId: actorUserId ?? null },
  });
}

async function circleGroups(circleId: string) {
  return db.conversation.findMany({
    where: { circleId, isGroup: true },
    include: { participations: true },
    orderBy: { createdAt: "asc" as const },
  });
}

function mapGroupEntry(
  conv: {
    id: string;
    title: string | null;
    description?: string | null;
    updatedAt: Date;
    participations: { userId: string; role: string; removedAt: Date | null }[];
  },
  viewerId: string
): CircleGroupEntryPayload {
  const active = conv.participations.filter((p) => !p.removedAt);
  const mine = active.find((p) => p.userId === viewerId);
  return {
    id: conv.id,
    title: conv.title ?? "Group",
    description: conv.description ?? undefined,
    memberCount: active.length,
    isMember: !!mine,
    myRole: mine ? ((mine.role === "owner" || mine.role === "admin" ? mine.role : "member") as GroupRole) : undefined,
    updatedAt: conv.updatedAt.getTime(),
  };
}

/* ---------- Creation / listing ---------- */

export async function createCircle(params: {
  ownerId: string;
  ownerName: string;
  name: string;
  description?: string;
  tier: string | null | undefined;
  templateId?: string | null;
}) {
  const limits = circleLimitsForTier(params.tier);
  if (limits.maxCirclesOwned === 0) {
    throw new CircleOperationError("circle_create_not_allowed");
  }
  const owned = await db.circle.count({ where: { ownerUserId: params.ownerId } });
  if (owned >= limits.maxCirclesOwned) {
    throw new CircleOperationError("circle_limit_reached");
  }

  const template = params.templateId
    ? CIRCLE_TEMPLATES.find((t) => t.id === params.templateId)
    : undefined;

  const circle = await db.circle.create({
    data: {
      name: params.name,
      description: params.description ?? null,
      kind: circleKindForTier(params.tier),
      ownerUserId: params.ownerId,
    },
  });
  await db.circleMember.create({
    data: { circleId: circle.id, userId: params.ownerId, role: "owner" },
  });
  await auditCircle(circle.id, "circle.created", params.name, params.ownerId);

  if (template) {
    const groupLimits = limitsForTier(params.tier);
    const ownedGroups = await db.conversation.count({
      where: { isGroup: true, ownerId: params.ownerId },
    });
    const budget = groupLimits.maxGroupsOwned - ownedGroups;
    const names = template.groups.slice(0, Math.max(0, Math.min(budget, limits.maxGroupsPerCircle)));
    for (const title of names) {
      const conv = await createGroup({
        creatorId: params.ownerId,
        creatorName: params.ownerName,
        title,
        memberIds: [],
        tier: params.tier,
        historyPolicy: "none",
      });
      await db.conversation.update({ where: { id: conv.id }, data: { circleId: circle.id } });
    }
    await auditCircle(circle.id, "circle.group.created", `${names.length} groups from the ${template.name} template`, params.ownerId);
  }

  return circle;
}

export async function listMyCircles(userId: string): Promise<CircleSummaryPayload[]> {
  const memberships = await db.circleMember.findMany({
    where: { userId, removedAt: null },
    include: { circle: { include: { members: true } } },
  });

  const summaries = await Promise.all(
    memberships.map(async (m) => {
      const circle = m.circle;
      const groups = await circleGroups(circle.id);
      const isManager = circleRoleOf(m.role) !== "member";
      const myGroups = groups.filter((g) =>
        g.participations.some((p) => p.userId === userId && !p.removedAt)
      );
      const visible = isManager ? groups : myGroups;
      const lastActivity = visible.reduce<number>(
        (acc, g) => Math.max(acc, g.updatedAt.getTime()),
        0
      );
      return {
        id: circle.id,
        name: circle.name,
        description: circle.description ?? undefined,
        kind: circle.kind === "managed" ? ("managed" as const) : ("personal" as const),
        myRole: circleRoleOf(m.role),
        memberCount: circle.members.filter((cm) => !cm.removedAt).length,
        visibleGroupCount: visible.length,
        totalGroupCount: groups.length,
        hiddenGroupCount: groups.length - myGroups.length,
        archived: !!circle.archivedAt,
        lastActivityAt: lastActivity || null,
      } satisfies CircleSummaryPayload;
    })
  );

  summaries.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  return summaries;
}

/* ---------- Detail (spec §29/§42/§55/§68) ---------- */

export async function loadCircleDetail(
  circleId: string,
  viewerId: string
): Promise<CircleDetailPayload | null> {
  const circle = await circleById(circleId);
  if (!circle) return null;
  const mine = circle.members.find((m) => m.userId === viewerId && !m.removedAt);
  if (!mine) return null;

  const myRole = circleRoleOf(mine.role);
  const isManager = myRole !== "member";
  const groups = await circleGroups(circleId);
  const myGroupSet = new Set(
    groups
      .filter((g) => g.participations.some((p) => p.userId === viewerId && !p.removedAt))
      .map((g) => g.id)
  );

  /* Group visibility (§26/§42): members see only their groups by name;
     managers see all (they administer access). Hidden groups surface only
     as a count — never as names (§67). */
  const entries: CircleGroupEntryPayload[] = groups
    .filter((g) => isManager || myGroupSet.has(g.id))
    .map((g) => mapGroupEntry(g, viewerId));
  const hiddenGroupCount = isManager ? 0 : groups.length - myGroupSet.size;

  /* Directory (§42/§43): name, Cloak ID, circle role — never tier, wallet,
     contact about, or device data. groupAccess follows least privilege. */
  const activeMembers = circle.members.filter((m) => !m.removedAt);
  const groupTitleById = new Map(groups.map((g) => [g.id, g.title ?? "Group"]));
  const membershipByUser = new Map<string, string[]>();
  for (const g of groups) {
    for (const p of g.participations) {
      if (p.removedAt) continue;
      const list = membershipByUser.get(p.userId) ?? [];
      list.push(g.id);
      membershipByUser.set(p.userId, list);
    }
  }
  const members: CircleMemberPayload[] = activeMembers
    .map((m) => {
      const allGroups = membershipByUser.get(m.userId) ?? [];
      const visibleGroups = isManager
        ? allGroups
        : allGroups.filter((gid) => myGroupSet.has(gid));
      return {
        userId: m.userId,
        name: m.user.displayName,
        cloakId: `@${m.user.handle}`,
        avatarInitials: initialsOfName(m.user.displayName),
        role: circleRoleOf(m.role),
        joinedAt: m.createdAt.getTime(),
        isYou: m.userId === viewerId,
        groupAccess: [...new Set(visibleGroups)].map((gid) => groupTitleById.get(gid) ?? "Group"),
      };
    })
    .sort((a, b) => {
      const order = { owner: 0, admin: 1, member: 2 } as const;
      if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
      return a.joinedAt - b.joinedAt;
    });

  /* Invites (§40) — managers only. */
  let invites: CircleInvitePayload[] | undefined;
  if (isManager) {
    await expireStaleCircleInvites(circleId);
    const rows = await db.circleInvite.findMany({
      where: { circleId },
      orderBy: { createdAt: "desc" as const },
      take: 50,
    });
    invites = rows.map((r) => ({
      id: r.id,
      status: inviteEffectiveStatus(r),
      groupNames: parseGroupIds(r.groupIds).map((gid) => groupTitleById.get(gid) ?? "Group"),
      useCount: r.useCount,
      maxUses: r.maxUses,
      expiresAt: r.expiresAt.getTime(),
      createdAt: r.createdAt.getTime(),
      revokedAt: r.revokedAt ? r.revokedAt.getTime() : null,
    }));
  }

  /* Approval queue (§41) — managers only. */
  let joinRequests: CircleJoinRequestPayload[] | undefined;
  if (isManager) {
    const rows = await db.circleJoinRequest.findMany({
      where: { circleId, status: "pending" },
      include: { user: true },
      orderBy: { createdAt: "asc" as const },
    });
    joinRequests = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.user.displayName,
      cloakId: `@${r.user.handle}`,
      avatarInitials: initialsOfName(r.user.displayName),
      createdAt: r.createdAt.getTime(),
    }));
  }

  /* Audit trail (§63) — managers only, membership events only, no content. */
  let audit: CircleAuditPayload[] | undefined;
  if (isManager) {
    const rows = await db.circleAuditEvent.findMany({
      where: { circleId },
      orderBy: { createdAt: "desc" as const },
      take: 50,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await db.user.findMany({ where: { id: { in: actorIds } } })
      : [];
    const nameById = new Map(actors.map((a) => [a.id, a.displayName]));
    audit = rows.map((r) => ({
      id: r.id,
      event: r.event,
      detail: r.detail ?? undefined,
      actorName: r.actorUserId ? nameById.get(r.actorUserId) : undefined,
      createdAt: r.createdAt.getTime(),
    }));
  }

  const identityKeysProvisioned = await db.user.count({
    where: { id: { in: activeMembers.map((m) => m.userId) }, identityPublicKey: { not: null } },
  });
  const openInvites = (invites ?? []).filter((i) => i.status === "active").length;

  return {
    id: circle.id,
    name: circle.name,
    description: circle.description ?? undefined,
    kind: circle.kind === "managed" ? ("managed" as const) : ("personal" as const),
    myRole,
    archived: !!circle.archivedAt,
    createdAt: circle.createdAt.getTime(),
    ownerUserId: circle.ownerUserId,
    policy: {
      newMemberHistory: circle.historyDefault === "all" ? "all" : "none",
      cloudAi: circle.aiDefault === "allowed" ? "allowed" : circle.aiDefault === "current_request" ? "current_request" : "disabled",
      inviteExpiryDays: circle.inviteExpiryDays,
    },
    members,
    groups: entries,
    hiddenGroupCount,
    invites,
    joinRequests,
    audit,
    security: {
      memberCount: activeMembers.length,
      groupCount: groups.length,
      identityKeysProvisioned,
      openInvites,
      cloudAi: circle.aiDefault === "allowed" ? "allowed" : circle.aiDefault === "current_request" ? "current_request" : "disabled",
      newMemberHistory: circle.historyDefault === "all" ? "all" : "none",
      archived: !!circle.archivedAt,
    },
  };
}

/* ---------- Membership mutations (§25/§61/§77) ---------- */

export async function addCircleMembers(params: {
  circleId: string;
  actorId: string;
  userIds: string[];
}): Promise<number> {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.invite")) {
    throw new CircleOperationError("forbidden");
  }

  const limits = circleLimitsForTier(await tierOfUser(circle.ownerUserId));
  const active = circle.members.filter((m) => !m.removedAt);
  const existing = new Set(active.map((m) => m.userId));
  const toAdd = [...new Set(params.userIds)].filter((id) => !existing.has(id));
  if (active.length + toAdd.length > limits.maxMembersPerCircle) {
    throw new CircleOperationError("member_limit_reached");
  }

  /* §75/§74: every directed add must pass the target's block state and
     invite policy BEFORE any membership row is written. Block state is
     never revealed — both refusals surface as invite_not_allowed. */
  for (const userId of toAdd) {
    try {
      await assertDirectedAddAllowed({
        actorId: params.actorId,
        targetUserId: userId,
        kind: "circle",
        circleId: circle.id,
      });
    } catch (err) {
      if (err instanceof BlockOpErr) throw new CircleOperationError("invite_not_allowed");
      throw err;
    }
  }

  for (const userId of toAdd) {
    const prev = circle.members.find((m) => m.userId === userId);
    if (prev) {
      await db.circleMember.update({
        where: { id: prev.id },
        data: { removedAt: null },
      });
    } else {
      await db.circleMember.create({
        data: { circleId: circle.id, userId, role: "member" },
      });
    }
  }

  if (toAdd.length > 0) {
    const users = await db.user.findMany({ where: { id: { in: toAdd } } });
    await auditCircle(
      circle.id,
      "circle.member.invited",
      users.map((u) => u.displayName).join(", "),
      params.actorId
    );
    /* §62 "Circle added" — honest §26 note: shell only, groups are a
       separate explicit grant. */
    const actorUser = await db.user.findUnique({ where: { id: params.actorId } });
    await notifyMany(toAdd, {
      type: "circle.added",
      title: `${actorUser?.displayName ?? "A manager"} added you to ${circle.name}`,
      body: "You can see the Circle — group access is granted separately.",
      circleId: circle.id,
      actorName: actorUser?.displayName,
    });
  }
  return toAdd.length;
}

/** Removing someone from the Circle also removes them from every group in
 *  it (§61/§77 v1 policy): circle access is the grant; revoking it revokes
 *  what it granted. Their Cloak membership is never touched here. */
export async function removeCircleMember(params: {
  circleId: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
}): Promise<{ removedFromGroups: number }> {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.remove")) {
    throw new CircleOperationError("forbidden");
  }
  const target = circle.members.find((m) => m.userId === params.targetUserId && !m.removedAt);
  if (!target) throw new CircleOperationError("not_a_member");
  if (target.role === "owner" || circle.ownerUserId === params.targetUserId) {
    throw new CircleOperationError("cannot_remove_owner");
  }

  const groups = await circleGroups(params.circleId);
  let removedFromGroups = 0;
  for (const g of groups) {
    const active = g.participations.some(
      (p) => p.userId === params.targetUserId && !p.removedAt
    );
    if (!active) continue;
    const isGroupOwner = g.participations.some(
      (p) => p.userId === params.targetUserId && !p.removedAt && p.role === "owner"
    );
    if (isGroupOwner) {
      throw new CircleOperationError("circle_member_owns_groups");
    }
    await removeGroupMember({
      conversationId: g.id,
      actorId: params.actorId,
      actorName: params.actorName,
      targetUserId: params.targetUserId,
    });
    removedFromGroups += 1;
  }

  await db.circleMember.update({
    where: { id: target.id },
    data: { removedAt: new Date() },
  });
  const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
  await auditCircle(
    params.circleId,
    "circle.member.removed",
    targetUser?.displayName,
    params.actorId
  );
  /* §62 "Removed from Circle". */
  const actorUser = await db.user.findUnique({ where: { id: params.actorId } });
  await notifyUser({
    userId: params.targetUserId,
    type: "circle.removed",
    title: `${actorUser?.displayName ?? "A manager"} removed you from ${circle.name}`,
    circleId: circle.id,
    actorName: actorUser?.displayName,
  });
  return { removedFromGroups };
}

export async function leaveCircle(circleId: string, userId: string, userName: string) {
  const circle = await circleById(circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const mine = circle.members.find((m) => m.userId === userId && !m.removedAt);
  if (!mine) throw new CircleOperationError("not_a_member");
  const active = circle.members.filter((m) => !m.removedAt);
  if (mine.role === "owner" && active.length > 1) {
    throw new CircleOperationError("transfer_ownership_first");
  }

  // Leaving the circle leaves every group inside it (spec §77 policy).
  const groups = await circleGroups(circleId);
  for (const g of groups) {
    const activeP = g.participations.some((p) => p.userId === userId && !p.removedAt);
    if (!activeP) continue;
    await leaveGroupConversation(g.id, userId, userName);
  }

  await db.circleMember.update({ where: { id: mine.id }, data: { removedAt: new Date() } });
  await auditCircle(circleId, "circle.member.removed", `${userName} left`, userId);
}

export async function setCircleMemberRole(params: {
  circleId: string;
  actorId: string;
  targetUserId: string;
  role: CircleRole;
}) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.role.manage")) {
    throw new CircleOperationError("forbidden");
  }
  const target = circle.members.find((m) => m.userId === params.targetUserId && !m.removedAt);
  if (!target) throw new CircleOperationError("not_a_member");

  if (params.role === "owner") {
    if (circle.ownerUserId !== params.actorId) throw new CircleOperationError("forbidden");
    if (params.targetUserId === params.actorId) throw new CircleOperationError("forbidden");
    await db.circleMember.update({ where: { id: actor.id }, data: { role: "admin" } });
    await db.circleMember.update({ where: { id: target.id }, data: { role: "owner" } });
    await db.circle.update({
      where: { id: circle.id },
      data: { ownerUserId: params.targetUserId },
    });
    const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
    await auditCircle(
      circle.id,
      "circle.role.changed",
      `${targetUser?.displayName ?? "A member"} is now the circle owner`,
      params.actorId
    );
    /* §62 "Role changed". */
    await notifyUser({
      userId: params.targetUserId,
      type: "circle.role_changed",
      title: `You are now the owner of ${circle.name}`,
      circleId: circle.id,
    });
    return;
  }

  if (target.role === "owner" || circle.ownerUserId === params.targetUserId) {
    throw new CircleOperationError("cannot_change_owner_role");
  }
  await db.circleMember.update({ where: { id: target.id }, data: { role: params.role } });
  const targetUser = await db.user.findUnique({ where: { id: params.targetUserId } });
  await auditCircle(
    circle.id,
    "circle.role.changed",
    `${targetUser?.displayName ?? "A member"} is now ${params.role === "admin" ? "an admin" : "a member"}`,
    params.actorId
  );
  /* §62 "Role changed". */
  await notifyUser({
    userId: params.targetUserId,
    type: "circle.role_changed",
    title:
      params.role === "admin"
        ? `You are now an admin of ${circle.name}`
        : `You are now a member of ${circle.name}`,
    circleId: circle.id,
  });
}

/* ---------- Groups inside the circle (§24/§26/§27/§44) ---------- */

export async function createCircleGroup(params: {
  circleId: string;
  actorId: string;
  actorName: string;
  title: string;
  description?: string;
  memberIds?: string[];
  ghostSeconds?: number;
}) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.group.create")) {
    throw new CircleOperationError("forbidden");
  }
  if (circle.archivedAt) throw new CircleOperationError("circle_archived");

  const limits = circleLimitsForTier(await tierOfUser(circle.ownerUserId));
  const groupCount = await db.conversation.count({ where: { circleId: circle.id, isGroup: true } });
  if (groupCount >= limits.maxGroupsPerCircle) {
    throw new CircleOperationError("group_limit_reached");
  }

  /* Only ACTIVE circle members can be placed into a circle group (§26:
     group membership is an explicit grant on top of circle membership). */
  const circleMemberIds = new Set(
    circle.members.filter((m) => !m.removedAt).map((m) => m.userId)
  );
  const memberIds = [...new Set(params.memberIds ?? [])].filter(
    (id) => id !== params.actorId && circleMemberIds.has(id)
  );

  const conv = await createGroup({
    creatorId: params.actorId,
    creatorName: params.actorName,
    title: params.title,
    description: params.description,
    memberIds,
    tier: await tierOfUser(circle.ownerUserId),
    ghostSeconds: params.ghostSeconds,
    historyPolicy: circle.historyDefault === "all" ? "all" : "none",
    /* §38/§39: circle-created groups inherit the circle AI default. A
       disabled circle default becomes a blocked group setting; stricter
       group settings can still be set later, never weaker (§39). */
    aiAccess: circle.aiDefault === "disabled" ? "blocked" : "allowed",
  });
  await db.conversation.update({ where: { id: conv.id }, data: { circleId: circle.id } });
  await auditCircle(circle.id, "circle.group.created", params.title, params.actorId);
  return conv;
}

/** Assign an existing circle member to one of the circle's groups (§27
 *  circle.member.assign_group). Refuses silently-invalid combos loudly. */
export async function assignMemberToGroup(params: {
  circleId: string;
  actorId: string;
  actorName: string;
  groupId: string;
  targetUserId: string;
}): Promise<void> {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.assign_group")) {
    throw new CircleOperationError("forbidden");
  }

  const group = await db.conversation.findUnique({
    where: { id: params.groupId },
    include: { participations: true },
  });
  if (!group || group.circleId !== circle.id || !group.isGroup) {
    throw new CircleOperationError("not_found");
  }

  const target = circle.members.find((m) => m.userId === params.targetUserId && !m.removedAt);
  if (!target) throw new CircleOperationError("not_a_member");

  const { addMembers } = { addMembers: addGroupMembers };
  await addMembers({
    conversationId: group.id,
    actorId: params.actorId,
    actorName: params.actorName,
    userIds: [params.targetUserId],
  });
}

/* ---------- Settings / policy / lifecycle (§38/§39/§45/§46) ---------- */

export async function renameCircle(params: { circleId: string; actorId: string; name: string; description?: string | null }) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.settings.manage")) {
    throw new CircleOperationError("forbidden");
  }
  await db.circle.update({
    where: { id: circle.id },
    data: {
      name: params.name,
      ...(params.description !== undefined ? { description: params.description } : {}),
    },
  });
  await auditCircle(circle.id, "circle.policy.changed", `renamed to ${params.name}`, params.actorId);
}

export async function setCirclePolicy(params: {
  circleId: string;
  actorId: string;
  newMemberHistory?: "none" | "all";
  cloudAi?: "disabled" | "current_request" | "allowed";
  inviteExpiryDays?: number;
}) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.security.manage")) {
    throw new CircleOperationError("forbidden");
  }

  await db.circle.update({
    where: { id: circle.id },
    data: {
      ...(params.newMemberHistory ? { historyDefault: params.newMemberHistory } : {}),
      ...(params.cloudAi ? { aiDefault: params.cloudAi } : {}),
      ...(params.inviteExpiryDays
        ? { inviteExpiryDays: Math.min(30, Math.max(1, Math.round(params.inviteExpiryDays))) }
        : {}),
    },
  });
  await auditCircle(circle.id, "circle.policy.changed", "security policy updated", params.actorId);
  /* §62 "Security policy changed" — every OTHER active member. */
  const others = circle.members.filter((m) => !m.removedAt && m.userId !== params.actorId).map((m) => m.userId);
  const actorUser = await db.user.findUnique({ where: { id: params.actorId } });
  await notifyMany(others, {
    type: "circle.policy_changed",
    title: `${actorUser?.displayName ?? "The owner"} updated the security policy of ${circle.name}`,
    circleId: circle.id,
    actorName: actorUser?.displayName,
  });
}

export async function setCircleArchived(params: { circleId: string; actorId: string; archived: boolean }) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.settings.manage")) {
    throw new CircleOperationError("forbidden");
  }

  await db.circle.update({
    where: { id: circle.id },
    data: { archivedAt: params.archived ? new Date() : null },
  });

  if (params.archived) {
    // Archived circles cannot recruit (§45): disable every active invite.
    await db.circleInvite.updateMany({
      where: { circleId: circle.id, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }
  await auditCircle(
    circle.id,
    "circle.group.archived",
    params.archived ? "circle archived" : "circle unarchived",
    params.actorId
  );
}

/** Delete the circle STRUCTURE (§46): groups are detached, not destroyed;
 *  memberships and invites are revoked; member accounts are untouched.
 *  Owner-only and irreversible — the client confirms by typing the name. */
export async function deleteCircle(circleId: string, actorId: string) {
  const circle = await circleById(circleId);
  if (!circle) throw new CircleOperationError("not_found");
  if (circle.ownerUserId !== actorId) throw new CircleOperationError("forbidden");

  await db.conversation.updateMany({
    where: { circleId },
    data: { circleId: null },
  });
  await db.circleInvite.deleteMany({ where: { circleId } });
  // Circle row deletion cascades to members + audit events (structure data;
  // user accounts and conversations live outside the cascade on purpose).
  await db.circle.delete({ where: { id: circleId } });
}

/* ---------- Invites (§40/§41) ---------- */

export async function createCircleInvite(params: {
  circleId: string;
  createdByUserId: string;
  groupIds: string[];
  expiresInDays?: number;
  /** §41 "Approval required": redemption files a join request instead of
   *  joining directly; the single-use token is consumed on approval. */
  approvalRequired?: boolean;
}): Promise<{ invite: { id: string; expiresAt: Date; maxUses: number }; token: string; url: string }> {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.createdByUserId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.invite")) {
    throw new CircleOperationError("forbidden");
  }
  if (circle.archivedAt) throw new CircleOperationError("circle_archived");

  // Every offered group must belong to this circle — an invite can never
  // smuggle the recipient into a conversation outside the structure (§40).
  const groups = await circleGroups(params.circleId);
  const circleGroupIds = new Set(groups.map((g) => g.id));
  const groupIds = [...new Set(params.groupIds)].filter((gid) => circleGroupIds.has(gid));

  const days = params.expiresInDays ?? circle.inviteExpiryDays;
  const expiresAt = new Date(Date.now() + Math.min(30, Math.max(1, days)) * 24 * 3600 * 1000);
  const token = generateCircleInviteToken();
  const invite = await db.circleInvite.create({
    data: {
      circleId: params.circleId,
      createdByUserId: params.createdByUserId,
      tokenHash: hashInviteToken(token),
      groupIds: JSON.stringify(groupIds),
      status: "active",
      approvalRequired: params.approvalRequired ?? false,
      maxUses: 1,
      expiresAt,
    },
  });
  await auditCircle(params.circleId, "circle.member.invited", "invite link created", params.createdByUserId);
  return {
    invite: { id: invite.id, expiresAt, maxUses: invite.maxUses },
    token,
    // Hash-router path segment form (#/circles/invite/<token>) — the
    // router parses only the hash path, never query strings.
    url: `/circles/invite/${encodeURIComponent(token)}`,
  };
}

export function generateCircleInviteToken(): string {
  // 32 bytes — circle invites grant multi-group access, so a longer token
  // than the 24-byte group invites is cheap insurance.
  return randomBytes(32).toString("base64url");
}

export function inviteEffectiveStatus(invite: {
  status: string;
  expiresAt: Date;
  maxUses: number;
  useCount: number;
}): "active" | "redeemed" | "expired" | "revoked" {
  if (invite.status === "revoked") return "revoked";
  if (invite.status === "redeemed") return "redeemed";
  if (invite.expiresAt.getTime() < Date.now()) return "expired";
  if (invite.useCount >= invite.maxUses) return "expired";
  return "active";
}

export async function expireStaleCircleInvites(circleId: string) {
  await db.circleInvite.updateMany({
    where: { circleId, status: "active", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
}

export async function revokeCircleInvite(params: { circleId: string; actorId: string; inviteId: string }) {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.invite")) {
    throw new CircleOperationError("forbidden");
  }
  const invite = await db.circleInvite.findUnique({ where: { id: params.inviteId } });
  if (!invite || invite.circleId !== params.circleId) throw new CircleOperationError("not_found");
  if (invite.status !== "active") throw new CircleOperationError("not_pending");

  await db.circleInvite.update({
    where: { id: invite.id },
    data: { status: "revoked", revokedAt: new Date() },
  });
  await auditCircle(params.circleId, "circle.invite.revoked", undefined, params.actorId);
}

/** Public lookup (§40: the token IS the capability). Returns what the
 *  recipient needs to decide — circle name, inviter, groups offered — and
 *  NEVER member data, counts, or policy details (§42/§48). */
export async function lookupCircleInvite(token: string) {
  await db.circleInvite.updateMany({
    where: { status: "active", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
  const invite = await db.circleInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { circle: true },
  });
  if (!invite) return null;
  const inviter = await db.user.findUnique({ where: { id: invite.createdByUserId } });
  const groupIds = parseGroupIds(invite.groupIds);
  const groups = groupIds.length
    ? await db.conversation.findMany({ where: { id: { in: groupIds } } })
    : [];
  const order = new Map(groupIds.map((gid, i) => [gid, i]));
  return {
    status: inviteEffectiveStatus(invite),
    circleName: invite.circle.name,
    circleDescription: invite.circle.description ?? undefined,
    inviterName: inviter?.displayName ?? "A circle manager",
    expiresAt: invite.expiresAt.getTime(),
    groups: groups
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((g) => g.title ?? "Group"),
  };
}

/** Redeem (§40/§41/§61): grants the CIRCLE membership + explicit group
 *  access. Requires an existing Cloak account — circle invites are for
 *  members, NOT a registration path (§60: passes bring people INTO Cloak;
 *  circle invites organize people who are already in). Approval-required
 *  invites (§41) file a join request instead of joining directly. */
export async function redeemCircleInvite(params: { token: string; userId: string; userName: string }): Promise<{
  status: "joined" | "requested";
  circleId: string;
  circleName: string;
  groupsJoined: string[];
}> {
  await db.circleInvite.updateMany({
    where: { status: "active", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
  const invite = await db.circleInvite.findUnique({
    where: { tokenHash: hashInviteToken(params.token) },
    include: { circle: { include: { members: true } } },
  });
  if (!invite) throw new CircleOperationError("not_found");
  if (inviteEffectiveStatus(invite) !== "active") throw new CircleOperationError("invite_not_active");

  const circle = invite.circle;
  const prev = circle.members.find((m) => m.userId === params.userId);
  if (prev && !prev.removedAt) throw new CircleOperationError("already_member");

  /* §75: a blocked relation in EITHER direction voids the link. The
     refusal reuses the generic inactive-invite code — block state is
     never exposed to the blocked user (§75). */
  if (
    (await isBlockedBy(params.userId, invite.createdByUserId)) ||
    (await isBlockedBy(invite.createdByUserId, params.userId))
  ) {
    throw new CircleOperationError("invite_not_active");
  }

  /* §41 approval queue: file the request, notify the managers, do NOT
     consume the single-use token yet (it is consumed on approval). */
  if (invite.approvalRequired) {
    const existingRequest = await db.circleJoinRequest.findUnique({
      where: { circleId_userId: { circleId: circle.id, userId: params.userId } },
    });
    if (existingRequest?.status === "pending") throw new CircleOperationError("request_pending");
    /* NOTE: an "approved" historical request does NOT imply membership —
       the person may have been soft-removed since (line above already
       rejects ACTIVE members). Blocking re-requests here would lock a
       removed member out of approval-required invites forever. */
    await db.circleJoinRequest.upsert({
      where: { circleId_userId: { circleId: circle.id, userId: params.userId } },
      update: {
        status: "pending",
        inviteId: invite.id,
        groupIds: invite.groupIds,
        resolvedAt: null,
        resolvedByUserId: null,
      },
      create: {
        circleId: circle.id,
        userId: params.userId,
        inviteId: invite.id,
        groupIds: invite.groupIds,
      },
    });
    await auditCircle(
      circle.id,
      "circle.member.invited",
      `${params.userName} requested to join (approval required)`,
      params.userId
    );
    const managers = circle.members
      .filter((m) => !m.removedAt && (m.role === "owner" || m.role === "admin"))
      .map((m) => m.userId);
    await notifyMany(managers, {
      type: "circle.join_requested",
      title: `${params.userName} requested to join ${circle.name}`,
      body: "The invite requires approval.",
      circleId: circle.id,
      actorName: params.userName,
    });
    return { status: "requested", circleId: circle.id, circleName: circle.name, groupsJoined: [] };
  }

  const limits = circleLimitsForTier(await tierOfUser(circle.ownerUserId));
  const activeCount = circle.members.filter((m) => !m.removedAt).length;
  if (activeCount >= limits.maxMembersPerCircle) throw new CircleOperationError("member_limit_reached");

  if (prev) {
    await db.circleMember.update({ where: { id: prev.id }, data: { removedAt: null } });
  } else {
    await db.circleMember.create({
      data: { circleId: circle.id, userId: params.userId, role: "member" },
    });
  }

  // Join the explicitly-offered groups (§40/§41). Group policy decides the
  // history window exactly like a direct add (§11/§38).
  const groupIds = parseGroupIds(invite.groupIds);
  const groups = groupIds.length
    ? await db.conversation.findMany({ where: { id: { in: groupIds }, circleId: circle.id, isGroup: true }, include: { participations: true } })
    : [];
  const groupsJoined: string[] = [];
  for (const full of groups) {
    const alreadyIn = full.participations.some((p) => p.userId === params.userId && !p.removedAt);
    if (alreadyIn) continue;
    const historyFrom = full.historyPolicy === "all" ? null : new Date();
    const p2 = full.participations.find((p) => p.userId === params.userId);
    if (p2) {
      await db.participation.update({
        where: { id: p2.id },
        data: { removedAt: null, role: "member", historyFrom, lastReadAt: null, lastDeliveredAt: null },
      });
    } else {
      await db.participation.create({
        data: { conversationId: full.id, userId: params.userId, role: "member", historyFrom },
      });
    }
    await addSystemMessage(full.id, `${params.userName} joined via circle invite`);
    groupsJoined.push(full.title ?? "Group");
  }

  const useCount = invite.useCount + 1;
  await db.circleInvite.update({
    where: { id: invite.id },
    data: {
      useCount,
      status: useCount >= invite.maxUses ? "redeemed" : invite.status,
      redeemedByUserId: params.userId,
      redeemedAt: new Date(),
    },
  });
  await auditCircle(circle.id, "circle.member.joined", params.userName, params.userId);

  return { status: "joined", circleId: circle.id, circleName: circle.name, groupsJoined };
}

/** Approve or deny a pending join request (§41). Approval grants exactly
 *  the snapshot group list, consumes the single-use invite, and notifies
 *  the requester; denial notifies with neutral copy (no block-state leak). */
export async function resolveCircleJoinRequest(params: {
  circleId: string;
  actorId: string;
  requestId: string;
  approve: boolean;
}): Promise<"approved" | "denied"> {
  const circle = await circleById(params.circleId);
  if (!circle) throw new CircleOperationError("not_found");
  const actor = circle.members.find((m) => m.userId === params.actorId && !m.removedAt);
  if (!actor || !canCircle(circleRoleOf(actor.role), "circle.member.invite")) {
    throw new CircleOperationError("forbidden");
  }
  const request = await db.circleJoinRequest.findUnique({
    where: { id: params.requestId },
    include: { user: true },
  });
  if (!request || request.circleId !== params.circleId) {
    throw new CircleOperationError("not_found");
  }
  if (request.status !== "pending") throw new CircleOperationError("not_pending");

  if (!params.approve) {
    await db.circleJoinRequest.update({
      where: { id: request.id },
      data: { status: "denied", resolvedAt: new Date(), resolvedByUserId: params.actorId },
    });
    await auditCircle(
      circle.id,
      "circle.join.denied",
      `${request.user.displayName}'s join request was declined`,
      params.actorId
    );
    const denier = await db.user.findUnique({ where: { id: params.actorId } });
    await notifyUser({
      userId: request.userId,
      type: "circle.join_denied",
      title: `Your request to join ${circle.name} was declined`,
      circleId: circle.id,
      actorName: denier?.displayName,
    });
    return "denied";
  }

  const limits = circleLimitsForTier(await tierOfUser(circle.ownerUserId));
  const activeCount = circle.members.filter((m) => !m.removedAt).length;
  if (activeCount >= limits.maxMembersPerCircle) throw new CircleOperationError("member_limit_reached");

  const prev = circle.members.find((m) => m.userId === request.userId);
  if (prev) {
    await db.circleMember.update({ where: { id: prev.id }, data: { removedAt: null } });
  } else {
    await db.circleMember.create({
      data: { circleId: circle.id, userId: request.userId, role: "member" },
    });
  }

  // Join exactly the snapshot groups (§40/§41): the invite's grant at
  // request time, immune to later invite edits or revocation.
  const groupIds = parseGroupIds(request.groupIds);
  const groups = groupIds.length
    ? await db.conversation.findMany({
        where: { id: { in: groupIds }, circleId: circle.id, isGroup: true },
        include: { participations: true },
      })
    : [];
  for (const full of groups) {
    const alreadyIn = full.participations.some(
      (p) => p.userId === request.userId && !p.removedAt
    );
    if (alreadyIn) continue;
    const historyFrom = full.historyPolicy === "all" ? null : new Date();
    const p2 = full.participations.find((p) => p.userId === request.userId);
    if (p2) {
      await db.participation.update({
        where: { id: p2.id },
        data: { removedAt: null, role: "member", historyFrom, lastReadAt: null, lastDeliveredAt: null },
      });
    } else {
      await db.participation.create({
        data: { conversationId: full.id, userId: request.userId, role: "member", historyFrom },
      });
    }
    await addSystemMessage(full.id, `${request.user.displayName} joined via approved circle invite`);
  }

  await db.circleJoinRequest.update({
    where: { id: request.id },
    data: { status: "approved", resolvedAt: new Date(), resolvedByUserId: params.actorId },
  });

  // The single-use token is consumed ONLY on approval (§41).
  if (request.inviteId) {
    const invite = await db.circleInvite.findUnique({ where: { id: request.inviteId } });
    if (invite && invite.status === "active") {
      const useCount = invite.useCount + 1;
      await db.circleInvite.update({
        where: { id: invite.id },
        data: { useCount, status: useCount >= invite.maxUses ? "redeemed" : invite.status },
      });
    }
  }

  await auditCircle(circle.id, "circle.member.joined", request.user.displayName, request.userId);
  const approver = await db.user.findUnique({ where: { id: params.actorId } });
  await notifyUser({
    userId: request.userId,
    type: "circle.join_approved",
    title: `${approver?.displayName ?? "A manager"} approved your join to ${circle.name}`,
    body: groups.length
      ? `Groups: ${groups.map((g) => g.title ?? "Group").join(", ")}`
      : undefined,
    circleId: circle.id,
    actorName: approver?.displayName,
  });
  return "approved";
}

/* Owner tier drives circle limits (the STRUCTURE follows the owner's
 * entitlement, spec §32/§35). */
async function tierOfUser(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { membershipTier: true } });
  return u?.membershipTier ?? null;
}
