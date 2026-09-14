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

import { useEffect, useRef } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import type { ServerConversation, ServerContact, ServerMessage } from "@/stores/cloak-store";

const POLL_MS = 2500;

export function useServerSync(enabled: boolean) {
  const activeIdRef = useRef<string | null>(null);
  const lastIncomingRef = useRef<string | null>(null);

  useEffect(() => {
    useCloakStore.subscribe((state) => {
      activeIdRef.current = state.activeConversationId;
    });
    activeIdRef.current = useCloakStore.getState().activeConversationId;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const store = useCloakStore.getState();
      if (!store.auth.user) return;

      const activeId = activeIdRef.current;

      const list = await fetch("/api/conversations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (cancelled) return;
      if (list?.ok) {
        await store.mergeConversationList(
          activeId,
          list.contacts as ServerContact[],
          list.conversations as ServerConversation[]
        );
      }

      /* E2EE key maintenance: provision/unwrap/heal at a gentle cadence
         (cooldown-guarded inside the store action). */
      void store.syncE2eeKeys();

      const current = useCloakStore.getState();
      const currentActiveId = current.activeConversationId;
      if (!currentActiveId || !current.conversations.some((c) => c.id === currentActiveId)) return;

      /* Poll the newest window only (50) — older pages are pulled on
         demand by "load earlier messages" and survive polls via the
         store's merge semantics. */
      const detail = await fetch(`/api/conversations/${currentActiveId}/messages?limit=50`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (cancelled || activeIdRef.current !== currentActiveId) return;
      if (detail?.ok) {
        const messages = detail.messages as ServerMessage[];
        await store.replaceServerMessages(currentActiveId, messages, detail.hasMore);

        /* New incoming while the chat is open -> mark read right away. */
        const newest = messages[messages.length - 1];
        if (newest && newest.authorId !== "me" && newest.id !== lastIncomingRef.current) {
          lastIncomingRef.current = newest.id;
          void fetch(`/api/conversations/${currentActiveId}/read`, { method: "POST" }).catch(
            () => undefined
          );
        }
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
