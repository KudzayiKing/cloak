"use client";

/*
 * Cached conversation list.
 *
 * Needed for offline history to be REACHABLE at all. Messages are cached per
 * conversation, but on a cold start with no network the app would not know which
 * conversations exist, so the inbox would render empty and the cached history
 * would sit there unreachable. This mirrors just enough of each conversation for
 * the list to render.
 *
 * Server truth is not duplicated here: `unreadCount`, `historyHasMore` and
 * `historyLoading` are deliberately NOT cached — they are live state that would
 * be wrong the moment it was written, and a stale unread badge is worse than no
 * badge. Everything persisted is durable metadata.
 */

import type { Conversation } from "./types";
import { currentVaultUserId } from "@/lib/crypto/local-vault";
import {
  STORE_CONVERSATIONS,
  deleteFromStore,
  getAllFromStore,
  withStore,
} from "./local-db";

export interface CachedConversationRow
  extends Omit<
    Conversation,
    "messages" | "unreadCount" | "historyHasMore" | "historyLoading"
  > {
  /** Which account wrote this row — the DB is keyed by origin, not by account. */
  ownerUserId: string;
  cachedAt: number;
}

export async function cacheConversations(conversations: Conversation[]): Promise<void> {
  if (!conversations.length) return;
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  const cachedAt = Date.now();
  for (const c of conversations) {
    if (!c?.id) continue;
    const row: CachedConversationRow = {
      id: c.id,
      ownerUserId,
      contactId: c.contactId,
      isGroup: c.isGroup,
      groupName: c.groupName,
      groupDescription: c.groupDescription,
      groupMemberIds: c.groupMemberIds,
      memberCount: c.memberCount,
      myRole: c.myRole,
      pinned: c.pinned,
      muted: c.muted,
      ghost: c.ghost,
      ghostTimer: c.ghostTimer,
      locked: c.locked,
      aiAccess: c.aiAccess,
      aiEffective: c.aiEffective,
      aiCircleDefault: c.aiCircleDefault,
      persistentMemory: c.persistentMemory,
      historyPolicy: c.historyPolicy,
      circleId: c.circleId,
      circleName: c.circleName,
      cachedAt,
    };
    try {
      await withStore(STORE_CONVERSATIONS, "readwrite", (store) => store.put(row));
    } catch {
      /* best effort */
    }
  }
}

/** Rebuild the conversation list from cache. The server owns ordering, so the
 *  caller re-sorts once the real list arrives. Messages are attached separately
 *  by the store. */
export async function loadCachedConversations(): Promise<Conversation[]> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return [];
  const rows = await getAllFromStore<CachedConversationRow>(STORE_CONVERSATIONS);
  return rows
    .filter((row) => row.ownerUserId === ownerUserId)
    .map((row) => ({
      id: row.id,
    contactId: row.contactId,
    isGroup: row.isGroup,
    groupName: row.groupName,
    groupDescription: row.groupDescription,
    groupMemberIds: row.groupMemberIds,
    memberCount: row.memberCount,
    myRole: row.myRole,
    pinned: row.pinned,
    muted: row.muted,
    ghost: row.ghost,
    ghostTimer: row.ghostTimer,
    locked: row.locked,
    aiAccess: row.aiAccess,
    aiEffective: row.aiEffective,
    aiCircleDefault: row.aiCircleDefault,
    persistentMemory: row.persistentMemory,
    historyPolicy: row.historyPolicy,
    circleId: row.circleId,
    circleName: row.circleName,
    /* Live fields start empty; the server's next sync fills them. */
    unreadCount: 0,
    messages: [],
  }));
}

/** Drop a cached conversation. Also used when the server reports one is gone. */
export async function deleteCachedConversationRow(id: string): Promise<void> {
  await deleteFromStore(STORE_CONVERSATIONS, id);
}
