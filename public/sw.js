/*
 * Cloak Dagger service worker.
 *
 * Security posture (spec §28): security wins over aggressive caching.
 * - Static shell cache: same-origin static assets only, cache-first.
 * - Model artifacts: handled by the model manager (separate storage), never cached here.
 * - Encrypted application data / decrypted message payloads: NEVER cached by the SW.
 *   Message content lives in app-controlled storage and never passes through this cache.
 * - /api/* requests are network-only.
 * - Web Push (§62): structural events, plus the new-message push (round 23).
 *   The server is E2EE-blind, so the payload can never contain message
 *   content; the SW shows exactly what it received and never enriches it
 *   from any local store. A message push carries no content and no sender —
 *   see tagFor/targetUrlFor below.
 */

const VERSION = "cloak-shell-v34";
const SHELL_CACHE = `cloak-shell-${VERSION}`;
const STATIC_CACHE = `cloak-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll([OFFLINE_URL, "/icons/icon.svg"]);
      /* Deliberately NO self.skipWaiting() here.
       *
       * A new worker must park in `waiting` so the app keeps running the bundle
       * it already loaded. PwaRegister notices the waiting worker and shows the
       * bottom "refresh" prompt; the SKIP_WAITING message handled below is sent
       * only when the user taps Refresh.
       *
       * Calling skipWaiting() at install time activated the new worker the
       * moment it was fetched and force-reloaded every open window — which in a
       * standalone PWA lands mid-interaction (typically right after sign-in,
       * when a freshly deployed bundle has just activated) and reads as "the
       * app throws me back out". */
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
      /* No postMessage nudge here any more.
       *
       * The page detects a staged update from the registration itself
       * (updatefound -> installed -> waiting), which is both earlier and more
       * precise than waiting for activate to fire. By the time activate runs,
       * either the user consented to the handover or every client had closed —
       * in both cases "please refresh" would be wrong. */
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

/** Deep-link target — mirrors the in-app centre's tap-through (circle →
 *  circle page; group and chat → the message list, which is where the app
 *  lands and where the unread row lives).
 *
 *  A chat cannot deep-link to the individual thread: the hash router carries
 *  no query string, and the open conversation is store state rather than a
 *  route. Landing on the list with the thread at the top is the honest
 *  behaviour today. */
function targetUrlFor(data) {
  if (data && data.circleId) return `/#/app/circles/${data.circleId}`;
  if (data && (data.groupId || data.conversationId)) return "/#/app/messages";
  return "/#/app";
}

/** Collapse key. Structural events collapse by TYPE — one row per kind of
 *  membership news. A chat collapses per CONVERSATION, so a second message
 *  in a thread replaces its own notification instead of wiping another
 *  thread's; collapsing every message under one tag would leave the user
 *  with a single "New message" for a dozen chats. */
function tagFor(data) {
  if (data && data.conversationId) return "cloak-chat-" + data.conversationId;
  return "cloak-" + ((data && data.type) || "event");
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null; // Malformed payload: fall through to the generic copy.
  }

  const data = payload && typeof payload === "object" ? payload : {};
  const isMessage = data.type === "message.new";

  /* Structural copy only — the server sends exactly the title/body the
     in-app inbox stores, and a message push deliberately carries no content
     and no sender (the server is E2EE-blind, and Cloak Mode can hide
     previews on a device the server cannot inspect).

     If a STRUCTURAL payload is missing or unparseable we degrade to generic
     copy rather than dropping the event, because membership changes matter
     even when the payload was mangled. A message push gets no such fallback:
     a mangled one has nothing to say beyond "a message exists", so it stays
     title-only instead of claiming to be a security event. */
  const title =
    (typeof data.title === "string" && data.title) || (isMessage ? "New message" : "Cloak Dagger");
  const body =
    (typeof data.body === "string" && data.body) ||
    (isMessage ? "" : "Security or membership event");

  const options = {
    icon: APP_ICON,
    badge: BADGE_ICON,
    tag: tagFor(data),
    // Not requireInteraction: no notification here demands attention.
    data: { url: targetUrlFor(data), type: data.type || "event" },
  };
  // Only attach a body when there is one — an empty string would render as a
  // blank second line.
  if (body) options.body = body;

  event.waitUntil(self.registration.showNotification(title, options));
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
