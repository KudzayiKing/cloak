"use client";

import { useEffect } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { applyCloakTheme } from "@/lib/cloak/theme";

/*
 * ThemeSync — keeps the theme class on <html> in step with the stored
 * preference.
 *
 * It deliberately SUBSCRIBES rather than reading `theme` in an effect.
 * The inline bootstrap script in layout.tsx has already applied the stored
 * preference before first paint; reading the store on mount would hand us the
 * pre-rehydration default ("dark") and flip a light-mode document back to dark
 * for a frame — undoing the entire point of the script. Subscribing means we
 * only ever react to a real change, which on load is exactly the moment
 * rehydration lands, and afterwards is the user flipping the switch.
 */
export function ThemeSync() {
  useEffect(() => {
    return useCloakStore.subscribe((state, previous) => {
      if (state.theme === previous.theme) return;
      applyCloakTheme(state.theme);
    });
  }, []);

  return null;
}
