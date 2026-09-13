"use client";

/*
 * E2eeRestoreBanner — shown when this device has no identity key while a
 * passphrase-wrapped backup exists on the server (new browser with a live
 * session, or cleared local storage). Without the identity, ciphertext
 * bubbles cannot decrypt; the passphrase restores it locally (PBKDF2 ->
 * AES-GCM unwrap — the passphrase never leaves the device).
 */

import { useState } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { LockIcon, TriangleAlertIcon } from "@animateicons/react/lucide";
import { cn } from "@/lib/utils";

export function E2eeRestoreBanner({ className }: { className?: string }) {
  const identityStatus = useCloakStore((s) => s.identityStatus);
  const restoreIdentityKeys = useCloakStore((s) => s.restoreIdentityKeys);
  const [expanded, setExpanded] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (identityStatus !== "needs-passphrase") return null;

  const submit = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    const ok = await restoreIdentityKeys(passphrase);
    setBusy(false);
    if (ok) {
      setPassphrase("");
      setExpanded(false);
    } else {
      setError("That passphrase didn't unlock the backup. Try again.");
    }
  };

  return (
    <div
      className={cn(
        "mx-3 mb-2 rounded-xl border border-cloak-warning/30 bg-cloak-warning/5 p-3",
        className
      )}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <LockIcon size={14} className="mt-0.5 shrink-0 text-cloak-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-cloak-text">
            Restore your encryption keys
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-cloak-text-muted">
            This device doesn&apos;t hold your identity key yet, so encrypted
            messages can&apos;t decrypt. Confirm your passphrase to unlock them.
          </p>
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 rounded-md border border-cloak-gold/30 bg-cloak-gold-soft px-2.5 py-1 text-[11px] font-medium text-cloak-gold-bright"
            >
              Restore keys
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-1.5">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Your passphrase"
                autoComplete="current-password"
                aria-label="Passphrase to restore encryption keys"
                className="h-9 w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 text-[12.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted focus:border-cloak-gold/40"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void submit()}
                  disabled={busy || !passphrase}
                  className="rounded-md border border-cloak-gold/30 bg-cloak-gold-soft px-2.5 py-1 text-[11px] font-medium text-cloak-gold-bright disabled:opacity-40"
                >
                  {busy ? "Unlocking…" : "Unlock"}
                </button>
                <button
                  onClick={() => {
                    setExpanded(false);
                    setError(null);
                    setPassphrase("");
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-cloak-text-muted hover:text-cloak-text"
                >
                  Later
                </button>
                {error && (
                  <span className="flex items-center gap-1 text-[10.5px] text-cloak-danger">
                    <TriangleAlertIcon size={11} />
                    {error}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
