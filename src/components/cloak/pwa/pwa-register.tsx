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

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline shell is progressive enhancement; ignore failures silently.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
