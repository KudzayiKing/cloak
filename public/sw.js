/*
 * Cloak service worker.
 *
 * Security posture (spec §28): security wins over aggressive caching.
 * - Static shell cache: same-origin static assets only, cache-first.
 * - Model artifacts: handled by the model manager (separate storage), never cached here.
 * - Encrypted application data / decrypted message payloads: NEVER cached by the SW.
 *   Message content lives in app-controlled storage and never passes through this cache.
 * - /api/* requests are network-only.
 * - Web Push (§62): structural events only. The server is E2EE-blind, so the
 *   payload can never contain message content; the SW shows exactly what it
 *   received and never enriches it from any local store.
 */

const VERSION = "cloak-shell-v20";
const SHELL_CACHE = `cloak-shell-${VERSION}`;
const STATIC_CACHE = `cloak-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll([OFFLINE_URL, "/icons/icon.svg"]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Network-only: API, non-GET, cross-origin.
  if (
    url.origin !== self.location.origin ||
    request.method !== "GET" ||
    url.pathname.startsWith("/api/")
  ) {
    return; // no interception -> default network behavior
  }

  // Static assets: NETWORK-FIRST with cache fallback.
  //
  // Cache-first was poison on the dev-server-backed preview: dev chunk
  // URLs are not content-hashed, so devices kept running stale bundles
  // from earlier builds (one device showed a bogus "credentials don't
  // match" while the real error was elsewhere). Network-first means a
  // fresh deploy always wins; the cache only serves when the network
  // is unreachable (true offline), which is what it is for.
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // Navigations: network-first, fall back to offline shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match(OFFLINE_URL)) || Response.error();
        }
      })()
    );
  }
});

/* ------------------------------ Web Push (§62) ------------------------------ */

const APP_ICON = "/icons/icon-192.png";
const BADGE_ICON = "/icons/icon-192.png";

/** Deep-link target for a structural event — mirrors the in-app centre's
 *  tap-through (circle → circle page, group → messages). */
function targetUrlFor(data) {
  if (data && data.circleId) return `/#/app/circles/${data.circleId}`;
  if (data && data.groupId) return "/#/app/messages";
  return "/#/app";
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null; // Malformed payload: fall through to the generic copy.
  }

  // Structural copy only — the server sends exactly the title/body the
  // in-app inbox stores. If a payload is missing/unparseable we degrade to
  // a fully generic "Cloak" notification rather than dropping the event,
  // because membership changes matter even when the payload was mangled.
  const title = (payload && typeof payload.title === "string" && payload.title) || "Cloak";
  const body = payload && typeof payload.body === "string" ? payload.body : "Security or membership event";
  const data = payload && typeof payload === "object" ? payload : {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: APP_ICON,
      badge: BADGE_ICON,
      tag: "cloak-" + (data.type || "event"),
      // Not requireInteraction: structural events do not demand attention.
      data: { url: targetUrlFor(data), type: data.type || "event" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/#/app";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing window if one is open, then steer it to the target.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // Hash navigation inside a focused client is fine — the app
              // router reads the hash on focus.
            }
          }
          return;
        }
      }
      // No window open: launch the app at the target.
      return self.clients.openWindow(url);
    })()
  );
});
