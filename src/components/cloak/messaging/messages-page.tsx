"use client";

/*
 * MessagesPage (spec §15) — three-column desktop, two-column tablet,
 * single view with bottom nav on mobile.
 */

import { useState } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { useServerSync } from "@/hooks/use-server-sync";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { ChatSidebar } from "./chat-sidebar";
import { ConversationView } from "./conversation-view";
import { ConversationSecurityPanel } from "./conversation-security-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

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

  return (
    <AppShell
      active="/app/messages"
      /* Mobile header is bell + three-dot menu only (owner de-clutter
         round) — Cloak Mode lives inside that menu now. */
      /* Fullscreen chat on mobile — no header, no bottom nav (user feedback) */
      mobileChrome={!(hasActive && mobileInConversation)}
    >
      <div className="flex h-full min-h-0 bg-cloak-bg">
        {/* Column 1 — chat list */}
        <div
          className={cn(
            "w-full shrink-0 md:w-[300px] lg:w-[330px]",
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
            onOpenSecurityPanel={() => setPanelOpen((v) => !v)}
            securityPanelOpen={panelOpen}
          />
        </div>

        {/* Column 3 — context / security (tablet+, collapsible) */}
        {panelOpen && isTablet && (
          <ConversationSecurityPanel
            onClose={() => setPanelOpen(false)}
            className="w-full md:w-[300px] lg:w-[330px] shrink-0"
          />
        )}

        {/* Mobile: the same panel as a right-side overlay sheet — the 3-dot
            header button previously did nothing below md (user bug report). */}
        {panelOpen && !isTablet && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <button
              aria-label="Close conversation details"
              onClick={() => setPanelOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            />
            <div className="cloak-message-in relative h-full w-[88%] max-w-sm shadow-2xl shadow-black/50">
              <ConversationSecurityPanel onClose={() => setPanelOpen(false)} className="h-full" />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
