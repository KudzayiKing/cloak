"use client";

/*
 * Client-side Web Push plumbing (spec §62 transport).
 *
 * Flow: user gesture -> Notification.requestPermission() -> pushManager
 * subscribe with the server's VAPID public key -> POST the subscription
 * to /api/push (idempotent upsert per device endpoint).
 *
 * Privacy posture: the subscription contains NO profile data — only a
 * random endpoint + encryption keys. Structural event copy arrives over
 * the push; message content never does (the server is E2EE-blind).
 *
 * iOS Safari (16.4+): Web Push works ONLY when Cloak runs as an installed
 * PWA (standalone display). We detect that and surface honest guidance
 * instead of a dead button.
 */

export type PushSupport =
  | "supported" // full flow available
  | "ios-needs-install" // iOS Safari but not added to Home Screen
  | "insecure" // not a secure context (push requires https or localhost)
  | "unsupported"; // no pushManager at all

export interface PushState {
  support: PushSupport;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

interface PushSubscriptionJSONLike {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosUa = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ masquerades as desktop Safari.
  const ipadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iosUa || ipadOs;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Classify what this browser can do before touching permissions. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (!window.isSecureContext) return "insecure";
  if (isIosSafari() && !isStandalone()) return "ios-needs-install";
  return "supported";
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Current state for the settings surface. */
export async function getPushState(): Promise<PushState> {
  const support = pushSupport();
  if (support === "unsupported" || support === "insecure" || support === "ios-needs-install") {
    return {
      support,
      permission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
      subscribed: false,
    };
  }
  const sub = await existingSubscription();
  return {
    support,
    permission: Notification.permission,
    subscribed: !!sub,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function apiJson(path: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Enable push. MUST be called directly from a user-gesture handler —
 * the permission prompt has no gesture to inherit across awaits.
 * Returns "done" | the failure reason for honest UI copy.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  const support = pushSupport();
  if (support === "ios-needs-install") return { ok: false, reason: "ios-needs-install" };
  if (support === "insecure") return { ok: false, reason: "insecure" };
  if (support === "unsupported") return { ok: false, reason: "unsupported" };

  // 1) Ask FIRST — inside the gesture call stack, before any await.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "permission-denied" };
  }
  if (permission !== "granted") return { ok: false, reason: "permission-denied" };

  // 2) Server's public key.
  let publicKey: string | null = null;
  try {
    const res = await fetch("/api/push");
    const json = (await res.json()) as { ok: boolean; publicKey?: string };
    publicKey = json.publicKey ?? null;
  } catch {
    publicKey = null;
  }
  if (!publicKey) return { ok: false, reason: "server-unconfigured" };

  // 3) Subscribe through the (already-registered) service worker.
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { ok: false, reason: "no-sw" };

  let sub: PushSubscription;
  try {
    const existing = await reg.pushManager.getSubscription();
    sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      }));
  } catch {
    return { ok: false, reason: "subscribe-failed" };
  }

  // 4) Register the endpoint server-side (idempotent upsert).
  const json = sub.toJSON() as unknown as PushSubscriptionJSONLike;
  if (!json.keys?.p256dh || !json.keys?.auth) {
    await sub.unsubscribe().catch(() => undefined);
    return { ok: false, reason: "subscribe-failed" };
  }
  const sent = await apiJson("/api/push", {
    method: "POST",
    body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
  if (!sent) return { ok: false, reason: "server-reject" };
  return { ok: true };
}

/** Disable push on this device (unsubscribes and forgets server-side). */
export async function disablePush(): Promise<boolean> {
  const sub = await existingSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  const unsubscribed = await sub.unsubscribe().catch(() => false);
  await apiJson("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
  return unsubscribed;
}

/**
 * Silent re-sync after sign-in: if this device already has push granted,
 * re-assert the endpoint for the freshly signed-in user (upsert reassigns
 * the device to the active account). Never prompts, never throws.
 */
export async function syncPushAfterAuth(): Promise<void> {
  try {
    if (pushSupport() !== "supported") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const sub = await existingSubscription();
    if (!sub) return;
    const json = sub.toJSON() as unknown as PushSubscriptionJSONLike;
    if (!json.keys?.p256dh || !json.keys?.auth) return;
    await apiJson("/api/push", {
      method: "POST",
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
    });
  } catch {
    // Push sync is never worth surfacing an error for.
  }
}
