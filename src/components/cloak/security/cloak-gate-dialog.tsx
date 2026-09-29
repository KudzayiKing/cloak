"use client";

/*
 * CloakGateDialog (user feedback round 4) — verification required to turn
 * Cloak Mode off (or to change protection). Accepts the device PIN or the
 * platform biometric authenticator, whichever the user configured.
 * Turning Cloak Mode on never passes through this dialog.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { Input } from "@/components/ui/input";
import { useCloakStore } from "@/stores/cloak-store";
import {
  sha256Hex,
  verifyBiometric,
  PIN_MIN_LENGTH,
} from "@/lib/cloak/cloak-guard";
import {
  ScanIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from "@animateicons/react/lucide";

export function CloakGateDialog() {
  const open = useCloakStore((s) => s.cloakGate.open);
  const purpose = useCloakStore((s) => s.cloakGate.purpose);
  const guard = useCloakStore((s) => s.cloakGuard);
  const closeCloakGate = useCloakStore((s) => s.closeCloakGate);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeCloakGate(false);
      }}
    >
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-sm">
        {/* Mounted only while the gate is open — fresh state every time */}
        {open && (
          <GateForm
            key={purpose}
            purpose={purpose}
            pinHash={guard.pinHash}
            credentialId={guard.credentialId}
            onVerified={() => closeCloakGate(true)}
            onCancel={() => closeCloakGate(false)}
          />
        )}
      </RiseDialogContent>
    </Dialog>
  );
}

function GateForm({
  purpose,
  pinHash,
  credentialId,
  onVerified,
  onCancel,
}: {
  purpose: "cloak-off" | "manage";
  pinHash: string | null;
  credentialId: string | null;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Focus the PIN field once mounted (DOM effect only). */
  useEffect(() => {
    if (!pinHash) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, [pinHash]);

  const submitPin = async () => {
    if (!pinHash || pin.length < PIN_MIN_LENGTH) return;
    setBusy(true);
    const hash = await sha256Hex(pin);
    setBusy(false);
    if (hash && hash === pinHash) {
      onVerified();
    } else {
      setError("Incorrect PIN. Try again.");
      setPin("");
      inputRef.current?.focus();
    }
  };

  const submitBiometric = async () => {
    if (!credentialId) return;
    setBusy(true);
    setError(null);
    const ok = await verifyBiometric(credentialId);
    setBusy(false);
    if (ok) {
      onVerified();
    } else {
      setError("Biometric verification did not succeed. Try again or use your PIN.");
    }
  };

  const description =
    purpose === "manage"
      ? "Verify to change or remove Cloak Mode protection."
      : "Verify to turn Cloak Mode off. Turning it on never requires verification.";

  return (
    <>
      <DialogHeader>
        <span className="mb-1 grid h-11 w-11 place-items-center rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft/40 text-cloak-gold">
          <ShieldCheckIcon size={20} />
        </span>
        <DialogTitle className="cloak-display text-xl">Cloak Mode is protected</DialogTitle>
        <DialogDescription className="text-cloak-text-secondary">
          {description}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {pinHash && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitPin();
            }}
            className="space-y-2.5"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Device PIN
              </span>
              <Input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
                  setError(null);
                }}
                placeholder="••••"
                aria-label="Device PIN"
                className="border-cloak-border bg-cloak-bg text-center text-lg tracking-[0.4em] text-cloak-text placeholder:text-cloak-text-muted"
              />
            </label>
            <Button
              type="submit"
              disabled={pin.length < PIN_MIN_LENGTH || busy}
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 w-full border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
            >
              {busy && <LoaderCircleIcon size={15} className="mr-2 animate-spin" />}
              Unlock
            </Button>
          </form>
        )}

        {credentialId && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void submitBiometric()}
            className="h-11 w-full border-cloak-border-strong bg-transparent text-sm text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
          >
            <ScanIcon size={16} className="mr-2 text-cloak-gold" />
            Unlock with biometrics
          </Button>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-1.5 text-[12px] leading-relaxed text-cloak-danger">
            <KeyRoundIcon size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={onCancel}
          className="w-full pt-1 text-center text-[12.5px] text-cloak-text-muted transition-colors hover:text-cloak-text-secondary"
        >
          Keep Cloak Mode on
        </button>
      </div>
    </>
  );
}
