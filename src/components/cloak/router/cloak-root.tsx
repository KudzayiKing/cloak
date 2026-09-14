"use client";

/*
 * CloakRoot — client boundary. Owns the hash route and renders the app.
 */

import { useEffect } from "react";
import { useHashRoute } from "@/hooks/use-hash-route";
import { SplashScreen } from "@/components/cloak/brand/splash-screen";
import { DaggerOverlay } from "@/components/cloak/security/dagger";
import { PullToRefresh } from "@/components/cloak/pwa/pull-to-refresh";
import { PwaUpdatePrompt } from "@/components/cloak/pwa/pwa-update-prompt";
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
      <PullToRefresh />
      {/* Staged-update prompt — docks at the bottom, above the mobile nav.
          Mounted here rather than in the shell so it is also reachable on the
          sign-in screen, where a newly deployed bundle is most likely to be
          waiting. */}
      <PwaUpdatePrompt />
      {/* Dagger lock/completion overlay — above everything, covers all
          sensitive UI the instant execution starts (codex §6). */}
      <DaggerOverlay />
    </>
  );
}
