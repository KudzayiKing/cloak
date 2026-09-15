"use client";

/*
 * InstallPWAButton (spec §10-J, §28).
 * Uses the native install prompt when available; otherwise shows
 * platform-appropriate instructions. Honest states only.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { DownloadIcon } from "@animateicons/react/lucide";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function InstallPWAButton({
  size = "default",
  variant = "default",
  className,
  label = "Install Cloaq",
}: {
  size?: "default" | "lg" | "sm";
  variant?: "default" | "outline" | "gold";
  className?: string;
  label?: string;
}) {
  const { canInstall, support, installed, install } = usePWAInstall();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (installed) {
    return (
      <Button
        variant="outline"
        size={size}
        disabled
        className={cn("border-cloak-border text-cloak-text-muted", className)}
      >
        Installed
      </Button>
    );
  }

  const handle = async () => {
    if (canInstall) {
      const outcome = await install();
      if (outcome === "manual") setOpen(true);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        size={size}
        variant={variant === "gold" ? "default" : variant}
        onClick={handle}
        className={cn(
          variant === "gold" &&
            "bg-cloak-gold/20 hover:bg-cloak-gold/25 border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold",
          variant === "outline" &&
            "border-cloak-border-strong bg-transparent text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text",
          className
        )}
      >
        <DownloadIcon size={16} className="mr-0.5" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-xl">Install Cloaq</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Cloaq installs as an app and runs full-screen, independent of a
              browser tab.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {support === "manual-ios" && (
              <ol className="list-inside list-decimal space-y-2 text-cloak-text-secondary">
                <li>Open this page in Safari.</li>
                <li>Tap the Share button.</li>
                <li>Choose “Add to Home Screen”.</li>
              </ol>
            )}
            {support === "manual-desktop" && (
              <ol className="list-inside list-decimal space-y-2 text-cloak-text-secondary">
                <li>Look for the install icon in the browser address bar.</li>
                <li>Select “Install Cloaq” and confirm.</li>
              </ol>
            )}
            {support === "unknown" && (
              <p className="text-cloak-text-secondary">
                Open Cloaq in your device browser and use the browser’s install
                option to add it to your home screen.
              </p>
            )}
            {result && <p className="text-cloak-text-muted">{result}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
