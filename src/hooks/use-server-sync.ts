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
const MAX_POLL_MS = 15000;

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
      }

      const current = useCloakStore.getState();
      const currentActiveId = current.activeConversationId;
      if (!currentActiveId || !current.conversations.some((c) => c.id === currentActiveId)) {
        /* E2EE key maintenance is serialized with the polling loop so the
           Supabase pooler is not hit by list/messages/keys in parallel. */
        await store.syncE2eeKeys();
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
      finishTick(tickOk);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);
}
