"use client";

import { useEffect } from "react";
import { markUpdateAvailable, updatePhase } from "@/lib/cloak/pwa-update";

/*
 * Registers the Cloak service worker (offline shell, static cache).
 * Caching policy lives in public/sw.js — it never caches message data or API traffic.
 *
 * Update flow (user request: "a modal at the bottom asking users to refresh if
 * there is an update"):
 *
 *   1. A newly deployed worker installs and then WAITS — sw.js no longer calls
 *      self.skipWaiting(), so the app keeps running the bundle it loaded.
 *   2. We publish that fact through the update store; PwaUpdatePrompt shows the
 *      bottom card.
 *   3. Only the user's tap hands over (SKIP_WAITING), and only the resulting
 *      controllerchange reloads the page.
 *
 * The previous behaviour — activate the new worker immediately and reload every
 * open window — landed mid-interaction, typically right after sign-in, and read
 * as "the app throws me back out".
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

    /** A worker is waiting and this page is already controlled — an update. */
    const publishIfWaiting = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        markUpdateAvailable(registration);
      }
    };

    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      /* A worker may already be waiting from an earlier visit — the user tapped
         "Later" and reopened the app. That is still a pending update, and
         `updatefound` will never fire for it, so check explicitly. */
      publishIfWaiting(registration);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state !== "installed") return;
          if (navigator.serviceWorker.controller) {
            /* An update is staged. Wait for the user. */
            publishIfWaiting(registration);
          } else {
            /* First ever install on this device: there is no incumbent worker
               to protect, so take over now and let clients.claim() adopt the
               page. Prompting here would be noise. */
            registration.waiting?.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    };

    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (!registration) return;
        void registration.update().then(() => publishIfWaiting(registration));
      });
    };

    /* Reload ONLY for a handover the user asked for. A spontaneous
       controllerchange — clients.claim() on a first install, or a worker
       activating after every other tab closed — must never yank the page. */
    const onControllerChange = () => {
      if (updatePhase() !== "applying") return;
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
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkForUpdate);
    const interval = window.setInterval(checkForUpdate, 60_000);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkForUpdate);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
