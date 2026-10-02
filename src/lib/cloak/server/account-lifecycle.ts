import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/*
 * Account lifecycle — erasure and portability.
 *
 * "Delete my account" is NOT `user.delete()`. The schema protects several
 * relations with `onDelete: Restrict` (the Prisma default for a REQUIRED
 * relation), and a plain delete would abort with a foreign-key violation
 * while leaving nothing half-done but nothing done either. The relations
 * that must be cleared explicitly are:
 *
 *   Device.userId                — required relation, Restrict
 *   DeviceRevocation.userId      — required relation, Restrict
 *   DaggerCommand.userId         — required relation, Restrict
 *   AdviserInvitation.createdByAdminId — explicitly `onDelete: Restrict`
 *
 * Everything else on `User` either cascades (sessions, participations,
 * reactions, key wraps, blocks, push subscriptions, notifications, privacy
 * settings, owned guest passes, uploaded attachment blobs, payment
 * requests, owned circles) or nulls itself (Message.authorId, the
 * redeemed-by / revoked-by columns). The two mechanisms are used
 * deliberately: **authored messages are anonymised, not destroyed** — that
 * is what `Message.authorId` being `SetNull` means, and it keeps other
 * people's conversation history intact.
 *
 * ORDER MATTERS inside the transaction. Postgres checks foreign keys
 * immediately (they are not deferrable here), so every child that REFUSES a
 * cascading delete is removed before the parent row goes, and every
 * ownership handover happens while the owner row still exists.
 */

/**
 * The interactive transaction budget. The default is 5 s, which a heavy
 * account can exceed once the per-conversation counts and ownership
 * handovers are included — and a timeout would roll the whole erasure back,
 * so the account would silently survive. Generous on purpose; the operation
 * is rare and a partial erasure is far worse than a slow one.
 */
export const DELETION_TX_TIMEOUT_MS = 30_000;

export interface AccountDeletionSummary {
  userId: string;
  handle: string;
  /** Rows removed explicitly (the relations that would otherwise block). */
  devices: number;
  deviceRevocations: number;
  daggerCommands: number;
  adviserInvitationsDeleted: number;
  /** Cascaded rows, counted before the delete so the erasure is auditable. */
  sessions: number;
  participations: number;
  attachmentBlobs: number;
  reactions: number;
  keyWraps: number;
  pushSubscriptions: number;
  notifications: number;
  guestPassesOwned: number;
  paymentRequests: number;
  blocks: number;
  /** Authored messages SURVIVE with `authorId = null` (schema `SetNull`). */
  messagesAuthoredAnonymised: number;
  /** Invites the account minted are revoked, mirroring `removeMember`. */
  groupInvitesRevoked: number;
  circleInvitesRevoked: number;
  groupsOwnershipTransferred: number;
  groupsLeftOwnerless: number;
  circlesOwnershipTransferred: number;
  circlesDeleted: number;
  deletedAt: string;
}

/**
 * Erase one account inside a caller-supplied transaction.
 *
 * Exported separately from `deleteUserAccount` so the whole lifecycle can be
 * exercised against a transaction double, and so a future caller can compose
 * the erasure with other work atomically.
 */
export async function deleteUserAccountInTransaction(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<AccountDeletionSummary> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, handle: true },
  });
  if (!user) throw new Error("user_not_found");

  const now = new Date();

  /* 1. Count what the cascade is about to take. Counts only — never
        content — so the caller can record that the erasure happened and at
        what scale, without the record itself becoming a data copy. */
  const [
    sessions,
    participations,
    messagesAuthoredAnonymised,
    attachmentBlobs,
    reactions,
    keyWraps,
    pushSubscriptions,
    notifications,
    guestPassesOwned,
    paymentRequests,
    blocks,
  ] = await Promise.all([
    tx.session.count({ where: { userId } }),
    tx.participation.count({ where: { userId } }),
    tx.message.count({ where: { authorId: userId } }),
    tx.attachmentBlob.count({ where: { authorId: userId } }),
    tx.messageReaction.count({ where: { userId } }),
    tx.conversationKeyWrap.count({ where: { userId } }),
    tx.pushSubscription.count({ where: { userId } }),
    tx.userNotification.count({ where: { userId } }),
    tx.guestPass.count({ where: { ownerUserId: userId } }),
    tx.paymentRequest.count({ where: { userId } }),
    tx.blockedUser.count({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
  ]);

  /* 2. Ownership handover, BEFORE the owner row disappears. A live user
        cannot leave a group they own (`leaveGroup` → `transfer_ownership_first`,
        spec §76), so an account deletion must not be able to either. The
        successor is the longest-standing remaining admin, else the
        longest-standing remaining member. A group with nobody left keeps the
        record but drops the dangling owner id — the app already archives
        empty groups rather than deleting them ("last person out … kept for
        audit", `leaveGroup`). */
  const ownedGroups = await tx.conversation.findMany({
    where: { isGroup: true, ownerId: userId },
    select: {
      id: true,
      participations: {
        where: { removedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true, role: true },
      },
    },
  });
  let groupsOwnershipTransferred = 0;
  let groupsLeftOwnerless = 0;
  for (const group of ownedGroups) {
    const others = group.participations.filter((p) => p.userId !== userId);
    const successor = others.find((p) => p.role === "admin") ?? others[0];
    if (successor) {
      await tx.participation.update({
        where: { id: successor.id },
        data: { role: "owner" },
      });
      await tx.conversation.update({
        where: { id: group.id },
        data: { ownerId: successor.userId },
      });
      groupsOwnershipTransferred += 1;
    } else {
      await tx.conversation.update({ where: { id: group.id }, data: { ownerId: null } });
      groupsLeftOwnerless += 1;
    }
  }

  /* 3. Circles the account owns. Same handover rule. A circle with nobody
        left is deleted by the cascade anyway (`Circle.ownerUserId` is
        Cascade) — deleting it here just makes the intent explicit and lets
        us report it. Its groups are DETACHED, never deleted
        (`Conversation.circleId` is SetNull). */
  const ownedCircles = await tx.circle.findMany({
    where: { ownerUserId: userId },
    select: {
      id: true,
      members: {
        where: { removedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true, role: true },
      },
    },
  });
  let circlesOwnershipTransferred = 0;
  let circlesDeleted = 0;
  for (const circle of ownedCircles) {
    const others = circle.members.filter((m) => m.userId !== userId);
    const successor = others.find((m) => m.role === "admin") ?? others[0];
    if (successor) {
      await tx.circleMember.update({ where: { id: successor.id }, data: { role: "owner" } });
      await tx.circle.update({
        where: { id: circle.id },
        data: { ownerUserId: successor.userId },
      });
      circlesOwnershipTransferred += 1;
    } else {
      await tx.circle.delete({ where: { id: circle.id } });
      circlesDeleted += 1;
    }
  }

  /* 4. Revoke the invite links this account minted. `removeMember` and
        `leaveGroup` already do exactly this for a departing member
        ("revocation includes pending invites the removed member could
        misuse"), so a capability created by the account must not outlive
        it. Non-active invites are left alone — they are already spent. */
  const groupInvitesRevoked = (
    await tx.groupInvite.updateMany({
      where: { createdByUserId: userId, status: "active" },
      data: { status: "revoked", revokedAt: now },
    })
  ).count;
  const circleInvitesRevoked = (
    await tx.circleInvite.updateMany({
      where: { createdByUserId: userId, status: "active" },
      data: { status: "revoked", revokedAt: now },
    })
  ).count;

  /* 5. Anonymise the nullable actor columns that carry NO foreign key.
        Nulling (rather than deleting the rows) keeps other people's audit
        trail intact while removing the link to this account. */
  await Promise.all([
    tx.circleAuditEvent.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: null },
    }),
    tx.groupJoinRequest.updateMany({
      where: { resolvedByUserId: userId },
      data: { resolvedByUserId: null },
    }),
    tx.circleJoinRequest.updateMany({
      where: { resolvedByUserId: userId },
      data: { resolvedByUserId: null },
    }),
    tx.guestPassInvite.updateMany({
      where: { redeemedByUserId: userId },
      data: { redeemedByUserId: null },
    }),
  ]);

  /* `MembershipClaim.paymentRequestId` is a bare string with no FK, so the
     cascade would leave it pointing at a payment request that no longer
     exists. Drop the pointer first. */
  const myPaymentRequests = await tx.paymentRequest.findMany({
    where: { userId },
    select: { id: true },
  });
  if (myPaymentRequests.length > 0) {
    await tx.membershipClaim.updateMany({
      where: { paymentRequestId: { in: myPaymentRequests.map((p) => p.id) } },
      data: { paymentRequestId: null },
    });
  }

  /* 6. The four relations that REFUSE a cascading delete. These are the
        reason a bare `user.delete()` fails; each one is cleared here. */
  const daggerCommands = (await tx.daggerCommand.deleteMany({ where: { userId } })).count;
  const deviceRevocations = (await tx.deviceRevocation.deleteMany({ where: { userId } })).count;
  const devices = (await tx.device.deleteMany({ where: { userId } })).count;

  /* `AdviserInvitation.createdByAdminId` is `onDelete: Restrict`, so the
     invitations an admin ISSUED must go before the admin can. The
     invitations this account REDEEMED are untouched — the adviser keeps
     `membershipOrigin = "founding_adviser"` on their own User row, so the
     cohort record of WHO is an adviser survives; only the issuer's own
     issue/event log is erased. */
  const adviserInvitationsDeleted = (
    await tx.adviserInvitation.deleteMany({ where: { createdByAdminId: userId } })
  ).count;

  /* 7. The account row. This is what fans out: cascades take sessions,
        participations, reactions, key wraps, join requests, circle
        memberships, blocks in both directions, push subscriptions,
        notifications, privacy settings, owned guest passes, uploaded
        attachment blobs and payment requests; `Message.authorId` is set to
        null so authored history survives anonymised. */
  await tx.user.delete({ where: { id: userId } });

  return {
    userId: user.id,
    handle: user.handle,
    devices,
    deviceRevocations,
    daggerCommands,
    adviserInvitationsDeleted,
    sessions,
    participations,
    attachmentBlobs,
    reactions,
    keyWraps,
    pushSubscriptions,
    notifications,
    guestPassesOwned,
    paymentRequests,
    blocks,
    messagesAuthoredAnonymised,
    groupInvitesRevoked,
    circleInvitesRevoked,
    groupsOwnershipTransferred,
    groupsLeftOwnerless,
    circlesOwnershipTransferred,
    circlesDeleted,
    deletedAt: now.toISOString(),
  };
}

/** Erase one account atomically. Throws `user_not_found` if it is already gone. */
export async function deleteUserAccount(userId: string): Promise<AccountDeletionSummary> {
  return db.$transaction((tx) => deleteUserAccountInTransaction(tx, userId), {
    timeout: DELETION_TX_TIMEOUT_MS,
    maxWait: 10_000,
  });
}

/* ------------------------------------------------------------------ *
 * Portability
 * ------------------------------------------------------------------ */

/**
 * What a full export deliberately does NOT contain, stated in the payload
 * itself so the recipient is never misled into thinking it is complete.
 */
export const EXPORT_OMISSIONS = [
  "Password hash and the passphrase-wrapped private key backup — never exported.",
  "Session and device token hashes — only the hashes are stored, and they are credentials, not data.",
  "Encrypted attachment bytes — listed as metadata only; the ciphertext can be large and is fetchable per message.",
] as const;

/** Hard cap so one very chatty account cannot build an unbounded response. */
export const EXPORT_MESSAGE_CAP = 5000;

export interface AccountExport {
  format: "cloak-account-export/1";
  exportedAt: string;
  account: {
    id: string;
    handle: string;
    email: string | null;
    emailVerifiedAt: string | null;
    displayName: string;
    about: string | null;
    identityPublicKey: string | null;
    membershipTier: string | null;
    membershipOrigin: string | null;
    membershipGrantedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: { id: string; deviceId: string | null; deviceName: string | null; createdAt: string; lastUsedAt: string; expiresAt: string }[];
  devices: { id: string; name: string | null; createdAt: string; lastSeenAt: string; revokedAt: string | null }[];
  deviceRevocations: { deviceId: string; reason: string; revokedAt: string }[];
  conversations: { id: string; isGroup: boolean; title: string | null; role: string; joinedAt: string; historyFrom: string | null; removedAt: string | null }[];
  messagesAuthored: { id: string; conversationId: string; kind: string; body: string; createdAt: string; expiresAt: string | null }[];
  messagesTruncated: boolean;
  attachments: { id: string; conversationId: string; byteSize: number; keyVersion: number; createdAt: string; expiresAt: string | null }[];
  reactions: { messageId: string; emoji: string; createdAt: string }[];
  blocks: {
    issued: { blockedId: string; createdAt: string }[];
    received: { blockerId: string; createdAt: string }[];
  };
  notifications: { id: string; type: string; title: string; body: string | null; createdAt: string; readAt: string | null }[];
  privacySettings: { groupInvitePolicy: string; circleInvitePolicy: string; defaultAiAccess: string; updatedAt: string } | null;
  circles: {
    owned: { id: string; name: string; kind: string; createdAt: string }[];
    memberships: { circleId: string; role: string; joinedAt: string; removedAt: string | null }[];
  };
  guestPasses: {
    owned: { id: string; slotIndex: number; status: string; redeemedByUserId: string | null; issuedAt: string | null; redeemedAt: string | null }[];
    redeemed: { id: string; ownerUserId: string; status: string; redeemedAt: string | null }[];
  };
  payments: {
    requests: { id: string; sku: string; amountAtomic: string; reference: string; status: string; signature: string | null; createdAt: string; expiresAt: string }[];
    claims: { id: string; signature: string; sku: string; membership: string; status: string; redeemedAt: string | null; createdAt: string }[];
  };
  adviserInvitations: {
    issued: { id: string; recipientName: string; recipientEmail: string; status: string; createdAt: string; expiresAt: string }[];
    redeemed: { id: string; recipientName: string; status: string; redeemedAt: string | null }[];
  };
  omissions: readonly string[];
}

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/**
 * Everything the server holds about one account, as portable JSON.
 *
 * Secret material is excluded by construction: the account object is built
 * field-by-field rather than spread from the Prisma row, so a future column
 * cannot leak into an export by accident. Message bodies are the stored
 * CIPHERTEXT envelopes — the server cannot read them, and they are the
 * user's own data, so they are included verbatim.
 */
export async function exportUserData(userId: string): Promise<AccountExport> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user_not_found");

  const [
    sessions,
    devices,
    deviceRevocations,
    participations,
    messages,
    attachments,
    reactions,
    blocksIssued,
    blocksReceived,
    notifications,
    privacy,
    circlesOwned,
    circleMemberships,
    passesOwned,
    passesRedeemed,
    paymentRequests,
    claims,
    invitationsIssued,
    invitationsRedeemed,
  ] = await Promise.all([
    db.session.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.device.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.deviceRevocation.findMany({ where: { userId }, orderBy: { revokedAt: "asc" } }),
    db.participation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.message.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: "asc" },
      take: EXPORT_MESSAGE_CAP + 1,
    }),
    db.attachmentBlob.findMany({ where: { authorId: userId }, orderBy: { createdAt: "asc" } }),
    db.messageReaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.blockedUser.findMany({ where: { blockerId: userId }, orderBy: { createdAt: "asc" } }),
    db.blockedUser.findMany({ where: { blockedId: userId }, orderBy: { createdAt: "asc" } }),
    db.userNotification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.userPrivacySettings.findUnique({ where: { userId } }),
    db.circle.findMany({ where: { ownerUserId: userId }, orderBy: { createdAt: "asc" } }),
    db.circleMember.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.guestPass.findMany({ where: { ownerUserId: userId }, orderBy: { slotIndex: "asc" } }),
    db.guestPass.findMany({ where: { redeemedByUserId: userId }, orderBy: { createdAt: "asc" } }),
    db.paymentRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.membershipClaim.findMany({ where: { redeemedByUserId: userId }, orderBy: { createdAt: "asc" } }),
    db.adviserInvitation.findMany({ where: { createdByAdminId: userId }, orderBy: { createdAt: "asc" } }),
    db.adviserInvitation.findMany({ where: { redeemedByUserId: userId }, orderBy: { createdAt: "asc" } }),
  ]);

  const messagesTruncated = messages.length > EXPORT_MESSAGE_CAP;
  const trimmed = messagesTruncated ? messages.slice(0, EXPORT_MESSAGE_CAP) : messages;

  return {
    format: "cloak-account-export/1",
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      handle: user.handle,
      email: user.email,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      displayName: user.displayName,
      about: user.about,
      identityPublicKey: user.identityPublicKey,
      membershipTier: user.membershipTier,
      membershipOrigin: user.membershipOrigin,
      membershipGrantedAt: iso(user.membershipGrantedAt),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    /* Token HASHES are omitted — they are credentials, and a hash of a live
       credential is still a credential-shaped thing to hand around. */
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      revokedAt: iso(d.revokedAt),
    })),
    deviceRevocations: deviceRevocations.map((r) => ({
      deviceId: r.deviceId,
      reason: r.reason,
      revokedAt: r.revokedAt.toISOString(),
    })),
    conversations: participations.map((p) => ({
      id: p.conversationId,
      isGroup: false,
      title: null,
      role: p.role,
      joinedAt: p.createdAt.toISOString(),
      historyFrom: iso(p.historyFrom),
      removedAt: iso(p.removedAt),
    })),
    messagesAuthored: trimmed.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      kind: m.kind,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      expiresAt: iso(m.expiresAt),
    })),
    messagesTruncated,
    attachments: attachments.map((a) => ({
      id: a.id,
      conversationId: a.conversationId,
      byteSize: a.byteSize,
      keyVersion: a.keyVersion,
      createdAt: a.createdAt.toISOString(),
      expiresAt: iso(a.expiresAt),
    })),
    reactions: reactions.map((r) => ({
      messageId: r.messageId,
      emoji: r.emoji,
      createdAt: r.createdAt.toISOString(),
    })),
    blocks: {
      issued: blocksIssued.map((b) => ({ blockedId: b.blockedId, createdAt: b.createdAt.toISOString() })),
      received: blocksReceived.map((b) => ({ blockerId: b.blockerId, createdAt: b.createdAt.toISOString() })),
    },
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      readAt: iso(n.readAt),
    })),
    privacySettings: privacy
      ? {
          groupInvitePolicy: privacy.groupInvitePolicy,
          circleInvitePolicy: privacy.circleInvitePolicy,
          defaultAiAccess: privacy.defaultAiAccess,
          updatedAt: privacy.updatedAt.toISOString(),
        }
      : null,
    circles: {
      owned: circlesOwned.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        createdAt: c.createdAt.toISOString(),
      })),
      memberships: circleMemberships.map((m) => ({
        circleId: m.circleId,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
        removedAt: iso(m.removedAt),
      })),
    },
    guestPasses: {
      owned: passesOwned.map((p) => ({
        id: p.id,
        slotIndex: p.slotIndex,
        status: p.status,
        redeemedByUserId: p.redeemedByUserId,
        issuedAt: iso(p.issuedAt),
        redeemedAt: iso(p.redeemedAt),
      })),
      redeemed: passesRedeemed.map((p) => ({
        id: p.id,
        ownerUserId: p.ownerUserId,
        status: p.status,
        redeemedAt: iso(p.redeemedAt),
      })),
    },
    payments: {
      requests: paymentRequests.map((p) => ({
        id: p.id,
        sku: p.sku,
        amountAtomic: p.amountAtomic,
        reference: p.reference,
        status: p.status,
        signature: p.signature,
        createdAt: p.createdAt.toISOString(),
        expiresAt: p.expiresAt.toISOString(),
      })),
      claims: claims.map((c) => ({
        id: c.id,
        signature: c.signature,
        sku: c.sku,
        membership: c.membership,
        status: c.status,
        redeemedAt: iso(c.redeemedAt),
        createdAt: c.createdAt.toISOString(),
      })),
    },
    /* `tokenHash` / `setupTokenHash` are deliberately absent. */
    adviserInvitations: {
      issued: invitationsIssued.map((i) => ({
        id: i.id,
        recipientName: i.recipientName,
        recipientEmail: i.recipientEmail,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      })),
      redeemed: invitationsRedeemed.map((i) => ({
        id: i.id,
        recipientName: i.recipientName,
        status: i.status,
        redeemedAt: iso(i.redeemedAt),
      })),
    },
    omissions: EXPORT_OMISSIONS,
  };
}
