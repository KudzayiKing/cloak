"use client";

import { useEffect } from "react";

/*
 * Registers the Cloak service worker (offline shell, static cache).
 * Caching policy lives in public/sw.js — it never caches message data or API traffic.
 *
 * Development: the SW is unregistered and caches are cleared so Turbopack
 * hot updates are never served from the static cache.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    let refreshing = false;

    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    };

    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      activateWaitingWorker(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            activateWaitingWorker(registration);
          }
        });
      });
    };

    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (!registration) return;
        void registration.update().then(() => activateWaitingWorker(registration));
      });
    };

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "CLOAK_SW_UPDATED") return;
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
        watchRegistration(registration);
        void registration.update();
      }).catch(() => {
        // Offline shell is progressive enhancement; ignore failures silently.
      });
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkForUpdate);
    const interval = window.setInterval(checkForUpdate, 60_000);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkForUpdate);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
