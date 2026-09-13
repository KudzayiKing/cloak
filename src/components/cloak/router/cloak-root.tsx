"use client";

/*
 * CloakRoot — client boundary. Owns the hash route and renders the app.
 */

import { useEffect } from "react";
import { useHashRoute } from "@/hooks/use-hash-route";
import { SplashScreen } from "@/components/cloak/brand/splash-screen";
import { DaggerOverlay } from "@/components/cloak/security/dagger";
import { installDaggerBroadcast } from "@/lib/cloak/dagger";
import { CloakApp } from "./cloak-app";

export function CloakRoot() {
  const route = useHashRoute();

  /* Multi-tab Dagger propagation (codex §27): every open tab locks and
     wipes when any tab runs Dagger. */
  useEffect(() => installDaggerBroadcast(), []);

  return (
    <>
      <SplashScreen />
      <CloakApp route={route} />
      {/* Dagger lock/completion overlay — above everything, covers all
          sensitive UI the instant execution starts (codex §6). */}
      <DaggerOverlay />
    </>
  );
}
