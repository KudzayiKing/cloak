"use client";

import { useState, useSyncExternalStore } from "react";
import { DownloadIcon } from "@animateicons/react/lucide";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import {
  serverUpdatePhase,
  subscribeUpdate,
  updatePhase,
} from "@/lib/cloak/pwa-update";

/*
 * Bottom install prompt for mobile browsers. The header/install button is easy
 * to miss on small screens, so this mirrors the update prompt style and docks
 * above the mobile nav until the user installs or dismisses it for the session.
 */
export function PwaInstallPrompt() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const update = useSyncExternalStore(
    subscribeUpdate,
    updatePhase,
    serverUpdatePhase
  );
  const { canInstall, support, installed, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!isMobile || installed || dismissed || update !== "idle") return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const outcome = canInstall ? await install() : "manual";
      if (outcome === "accepted") {
        setDismissed(true);
        return;
      }
      if (outcome === "manual") {
        setManualOpen(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  const instructions =
    support === "manual-ios"
      ? "Open Share, then choose Add to Home Screen."
      : "Use your browser menu and choose Install app or Add to Home screen.";

  return (
    <div
      role="dialog"
      aria-label="Install Cloak Dagger"
      className="cloak-install-prompt cloak-message-in fixed inset-x-0 z-50 mx-auto flex w-[min(26rem,calc(100%-1.5rem))] items-start gap-3 rounded-2xl border border-cloak-border-strong bg-cloak-bg-elevated/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur-xl md:hidden"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-surface">
        <CloakLogoImage size={26} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-cloak-text">
          Install Cloak Dagger
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
          Add Cloak Dagger to your home screen for the full-screen private app
          experience.
        </p>

        {manualOpen && (
          <p className="mt-2 rounded-lg border border-cloak-border bg-cloak-surface px-2.5 py-2 text-[11.5px] leading-relaxed text-cloak-text-secondary">
            {instructions}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="cloak-cta-gold inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/20 px-3 text-[12px] font-medium text-[#141310] disabled:opacity-60"
          >
            <DownloadIcon size={13} />
            {installing ? "Opening..." : "Install"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            disabled={installing}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-cloak-text-muted transition-colors hover:text-cloak-text disabled:opacity-40"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
