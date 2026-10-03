"use client";

/*
 * MessagesPage (spec §15) — three-column desktop, two-column tablet,
 * single view with bottom nav on mobile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { useServerSync } from "@/hooks/use-server-sync";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { ChatSidebar } from "./chat-sidebar";
import { ConversationView } from "./conversation-view";
import { ConversationSecurityPanel } from "./conversation-security-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * How long the drawer's slide-out runs. It has to match the
 * `.cloak-sheet-out-right` duration in globals.css (200ms) closely enough that
 * the panel is never unmounted mid-animation, with a little slack so a slow
 * frame does not clip it.
 */
const SHEET_EXIT_MS = 200;

export function MessagesPage() {
  const activeId = useCloakStore((s) => s.activeConversationId);
  const setActiveConversation = useCloakStore((s) => s.setActiveConversation);
  const authUser = useCloakStore((s) => s.auth.user);
  const [panelOpen, setPanelOpen] = useState(false);
  /* Mobile lands on the chat list — never jump straight into a thread. */
  const [mobileInConversation, setMobileInConversation] = useState(false);
  const isTablet = useMediaQuery("(min-width: 768px)");

  /* Real transport: previews + unread for the list, full history + tick
     states for the open conversation. */
  useServerSync(!!authUser);

  const hasActive = !!activeId;

  /* The mobile drawer is held mounted for the length of its exit animation.
     `panelOpen` is the intent (what the user asked for) and `closing` says the
     intent has been withdrawn but the slide-out has not finished. They differ
     only while closing, so the panel unmounts exactly when the animation ends
     instead of blinking out of existence the instant the state flips. */
  const [closing, setClosing] = useState(false);
  const panelMounted = panelOpen || closing;
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    /* Already on the way out — let the first animation finish rather than
       restarting it. */
    if (closing) return;
    setClosing(true);
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
    }, SHEET_EXIT_MS);
  }, [clearCloseTimer, closing]);

  /* Opening while a close is in flight cancels the exit, so a fast
     open/close/open never leaves the panel stuck half off-screen. */
  const openPanel = useCallback(() => {
    clearCloseTimer();
    setClosing(false);
    setPanelOpen(true);
  }, [clearCloseTimer]);

  /* Never leave a pending unmount behind. */
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <AppShell
      active="/app/messages"
      /* Mobile header is bell + three-dot menu only (owner de-clutter
         round) — Cloak Mode lives inside that menu now. */
      /* Fullscreen chat on mobile — no header, no bottom nav (user feedback) */
      mobileChrome={!(hasActive && mobileInConversation)}
    >
      <div className="flex h-full min-h-0 bg-cloak-bg">
        {/* Column 1 — chat list.
            Web sidebar width is a single value now (owner, round 44): 450px at
            every width from `md` up. It used to be tuned per breakpoint —
            300px at `md`, 330px at `lg` — which meant the list reflowed as you
            dragged a desktop window across 1024px. `md` is this app's "web"
            tier (`isTablet` is the same 768px query), so one value covers
            tablet and desktop alike, and `lg` needs no override. */}
        <div
          className={cn(
            "w-full shrink-0 md:w-[450px]",
            // Mobile: show list only when not inside a conversation
            isTablet ? "flex" : hasActive && mobileInConversation ? "hidden" : "flex"
          )}
        >
          <ChatSidebar
            activeId={activeId}
            onSelect={(id) => {
              setActiveConversation(id);
              setMobileInConversation(true);
            }}
            className="w-full"
          />
        </div>

        {/* Column 2 — conversation */}
        <div
          className={cn(
            "min-w-0 flex-1",
            isTablet ? "flex" : hasActive && mobileInConversation ? "flex" : "hidden"
          )}
        >
          <ConversationView
            onBack={() => setMobileInConversation(false)}
            /* Toggle routes through openPanel so a press while the drawer is
               still sliding out cancels the exit instead of queueing a second
               close behind it. */
            onOpenSecurityPanel={() => (panelOpen ? closePanel() : openPanel())}
            securityPanelOpen={panelOpen}
          />
        </div>

        {/* Column 3 — context / security (tablet+, collapsible).
            Slides in from the right edge it is docked to; see
            .cloak-sheet-in-right. */}
        {panelOpen && isTablet && (
          <div className="cloak-sheet-in-right flex h-full min-h-0 w-full shrink-0 md:w-[300px] lg:w-[330px]">
            <ConversationSecurityPanel onClose={closePanel} className="h-full w-full" />
          </div>
        )}

        {/* Mobile: the same panel as a right-side overlay sheet — the 3-dot
            header button previously did nothing below md (user bug report).

            It now CLOSES the same way it opens. The panel is held mounted
            through its exit animation and only then unmounted, so dismissing
            the drawer slides it back out instead of making it blink out of
            existence. The backdrop fades out ahead of the panel. */}
        {!isTablet && panelMounted && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <button
              aria-label="Close conversation details"
              onClick={closePanel}
              className={cn(
                "absolute inset-0 bg-black/60 backdrop-blur-[2px]",
                closing ? "cloak-fade-out" : "cloak-fade-in"
              )}
            />
            <div
              className={cn(
                "relative h-full w-[88%] max-w-sm shadow-2xl shadow-black/50",
                closing ? "cloak-sheet-out-right" : "cloak-sheet-in-right"
              )}
            >
              <ConversationSecurityPanel onClose={closePanel} className="h-full" />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
