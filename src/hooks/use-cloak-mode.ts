"use client";

/*
 * useCloakMode (spec §23) — reusable hook over the global Cloak Mode state.
 * Transitions are immediate and restrained; no OS-level protections are
 * claimed beyond what the PWA controls.
 *
 * useCloakModeSwitch (user feedback round 4) — guard-aware switching:
 * turning Cloak Mode ON is always immediate; turning it OFF requires PIN or
 * biometric verification when the user configured protection in Settings.
 */

import { useCallback } from "react";
import { useCloakStore } from "@/stores/cloak-store";

export function useCloakMode() {
  const cloakMode = useCloakStore((s) => s.cloakMode);
  const setCloakMode = useCloakStore((s) => s.setCloakMode);
  const toggleCloakMode = useCloakStore((s) => s.toggleCloakMode);

  return { cloakMode, setCloakMode, toggleCloakMode, enabled: cloakMode };
}

export function useCloakModeSwitch() {
  const cloakMode = useCloakStore((s) => s.cloakMode);
  const setCloakMode = useCloakStore((s) => s.setCloakMode);
  const guard = useCloakStore((s) => s.cloakGuard);
  const openCloakGate = useCloakStore((s) => s.openCloakGate);

  /** Ask to turn Cloak Mode off — gated when protection is configured. */
  const turnOff = useCallback(() => {
    if (guard.pinHash || guard.credentialId) {
      openCloakGate("cloak-off", (verified) => {
        if (verified) setCloakMode(false);
      });
    } else {
      setCloakMode(false);
    }
  }, [guard.pinHash, guard.credentialId, openCloakGate, setCloakMode]);

  /** Toggle — ON is free, OFF is gated when protection is configured. */
  const toggle = useCallback(() => {
    if (!cloakMode) {
      setCloakMode(true);
      return;
    }
    turnOff();
  }, [cloakMode, setCloakMode, turnOff]);

  return { cloakMode, toggle, turnOff, protected: !!(guard.pinHash || guard.credentialId) };
}
