"use client";

/*
 * Dagger UI (codex §2/§3/§4/§20/§25/§44) — icon treatment, activation
 * button, hold-to-confirm dialog and the full-screen lock overlay.
 *
 * Icon (owner direction): the Lucide Sword glyph rotated 225deg clockwise
 * (the glyph's tip is drawn at its top-left, so 225deg — not 135deg — lands
 * the blade pointing straight down; owner correction), animated up and down
 * while hovered with a fine pointer (web) and while
 * pressed (mobile). No continuous animation; prefers-reduced-motion turns
 * the bob off entirely (globals.css .cloak-dagger-* rules).
 *
 * Copy rules: never "kill switch", never "leaves no trace". The dialog
 * carries the exact codex copy (§4) and the single-device warning (§25).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Sword } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCloakStore } from "@/stores/cloak-store";
import { leaveAfterDagger, useDaggerRun } from "@/lib/cloak/dagger";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DaggerGlyph({ size = 17, className }: { size?: number; className?: string }) {
  return <Sword size={size} className={cn("cloak-dagger-glyph", className)} />;
}

/* Global dialog control so the rail button, mobile header, emergency
   gesture and the security centre can all open the same confirmation. */
interface DaggerDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useDaggerDialog = create<DaggerDialogState>()((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));

export function DaggerButton({ variant }: { variant: "rail" | "header" }) {
  const openDialog = useDaggerDialog((s) => s.openDialog);
  const collapsed = useCloakStore((s) => s.sidebarCollapsed);
  const [pressed, setPressed] = useState(false);

  const tooltip = "Dagger — emergency device wipe and revocation";

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={openDialog}
        aria-label="Dagger — emergency device wipe"
        title={tooltip}
        data-pressed={pressed}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        className="cloak-dagger-trigger grid h-9 w-9 place-items-center rounded-full text-cloak-text-muted transition-colors hover:text-cloak-danger focus-visible:outline-2 focus-visible:outline-cloak-gold/70"
      >
        <DaggerGlyph size={18} />
      </button>
    );
  }

  /* Desktop rail — sits directly between Cloak Mode and Settings (§2). */
  return (
    <button
      type="button"
      onClick={openDialog}
      aria-label="Dagger — emergency device wipe"
      title={tooltip}
      data-pressed={pressed}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      className={cn(
        "cloak-dagger-trigger transition-colors focus-visible:outline-2 focus-visible:outline-cloak-gold/70",
        collapsed
          ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
          : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
        "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-danger"
      )}
    >
      <DaggerGlyph size={17} />
      {!collapsed && <span className="whitespace-nowrap">Dagger</span>}
    </button>
  );
}

/* ---------------- Hold-to-confirm (codex §4/§43/§44) ---------------- */

function HoldToDagger({ holdMs, onComplete }: { holdMs: number; onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const active = useRef(false);

  const begin = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setHolding(true);
    startedAt.current = performance.now();
    const tick = (now: number) => {
      if (!active.current) return;
      const p = Math.min(1, (now - startedAt.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        active.current = false;
        setHolding(false);
        setProgress(0);
        onComplete();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [holdMs, onComplete]);

  const cancel = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    setHolding(false);
    setProgress(0);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    []
  );

  return (
    <button
      type="button"
      aria-label="Hold to Dagger — hold for three seconds to destroy this device's Cloak keys and data"
      data-pressed={holding}
      onPointerDown={(e) => {
        e.preventDefault();
        begin();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        /* Keyboard hold = the accessible press-and-hold equivalent (§44). */
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel();
      }}
      className={cn(
        "relative flex-1 select-none overflow-hidden rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
        holding
          ? "border-cloak-danger bg-cloak-danger/20 text-cloak-danger"
          : "border-cloak-danger/40 bg-cloak-danger/10 text-cloak-danger hover:bg-cloak-danger/15"
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-cloak-danger/25"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative flex items-center justify-center gap-2">
        <DaggerGlyph size={15} />
        Hold to Dagger
      </span>
    </button>
  );
}

/* ---------------- Confirmation dialog (codex §4) ---------------- */

export function DaggerDialogHost() {
  const open = useDaggerDialog((s) => s.open);
  const closeDialog = useDaggerDialog((s) => s.closeDialog);
  const runDagger = useCloakStore((s) => s.runDagger);
  const fetchDevices = useCloakStore((s) => s.fetchDevices);
  const devices = useCloakStore((s) => s.devices);
  const holdMs = useCloakStore((s) => s.daggerConfig.confirmationHoldMs);
  const [starting, setStarting] = useState(false);

  /* The single-device warning needs the registry (§25). */
  useEffect(() => {
    if (open) void fetchDevices();
  }, [open, fetchDevices]);

  const onlyDevice = open && devices.length <= 1;

  const activate = () => {
    setStarting(true);
    closeDialog();
    void runDagger();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !starting) closeDialog();
      }}
    >
      <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">Dagger this device</DialogTitle>
          <DialogDescription className="text-cloak-text-secondary">
            This will destroy Cloak&apos;s local keys, private data and device
            authorization on this device.
            <br />
            <br />
            Your Cloak account and other trusted devices will remain active.
            <br />
            <br />
            This cannot be undone on this device.
          </DialogDescription>
        </DialogHeader>

        {onlyDevice && (
          <div className="rounded-lg border border-cloak-warning/30 bg-cloak-warning/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-cloak-text-secondary">
            This is your only trusted device.
            <br />
            Dagger will remove Cloak from this device. You will need your
            recovery method to regain access.
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
            onClick={closeDialog}
          >
            Cancel
          </Button>
          <HoldToDagger holdMs={holdMs} onComplete={activate} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Lock overlay (codex §6/§20/§34) ---------------- */

export function DaggerOverlay() {
  const phase = useDaggerRun((s) => s.phase);
  const result = useDaggerRun((s) => s.result);
  if (phase === "idle") return null;

  if (phase === "active") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-cloak-bg text-center"
      >
        <span className="cloak-dagger-trigger" data-pressed="true">
          <DaggerGlyph size={28} className="text-cloak-text-muted" />
        </span>
        <div>
          <p className="cloak-wordmark text-2xl text-cloak-text">Dagger</p>
          <p className="mt-2 text-[13px] text-cloak-text-secondary">
            Destroying local keys, private data and device authorization.
          </p>
        </div>
      </div>
    );
  }

  /* phase === "complete" — non-silent completion (§20 default). Honest,
     undramatic; includes the platform-limitation small print (§34). */
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-cloak-bg px-6 text-center"
    >
      <span className="cloak-dagger-trigger" data-pressed="true">
        <DaggerGlyph size={26} className="text-cloak-text-muted" />
      </span>
      <p className="cloak-wordmark mt-5 text-2xl text-cloak-text">Dagger complete</p>
      <p className="mt-3 max-w-md text-[13px] leading-relaxed text-cloak-text-secondary">
        {result?.localKeyDestruction === "complete"
          ? "Local keys were destroyed."
          : "Local key destruction reported a failure — treat this device as compromised."}{" "}
        Private data was cleared and this device&apos;s authorization was
        {result?.serverRevocation === "complete" ? " revoked." : " queued for revocation."}
      </p>
      <p className="mt-4 max-w-md text-[11.5px] leading-relaxed text-cloak-text-muted">
        Dagger removes Cloak-controlled local data and device authorization.
        Operating-system or browser artifacts outside Cloak&apos;s control may
        remain.
      </p>
      <button
        onClick={leaveAfterDagger}
        className="mt-8 rounded-lg border border-cloak-border-strong bg-cloak-surface px-5 py-2.5 text-sm text-cloak-text transition-colors hover:bg-cloak-surface-hover"
      >
        Continue
      </button>
    </div>
  );
}
