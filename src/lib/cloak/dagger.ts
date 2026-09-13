"use client";

/*
 * Dagger — emergency device wipe and revocation (codex spec).
 *
 * Positioning: Cloak Mode reduces what the device reveals while you are
 * using it. Dagger is for the moment you no longer trust the device itself.
 * It destroys Cloak's local keys, private data and device authorization —
 * nothing more, and honestly no less. It is NOT marketed as "leaves no
 * trace": a PWA cannot guarantee deletion of every OS/browser artifact.
 *
 * Priority order (codex §6 / final principle):
 *   DESTROY KEYS -> LOCK UI -> CLEAR PRIVATE LOCAL DATA
 *   -> REVOKE DEVICE -> RETURN TO NEUTRAL STATE
 *
 * Everything here is best-effort except key destruction: a failed optional
 * cache delete never stops the remaining cleanup (§29). The server-side
 * revoke is attempted with a short race and NEVER blocks destruction
 * (§17 — offline Dagger still destroys keys immediately; a minimal
 * in-origin tombstone records the pending revocation, nothing more).
 */

import { create } from "zustand";
import { wipeKeyringMemory } from "@/lib/crypto/e2ee-orchestrator";

/* ---------- capability / result types (codex §29/§31) ---------- */

export interface DaggerResult {
  localKeyDestruction: "complete" | "failed";
  localSensitiveDataCleanup: "complete" | "partial";
  serverRevocation: "complete" | "pending";
}

export interface DaggerConfiguration {
  enabled: boolean;
  confirmationMode: "press_and_hold";
  confirmationHoldMs: number;
  silentCompletion: boolean;
  emergencyGestureEnabled: boolean;
  remoteDaggerEnabled: boolean;
}

export const DAGGER_DEFAULTS: DaggerConfiguration = {
  enabled: true,
  confirmationMode: "press_and_hold",
  confirmationHoldMs: 3000,
  silentCompletion: false,
  emergencyGestureEnabled: false,
  remoteDaggerEnabled: true,
};

/* In-memory execution state — rendered by the Dagger overlay. Never
   persisted (§29: do not persist the result after Dagger). */
interface DaggerRunState {
  phase: "idle" | "active" | "complete";
  result: DaggerResult | null;
}

interface DaggerRunStore extends DaggerRunState {
  setPhase: (phase: DaggerRunState["phase"]) => void;
  finish: (result: DaggerResult) => void;
  reset: () => void;
}

export const useDaggerRun = create<DaggerRunStore>()((set) => ({
  phase: "idle",
  result: null,
  setPhase: (phase) => set({ phase }),
  finish: (result) => set({ phase: "complete", result }),
  reset: () => set({ phase: "idle", result: null }),
}));

/* ---------- device identity (codex §16/§26) ---------- */

const LS_DEVICE_ID = "cloak-device-id";
const LS_DEVICE_TOKEN = "cloak-device-token";
const LS_DEVICE_NAME = "cloak-device-name";
/** Minimal pending-revocation ticket (codex §17). The ONLY key written
 *  back after the full storage clear — never user/account state. */
const LS_DAGGER_TOMBSTONE = "cloak-daggered";

export function deviceName(): string {
  try {
    const stored = localStorage.getItem(LS_DEVICE_NAME);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent;
    const platform =
      /iPhone|iPad|iPod/.test(ua) ? "iOS"
      : /Android/.test(ua) ? "Android"
      : /Macintosh|Mac OS X/.test(ua) ? "Mac"
      : /Windows/.test(ua) ? "Windows PC"
      : /Linux/.test(ua) ? "Linux"
      : "This browser";
    return `Cloak on ${platform}`;
  }
  return "Cloak device";
}

export interface DeviceIdentity {
  deviceId: string;
  deviceToken: string;
  name: string;
}

/** Stable per-install credential pair. Regenerated naturally after a
 *  Dagger (full storage clear) so the same physical device re-enrolls as
 *  a genuinely new device identity (codex §26). */
export function deviceIdentity(): DeviceIdentity {
  let id = "";
  let token = "";
  try {
    id = localStorage.getItem(LS_DEVICE_ID) ?? "";
    token = localStorage.getItem(LS_DEVICE_TOKEN) ?? "";
  } catch {
    /* ignore */
  }
  if (!id && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    id = crypto.randomUUID();
  } else if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  if (!token && typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    token = btoa(String.fromCharCode(...bytes));
  } else if (!token) {
    token = `tok-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  try {
    localStorage.setItem(LS_DEVICE_ID, id);
    localStorage.setItem(LS_DEVICE_TOKEN, token);
    localStorage.setItem(LS_DEVICE_NAME, deviceName());
  } catch {
    /* storage blocked — memory-only identity for this session */
  }
  return { deviceId: id, deviceToken: token, name: deviceName() };
}

/* ---------- cleanup coordinator (codex §32) ---------- */

/** Keys FIRST (codex §6): every localStorage seed the E2EE layer owns,
 *  plus the AI MemoryStore, then the in-memory keyring. After this the
 *  device can neither decrypt existing ciphertext nor encrypt anything
 *  new. (The device credential pair is intentionally NOT removed here —
 *  a remote-wipe pickup may still need it; the full storage clear below
 *  removes it as part of the private-data phase.) */
export async function destroyCryptoKeys(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("cloak-identity-") ||
          key.startsWith("cloak-convkeys") ||
          key === "cloak-memory-store-v1")
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
  wipeKeyringMemory();
}

/** All Cloak-controlled browser storage (codex §7-§10). Cloak owns the
 *  origin — messages, drafts, contact cache, AI MemoryStore, embedding
 *  caches, model install flags, the persisted zustand slice — so a full
 *  clear is correct here. The device credential pair is recreated lazily
 *  afterwards (new identity, §26). */
export async function clearSensitiveStorage(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/** Write the ONLY thing that survives the clear: the minimal pending-
 *  revocation ticket (§17). Consumed at next boot; contains no user data. */
export function writeDaggerTombstone(): void {
  try {
    localStorage.setItem(LS_DAGGER_TOMBSTONE, "1");
  } catch {
    /* ignore */
  }
}

export function consumeDaggerTombstone(): boolean {
  try {
    if (localStorage.getItem(LS_DAGGER_TOMBSTONE) === "1") {
      localStorage.removeItem(LS_DAGGER_TOMBSTONE);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Cloak-owned IndexedDB databases only (codex §8). */
export async function clearIndexedDB(): Promise<void> {
  try {
    if (!("indexedDB" in window) || !indexedDB.databases) return;
    const databases = await indexedDB.databases();
    for (const dbInfo of databases) {
      const name = dbInfo.name ?? "";
      if (name.startsWith("cloak-") || name.startsWith("cloak_")) {
        indexedDB.deleteDatabase(name);
      }
    }
  } catch {
    /* unsupported — continue cleanup (§29) */
  }
}

/** Sensitive Cache Storage (codex §9): every cloak- shell/static cache.
 *  Generic model weights are not cached here (OPFS, §15 — background). */
export async function clearSensitiveCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    for (const key of keys) {
      if (key.startsWith("cloak-")) await caches.delete(key);
    }
  } catch {
    /* ignore */
  }
}

/** OPFS best-effort (codex §11/§15): local encrypted/AI-derived files.
 *  Never on the critical path — unsupported APIs are skipped silently. */
export async function clearSensitiveFiles(): Promise<void> {
  try {
    if (!navigator.storage?.getDirectory) return;
    const dir = await navigator.storage.getDirectory();
    // @ts-expect-error - async iterator exists in browsers that support OPFS listing
    if (dir.values) {
      // @ts-expect-error - see above
      for await (const name of dir.keys()) {
        try {
          await dir.removeEntry(name, { recursive: true });
        } catch {
          /* individual entry may already be gone */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** Push invalidation (codex §13): drop the local subscription so no
 *  sensitive preview can be delivered to this revoked device. */
export async function unregisterPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const sub = await registration?.pushManager?.getSubscription();
    await sub?.unsubscribe().catch(() => undefined);
  } catch {
    /* no push support — nothing to invalidate */
  }
}

/** LAST (codex §12): unregister Cloak service workers so the shell cache
 *  cannot resurrect stale private state after the wipe. */
export async function unregisterServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations();
    for (const registration of registrations ?? []) {
      await registration.unregister().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/* ---------- broadcast (codex §27) ---------- */

const CHANNEL = "cloak-dagger";
let channel: BroadcastChannel | null = null;

/** All open Cloak tabs must lock and wipe — Dagger in one tab propagates
 *  immediately to the others; browser Back must not restore state (the
 *  receiving tab wipes and reloads, so history points at dead state). */
export function installDaggerBroadcast(): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return () => undefined;
  }
  channel = new BroadcastChannel(CHANNEL);
  /* Only idle tabs react: the tab that ORIGINATED the dagger is already in
     the "complete" phase and must keep its completion panel instead of
     re-running a silent cleanup triggered by the other tab's tombstone. */
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === "dagger" && useDaggerRun.getState().phase === "idle") {
      void daggerLocalCleanup({ serverRevoke: false, silent: true });
    }
  };
  /* Storage-event fallback for browsers without BroadcastChannel. */
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === LS_DAGGER_TOMBSTONE &&
      e.newValue === "1" &&
      useDaggerRun.getState().phase === "idle"
    ) {
      void daggerLocalCleanup({ serverRevoke: false, silent: true });
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    channel = null;
    window.removeEventListener("storage", onStorage);
  };
}

function broadcastDagger(): void {
  try {
    channel?.postMessage("dagger");
  } catch {
    /* ignore */
  }
}

/* Module-level mirror of the silent-completion setting, written by the
   store before activation (the zustand slice itself is about to be wiped). */
let DAGGER_SILENT = false;
export function setDaggerSilentCompletion(silent: boolean) {
  DAGGER_SILENT = silent;
}

/* ---------- the local sequence (codex §6) ---------- */

/**
 * Full local destruction. Used by: the local Dagger (server revoke on),
 * Remote Dagger pickup + other tabs (server revoke off — the originating
 * tab or the queue owns the server side).
 */
export async function daggerLocalCleanup(opts: {
  serverRevoke: boolean;
  silent: boolean;
}): Promise<DaggerResult> {
  const result: DaggerResult = {
    localKeyDestruction: "complete",
    localSensitiveDataCleanup: "partial",
    serverRevocation: opts.serverRevoke ? "pending" : "complete",
  };

  /* 1. LOCK UI — the overlay mounts from useDaggerRun.phase = "active"
     (set by the caller before this runs). 2. KEYS FIRST. */
  try {
    await destroyCryptoKeys();
  } catch {
    result.localKeyDestruction = "failed";
  }

  /* 3. SERVER REVOKE — attempted, never awaited past the short race;
     offline Dagger leaves it pending (§17). */
  if (opts.serverRevoke) {
    const identity = deviceIdentity();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(`/api/security/devices/${encodeURIComponent(identity.deviceId)}/revoke`, {
        method: "POST",
        signal: controller.signal,
        keepalive: true,
      });
      result.serverRevocation = "complete";
    } catch {
      result.serverRevocation = "pending";
    } finally {
      clearTimeout(timeout);
    }
  }

  /* 4. PRIVATE LOCAL DATA (§7-§10): everything Cloak controls. */
  try {
    await clearSensitiveStorage();
    await clearIndexedDB();
    await clearSensitiveCaches();
    result.localSensitiveDataCleanup = "complete";
  } catch {
    result.localSensitiveDataCleanup = "partial";
  }

  /* 5. Tombstone AFTER the clear so it survives (§17). Written
     unconditionally: it doubles as the multi-tab storage-event signal and
     guarantees the stale session cookie is cleaned up at next boot. */
  writeDaggerTombstone();

  /* 6. PUSH (§13) — best-effort. */
  await unregisterPush();

  /* 7. OPFS files (§11) — background-grade, still before SW teardown. */
  await clearSensitiveFiles();

  /* 8. SERVICE WORKERS LAST (§12). */
  await unregisterServiceWorkers();

  /* 9. RETURN TO NEUTRAL STATE: silent completion reloads straight to the
     signed-out site (§20); otherwise the completion panel renders first. */
  const run = useDaggerRun.getState();
  run.finish(result);
  if (opts.silent || DAGGER_SILENT) {
    setTimeout(() => {
      window.location.href = "/";
    }, 350);
  }
  return result;
}

/** Complete the non-silent flow: called by the completion panel's
 *  primary action (§28 — there is no undo; this just leaves). */
export function leaveAfterDagger(): void {
  window.location.href = "/";
}

/* ---------- public service (codex §31) ---------- */

/** Local Dagger on THIS device: locks the UI, destroys keys before
 *  anything else, revokes the device server-side (pending when offline),
 *  clears all sensitive local data, unregisters the service worker. */
export async function daggerCurrentDevice(silent: boolean): Promise<DaggerResult> {
  setDaggerSilentCompletion(silent);
  const run = useDaggerRun.getState();
  run.setPhase("active");
  /* Multi-tab propagation FIRST — every open tab locks at once (§27). */
  broadcastDagger();
  return daggerLocalCleanup({ serverRevoke: true, silent });
}

/** Remote Dagger pickup (codex §18): called at boot and periodically. A
 *  revoked-but-not-yet-wiped device authenticates with its device
 *  credential (sessions are already dead) and executes its queued wipe. */
export async function checkPendingDaggerCommand(): Promise<boolean> {
  const identity = deviceIdentity();
  try {
    const res = await fetch("/api/security/dagger/command", {
      headers: {
        "X-Cloak-Device-Id": identity.deviceId,
        "X-Cloak-Device-Token": identity.deviceToken,
      },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { pending?: boolean };
    if (json.pending) {
      setDaggerSilentCompletion(true);
      useDaggerRun.getState().setPhase("active");
      void fetch("/api/security/dagger/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cloak-Device-Id": identity.deviceId,
          "X-Cloak-Device-Token": identity.deviceToken,
        },
        body: JSON.stringify({ status: "executing" }),
        keepalive: true,
      }).catch(() => undefined);
      await daggerLocalCleanup({ serverRevoke: false, silent: true });
      return true;
    }
  } catch {
    /* offline — nothing pending is knowable; local state untouched */
  }
  return false;
}

/** Bootstrap-time tombstone consumption (§17/§28): if a previous Dagger
 *  ended with the server revocation pending, kill the leftover session
 *  cookie server-side and NEVER restore the old session, even if the
 *  logout round-trip fails while offline. */
export async function consumePendingRevocation(): Promise<boolean> {
  if (!consumeDaggerTombstone()) return false;
  try {
    await fetch("/api/auth/logout", { method: "POST", keepalive: true });
  } catch {
    /* offline — the cookie may survive, the session must not restore */
  }
  return true;
}
