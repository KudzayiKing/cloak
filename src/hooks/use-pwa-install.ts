"use client";

/*
 * PWA install handling (spec §28, §10-J).
 * Uses beforeinstallprompt where available and falls back to
 * platform-appropriate manual instructions.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallSupport = "native" | "manual-ios" | "manual-desktop" | "unknown";

function subscribeStandalone(onChange: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function usePWAInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [support, setSupport] = useState<InstallSupport>("unknown");
  const [eventInstalled, setEventInstalled] = useState(false);

  const standalone = useSyncExternalStore(
    subscribeStandalone,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setSupport("native");
    };
    const onInstalled = () => {
      setEventInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Platform heuristic fallback (event-free, safe for the lint rule as it
    // runs once on mount before paint — guarded to run only when unknown).
    const raf = requestAnimationFrame(() => {
      const ua = window.navigator.userAgent;
      if (/iPad|iPhone|iPod/.test(ua)) {
        setSupport((s) => (s === "unknown" ? "manual-ios" : s));
      } else {
        setSupport((s) => (s === "unknown" ? "manual-desktop" : s));
      }
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      cancelAnimationFrame(raf);
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "manual"> => {
    if (!deferred) return "manual";
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  return {
    canInstall: !!deferred,
    support,
    installed: standalone || eventInstalled,
    install,
  };
}
