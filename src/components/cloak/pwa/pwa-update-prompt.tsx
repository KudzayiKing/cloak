"use client";

import { useSyncExternalStore } from "react";
import { LoaderCircleIcon, RefreshCwIcon } from "@animateicons/react/lucide";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import {
  applyUpdate,
  dismissUpdate,
  serverUpdatePhase,
  subscribeUpdate,
  updatePhase,
} from "@/lib/cloak/pwa-update";

/*
 * PwaUpdatePrompt — docks at the bottom of the installed app when a new bundle
 * is staged and waiting to take over.
 *
 * It is a prompt, not an interruption. The service worker no longer self-skips,
 * so the app keeps running the bundle it loaded until the user taps Refresh
 * (see src/lib/cloak/pwa-update.ts for the full reasoning). "Later" is a real
 * option: it silences the prompt for the rest of the session rather than
 * nagging on every 60s update poll.
 *
 * Docking: the mobile bottom nav is a fixed 56px overlay, so the card sits
 * above it using --cloak-bottom-nav-h, which AppShell publishes (and which is
 * 0px inside a conversation, where the nav is hidden). On desktop the media
 * query in globals.css drops it to a plain bottom margin.
 */
export function PwaUpdatePrompt() {
  const phase = useSyncExternalStore(
    subscribeUpdate,
    updatePhase,
    serverUpdatePhase
  );

  if (phase === "idle") return null;
  const applying = phase === "applying";

  return (
    <div
      role="status"
      aria-live="polite"
      className="cloak-update-prompt cloak-message-in fixed inset-x-0 z-50 mx-auto flex w-[min(26rem,calc(100%-1.5rem))] items-start gap-3 rounded-2xl border border-cloak-border-strong bg-cloak-bg-elevated/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur-xl"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-surface">
        <CloakLogoImage size={26} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-cloak-text">
          A new version of Cloaq is ready
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
          Refresh to load the latest fixes. Your messages stay on this device.
        </p>

        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={applyUpdate}
            disabled={applying}
            className="cloak-cta-gold inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/20 px-3 text-[12px] font-medium text-[#141310] disabled:opacity-60"
          >
            {applying ? (
              <LoaderCircleIcon size={13} className="animate-spin" />
            ) : (
              <RefreshCwIcon size={13} />
            )}
            {applying ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={dismissUpdate}
            disabled={applying}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-cloak-text-muted transition-colors hover:text-cloak-text disabled:opacity-40"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
