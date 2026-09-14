"use client";

/*
 * PullToRefresh — the phone gesture that makes an installed PWA feel like an
 * app. Pull down from the top of any screen and release to fetch a fresh
 * shell.
 *
 * Why it is written this way:
 *
 *  - The gesture maths live in `pull-to-refresh-gesture.ts` so the awkward
 *    part (is this a pull, a scroll, or neither?) is unit-tested rather than
 *    reasoned about. The rule: the app shell pins the viewport and scrolls an
 *    inner `<main class="overflow-y-auto">`, so `window.scrollY` stays 0 no
 *    matter how far a chat list is scrolled — a pull is only real when every
 *    scrollable ancestor is already at the top.
 *  - The gesture must survive starting on a button. Chat rows, message
 *    bubbles and cards are buttons; bailing out on them (the previous
 *    behaviour) killed the gesture on almost every real surface. Only text
 *    fields, open dialogs and sheets are excluded.
 *  - `touchmove` is registered non-passive so the pull can suppress the
 *    browser's own overscroll/rubber-band and take ownership of the gesture.
 *  - Refresh means "get me off this stale bundle": update the service
 *    worker, activate a waiting one, drop the Cloak shell/static caches, then
 *    reload. Every step is best-effort and time-bounded, so the reload always
 *    happens — an offline pull restarts the app instead of hanging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "@animateicons/react/lucide";
import { cn } from "@/lib/utils";
import {
  PULL_START_PX,
  TRIGGER_PX,
  isAtTop,
  isExcludedTarget,
  pullForDelta,
  shouldRefreshAt,
  supportsPull,
  withBudget,
} from "./pull-to-refresh-gesture";

/** Never let refresh bookkeeping outlive this. */
const REFRESH_BUDGET_MS = 2500;

/**
 * Fetch a genuinely fresh shell, then reload.
 *  1. update the service-worker registration and hand any waiting worker the
 *     activation message, so the reload is served by the newest build;
 *  2. drop the Cloak shell/static caches — a cache-first static asset is the
 *     one thing that can survive a reload and keep serving a stale bundle;
 *  3. reload, unconditionally.
 */
async function refreshApp(): Promise<void> {
  const work = (async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update().catch(() => undefined);
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("cloak-")).map((key) => caches.delete(key))
      );
    }
  })();
  await withBudget(work, REFRESH_BUDGET_MS);
  window.location.reload();
}

export function PullToRefresh() {
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const commit = useCallback((value: number) => {
    pullRef.current = value;
    setPull(value);
  }, []);

  useEffect(() => {
    if (!supportsPull()) return;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current) return;
      if (event.touches.length !== 1) return;
      if (isExcludedTarget(event.target)) return;
      if (!isAtTop(event.target)) return;
      startY.current = event.touches[0]?.clientY ?? null;
      active.current = startY.current !== null;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!active.current || startY.current === null) return;
      if (refreshingRef.current) return;
      const y = event.touches[0]?.clientY ?? startY.current;
      const delta = y - startY.current;

      if (delta <= PULL_START_PX) {
        /* Scrolling up, or a tap: hand the gesture back to the browser. */
        if (delta <= 0) active.current = false;
        if (pullRef.current !== 0) commit(0);
        return;
      }
      /* Re-check the top on every move — the list may have scrolled under us
         (momentum left over from a previous flick). */
      if (!isAtTop(event.target)) {
        active.current = false;
        commit(0);
        return;
      }
      /* We own this gesture — stop the browser's own overscroll. */
      if (event.cancelable) event.preventDefault();
      commit(pullForDelta(delta));
    };

    const onTouchEnd = () => {
      if (!active.current) return;
      const shouldRefresh = shouldRefreshAt(pullRef.current);
      active.current = false;
      startY.current = null;
      if (!shouldRefresh) {
        commit(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      commit(TRIGGER_PX);
      void refreshApp();
    };

    const onTouchCancel = () => {
      active.current = false;
      startY.current = null;
      if (!refreshingRef.current) commit(0);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [commit]);

  const visible = pull > 2 || refreshing;
  const armed = pull >= TRIGGER_PX;
  const progress = Math.min(1, pull / TRIGGER_PX);

  return (
    <div
      aria-hidden={!visible}
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex items-center gap-2 rounded-full border border-cloak-border bg-cloak-bg-elevated/95 px-3 py-2 text-[11px] font-medium text-cloak-text-secondary shadow-xl shadow-black/30 backdrop-blur-md transition-opacity duration-150 md:hidden",
        visible ? "opacity-100" : "opacity-0"
      )}
      style={{ transform: `translate(-50%, ${Math.max(0, pull - 46)}px)` }}
    >
      {/* A plain span owns the rotation so the animated icon's own transform
          management is never fought over. */}
      <span
        className="grid place-items-center"
        style={{ transform: `rotate(${Math.round(progress * 270)}deg)` }}
      >
        <LoaderCircleIcon
          size={14}
          isAnimated={false}
          className={cn(
            "animate-spin",
            armed || refreshing ? "text-cloak-gold" : "text-cloak-text-muted"
          )}
        />
      </span>
      <span className={cn(refreshing && "animate-pulse")}>
        {refreshing ? "Refreshing…" : armed ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
