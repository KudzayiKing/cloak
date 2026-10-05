"use client";

/*
 * useServerSync — client transport loop for authenticated messaging.
 *
 * v1 uses short polling (the preview proxy carries HTTP reliably; a
 * socket.io upgrade can slot in behind the same store actions later):
 *   - every tick: light conversation-list refresh (previews + unread)
 *   - active conversation: full history replace (server truth, keeps
 *     tick states flowing: sent -> delivered -> read)
 * A new incoming message while its chat is open is marked read
 * immediately, which drives the peer's read ticks.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { flushOutbox, useCloakStore } from "@/stores/cloak-store";
import type { ServerConversation, ServerContact, ServerMessage } from "@/stores/cloak-store";
import { toast } from "@/hooks/use-toast";
import { notificationForIncomingMessage } from "@/lib/cloak/notifications";
import { playIncomingMessageSound } from "@/lib/cloak/message-sound";

/**
 * Surface a foreground in-app notification for genuinely new incoming
 * messages, honoring the user's "Name and message" / Cloak Mode settings.
 *
 * This is the path that actually respects those settings: the OS push is
 * E2EE-blind (the server never sees message content and cannot evaluate
 * Cloak Mode), so the service worker suppresses it while the app is in the
 * foreground and lets this in-app surface show the real preview. We only
 * consider conversations that are NOT currently open (the open one is
 * rendered inline and marked read by the sync loop), and we never re-toast a
 * message whose id we have already seen.
 */
function surfaceIncomingToasts(
  seenIds: MutableRefObject<Set<string>>,
  seeded: MutableRefObject<boolean>
) {
  const state = useCloakStore.getState();
  if (!state.auth.user) return;
  const activeId = state.activeConversationId;
  const previews = state.notifications.previews;
  const sounds = state.notifications.sounds;
  const cloakMode = state.cloakMode;
  for (const conv of state.conversations) {
    const msgs = conv.messages;
    if (!msgs || msgs.length === 0) continue;
    const newest = msgs[msgs.length - 1];
    const aid = String(newest.authorId ?? "");
    if (aid === "me" || aid === "system" || aid === "cloak") continue;
    if (seeded.current) {
      if (seenIds.current.has(newest.id)) continue;
      seenIds.current.add(newest.id);
      if (conv.id === activeId) {
        if (sounds) playIncomingMessageSound();
        continue; // visible inline; no toast
      }
      const note = notificationForIncomingMessage({
        senderName: newest.authorName || "Someone",
        body: newest.body || "",
        cloakMode,
        previews,
      });
      toast({ title: note.title, description: note.body, duration: 6000 });
      if (sounds) playIncomingMessageSound();
    } else {
      seenIds.current.add(newest.id);
    }
  }
  seeded.current = true;
}

const POLL_MS = 2500;
const MAX_POLL_MS = 15000;

export function useServerSync(enabled: boolean) {
  const activeIdRef = useRef<string | null>(null);
  const lastIncomingRef = useRef<string | null>(null);
  /** Ids of incoming messages we have already surfaced as a foreground
   *  notification, so a steady-state poll never re-toasts the same message. */
  const seenIdsRef = useRef<Set<string>>(new Set());
  /** Seeded ids for the open conversation let us detect new arrivals without
   *  sounding for the history returned by its first poll. */
  const activeMessageIdsRef = useRef<Map<string, Set<string>>>(new Map());
  /** Whether the backlog has been seeded — until the first list arrives we
   *  must not toast the user's entire history on login. */
  const seededRef = useRef(false);

  useEffect(() => {
    useCloakStore.subscribe((state) => {
      activeIdRef.current = state.activeConversationId;
    });
    activeIdRef.current = useCloakStore.getState().activeConversationId;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let failureCount = 0;

    const schedule = (delay = POLL_MS) => {
      if (cancelled) return;
      timer = window.setTimeout(() => void tick(), delay);
    };

    const backoffDelay = () =>
      Math.min(MAX_POLL_MS, POLL_MS * 2 ** Math.min(failureCount, 3));

    const finishTick = (ok: boolean) => {
      failureCount = ok ? 0 : failureCount + 1;
      schedule(ok ? POLL_MS : backoffDelay());
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule(MAX_POLL_MS);
        return;
      }
      const store = useCloakStore.getState();
      if (!store.auth.user) {
        schedule();
        return;
      }

      const activeId = activeIdRef.current;
      let tickOk = true;

      const list = await fetch("/api/conversations", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) tickOk = false;
          return r.ok ? r.json() : null;
        })
        .catch(() => {
          tickOk = false;
          return null;
        });
      if (cancelled) return;
      if (list?.ok) {
        await store.mergeConversationList(
          activeId,
          list.contacts as ServerContact[],
          list.conversations as ServerConversation[]
        );
        /* In-app new-message notification (honors "Name and message" /
           Cloak Mode). The OS push for this is suppressed by the service
           worker while the app is foreground, so this is the only surface. */
        surfaceIncomingToasts(seenIdsRef, seededRef);
      }

      const current = useCloakStore.getState();
      const currentActiveId = current.activeConversationId;
      if (!currentActiveId || !current.conversations.some((c) => c.id === currentActiveId)) {
        /* E2EE key maintenance is serialized with the polling loop so the
           Supabase pooler is not hit by list/messages/keys in parallel. */
        await store.syncE2eeKeys();
        /* No chat open is exactly when a queued message most needs to go. */
        if (tickOk) void flushOutbox();
        finishTick(tickOk);
        return;
      }

      /* Poll the newest window only (50) — older pages are pulled on
         demand by "load earlier messages" and survive polls via the
         store's merge semantics. */
      const detail = await fetch(`/api/conversations/${currentActiveId}/messages?limit=50`, {
        cache: "no-store",
      })
        .then((r) => {
          if (!r.ok) tickOk = false;
          return r.ok ? r.json() : null;
        })
        .catch(() => {
          tickOk = false;
          return null;
        });
      if (cancelled) return;
      if (activeIdRef.current !== currentActiveId) {
        finishTick(tickOk);
        return;
      }
      if (detail?.ok) {
        const messages = detail.messages as ServerMessage[];
        const knownIds = activeMessageIdsRef.current.get(currentActiveId);
        const currentConversation = useCloakStore.getState().conversations.find(
          (conversation) => conversation.id === currentActiveId
        );
        const seededIds = knownIds ?? new Set(currentConversation?.messages.map((message) => message.id) ?? []);
        const incoming = messages.filter(
          (message) => message.authorId !== "me" && !seededIds.has(message.clientKey || message.id)
        );
        const unsurfacedIncoming = incoming.filter(
          (message) => !seenIdsRef.current.has(message.clientKey || message.id)
        );
        if (knownIds && unsurfacedIncoming.length > 0 && useCloakStore.getState().notifications.sounds) {
          playIncomingMessageSound();
        }
        for (const message of messages) {
          const id = message.clientKey || message.id;
          seededIds.add(id);
          seenIdsRef.current.add(id);
        }
        activeMessageIdsRef.current.set(currentActiveId, seededIds);
        await store.replaceServerMessages(currentActiveId, messages, detail.hasMore);

        /* New incoming while the chat is open -> mark read right away. */
        const newest = messages[messages.length - 1];
        if (newest && newest.authorId !== "me" && newest.id !== lastIncomingRef.current) {
          lastIncomingRef.current = newest.id;
          const read = await fetch(`/api/conversations/${currentActiveId}/read`, { method: "POST" })
            .then((r) => r.ok)
            .catch(() => false);
          if (!read) tickOk = false;
        }
      }

      await store.syncE2eeKeys();
      /* Drain pending sends, at the END of the tick and after key maintenance
         so it stays serialized with the poll rather than racing it. Only when
         this tick actually reached the server: a failed tick means we are
         offline and the flush would fail identically. This is also the trigger
         that covers a reconnect the `online` event never fired for. */
      if (tickOk) void flushOutbox();
      finishTick(tickOk);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);
}
