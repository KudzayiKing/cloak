/*
 * PWA update lifecycle — deliberately React-free so the decision logic can be
 * unit-tested in Node (see scripts/verify-pwa-update.mts).
 *
 * Why this exists: the service worker used to call `self.skipWaiting()` from
 * its own install handler, so a freshly deployed worker activated the moment
 * it was installed and force-reloaded every open window. That landed mid-
 * interaction — typically right after sign-in, when a new bundle has just been
 * deployed — and read as "the app throws me back out".
 *
 * Now the new worker parks in `waiting` and the app keeps running the bundle it
 * already loaded. This module is the single source of truth for "an update is
 * ready": PwaRegister publishes, PwaUpdatePrompt renders, and only an explicit
 * user tap hands over to the waiting worker and reloads.
 *
 * Dismissal is per page session — "Later" silences the prompt until the app is
 * opened again. That is the point of the design: an update that is never
 * consented to simply leaves the current worker in charge.
 */

export type UpdatePhase = "idle" | "available" | "applying";

/* How long to wait for the `controllerchange` that follows SKIP_WAITING before
 * reloading anyway. A prompt that does nothing when tapped is worse than a
 * slightly early reload. */
export const APPLY_RELOAD_FALLBACK_MS = 4000;

let phase: UpdatePhase = "idle";
let waiting: ServiceWorkerRegistration | null = null;
let dismissed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updatePhase(): UpdatePhase {
  return phase;
}

/** The prompt must not render before hydration, so SSR sees "idle". */
export function serverUpdatePhase(): UpdatePhase {
  return "idle";
}

export function isUpdateDismissed(): boolean {
  return dismissed;
}

/** The registration holding the worker we would hand over to, if any. */
export function waitingRegistration(): ServiceWorkerRegistration | null {
  return waiting;
}

/**
 * A new worker finished installing and is waiting to take over.
 *
 * Ignored once the user has tapped "Later" — otherwise the 60s update poll
 * would re-open a prompt the user already dismissed.
 */
export function markUpdateAvailable(registration: ServiceWorkerRegistration) {
  waiting = registration;
  if (dismissed) return;
  if (phase !== "idle") return;
  phase = "available";
  emit();
}

/**
 * User tapped "Later". Silences the prompt until the app is reopened.
 *
 * A no-op unless a prompt is actually showing: otherwise a stray call would
 * latch the dismissal flag while nothing was staged, and the next genuine
 * update would never surface.
 */
export function dismissUpdate() {
  if (phase !== "available") return;
  dismissed = true;
  waiting = null;
  phase = "idle";
  emit();
}

/**
 * User tapped "Refresh". Asks the waiting worker to take over; the resulting
 * `controllerchange` performs the reload (PwaRegister). With no waiting worker
 * there is nothing to hand over — the shell is already current — so reload
 * directly.
 */
export function applyUpdate() {
  if (phase === "applying") return;
  phase = "applying";
  emit();

  const worker = waiting?.waiting;
  if (!worker) {
    window.location.reload();
    return;
  }
  worker.postMessage({ type: "SKIP_WAITING" });
  window.setTimeout(() => window.location.reload(), APPLY_RELOAD_FALLBACK_MS);
}

/** Test seam: wipe module state between cases. */
export function resetUpdateState() {
  phase = "idle";
  waiting = null;
  dismissed = false;
  listeners.clear();
}
