"use client";

/*
 * MobileHeaderMenu (owner direction, mobile de-clutter round) — the
 * three-dot overflow menu for the mobile header. The header itself now
 * carries only the notifications bell and this menu; the controls that
 * used to be standalone header icons moved here:
 *   - Cloak Mode (guard-aware toggle — ON is immediate, OFF may ask for
 *     PIN / biometric verification via the Cloak gate)
 *   - Dagger (opens the shared hold-to-confirm dialog host)
 *   - Security (the /app/security centre)
 * The desktop rail keeps its full labelled rows (codex §2) — this menu
 * is the mobile equivalent of that bottom rail group.
 */

import { useState } from "react";
import { navigate } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import { EyeIcon, EyeOffIcon, ShieldCheckIcon } from "@animateicons/react/lucide";
import { useCloakModeSwitch } from "@/hooks/use-cloak-mode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { EllipsisVerticalIcon } from "@/components/cloak/shared/ellipsis-vertical-icon";
import { DaggerGlyph, useDaggerDialog } from "@/components/cloak/security/dagger";

/** Small stagger so two Radix dialogs never swap in the same frame. */
const DIALOG_HANDOFF_MS = 80;

export function MobileHeaderMenu() {
  const [open, setOpen] = useState(false);
  const { cloakMode, toggle } = useCloakModeSwitch();
  const openDaggerDialog = useDaggerDialog((s) => s.openDialog);

  /* Turning Cloak Mode OFF may open the PIN / biometric gate — close this
     menu first so the gate is the only dialog on screen. Turning ON is
     immediate and flips the row live inside the open menu. */
  const handleCloakToggle = () => {
    if (!cloakMode) {
      toggle();
      return;
    }
    setOpen(false);
    window.setTimeout(() => toggle(), DIALOG_HANDOFF_MS);
  };

  /* The Dagger confirmation lives in the app-shell dialog host — hand
     off cleanly instead of stacking dialogs. */
  const handleDagger = () => {
    setOpen(false);
    window.setTimeout(() => openDaggerDialog(), DIALOG_HANDOFF_MS);
  };

  const handleSecurity = () => {
    setOpen(false);
    navigate("/app/security");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Menu"
        className="grid h-9 w-9 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface hover:text-cloak-text focus-visible:outline-2 focus-visible:outline-cloak-gold/70"
      >
        <EllipsisVerticalIcon size={20} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <RiseDialogContent
          aria-describedby={undefined}
          className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-xs"
        >
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">Menu</DialogTitle>
          </DialogHeader>

          <div className="space-y-1 pb-1">
            {/* Cloak Mode — mirrors the desktop rail row (icon + state pill). */}
            <button
              type="button"
              onClick={handleCloakToggle}
              aria-pressed={cloakMode}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                cloakMode
                  ? "bg-cloak-gold-soft text-cloak-gold"
                  : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
              )}
            >
              {cloakMode ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
              <span className="flex-1 whitespace-nowrap text-left">Cloak Mode</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  cloakMode
                    ? "bg-cloak-gold/20 text-cloak-gold"
                    : "border border-cloak-border text-cloak-text-muted"
                )}
              >
                {cloakMode ? "On" : "Off"}
              </span>
            </button>

            {/* Dagger — same confirmation dialog as every other entry point. */}
            <button
              type="button"
              onClick={handleDagger}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-cloak-text-secondary transition-colors hover:bg-cloak-surface hover:text-cloak-danger"
            >
              <DaggerGlyph size={17} />
              <span className="flex-1 whitespace-nowrap text-left">Dagger</span>
              <span className="rounded-full border border-cloak-border px-2 py-0.5 text-[10px] font-medium text-cloak-text-muted">
                Emergency
              </span>
            </button>

            {/* Security centre — was a bottom-nav tab; now one tap away here. */}
            <button
              type="button"
              onClick={handleSecurity}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-cloak-text-secondary transition-colors hover:bg-cloak-surface hover:text-cloak-text"
            >
              <ShieldCheckIcon size={17} />
              <span className="flex-1 whitespace-nowrap text-left">Security</span>
            </button>
          </div>
        </RiseDialogContent>
      </Dialog>
    </>
  );
}
