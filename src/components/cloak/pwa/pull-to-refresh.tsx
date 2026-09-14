"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "@animateicons/react/lucide";
import { cn } from "@/lib/utils";

const TRIGGER_PX = 78;
const MAX_PULL_PX = 112;

function scrollParent(el: EventTarget | null): HTMLElement | Window {
  let node = el instanceof HTMLElement ? el : null;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}

function atTop(container: HTMLElement | Window): boolean {
  if (!(container instanceof HTMLElement)) {
    return window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
  }
  return container.scrollTop <= 0;
}

async function refreshApp() {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (registration) {
    await registration.update().catch(() => undefined);
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  }
  window.location.reload();
}

export function PullToRefresh() {
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const setPullValue = (value: number) => {
    pullRef.current = value;
    setPull(value);
  };

  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    if (!coarse) return;

    const onTouchStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [role='dialog']")) return;
      const container = scrollParent(event.target);
      if (!atTop(container)) return;
      startY.current = event.touches[0]?.clientY ?? null;
      active.current = startY.current !== null;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!active.current || startY.current === null || refreshing) return;
      const y = event.touches[0]?.clientY ?? startY.current;
      const delta = y - startY.current;
      if (delta <= 0) {
        setPullValue(0);
        return;
      }
      const container = scrollParent(event.target);
      if (!atTop(container)) {
        active.current = false;
        setPullValue(0);
        return;
      }
      const eased = Math.min(MAX_PULL_PX, Math.sqrt(delta) * 10);
      setPullValue(eased);
      if (delta > 8) event.preventDefault();
    };

    const onTouchEnd = () => {
      if (!active.current) return;
      const shouldRefresh = pullRef.current >= TRIGGER_PX;
      active.current = false;
      startY.current = null;
      if (!shouldRefresh) {
        setPullValue(0);
        return;
      }
      setRefreshing(true);
      setPullValue(TRIGGER_PX);
      void refreshApp();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing]);

  const visible = pull > 2 || refreshing;
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-cloak-border bg-cloak-bg-elevated/95 px-3 py-2 text-[11px] font-medium text-cloak-text-secondary shadow-xl shadow-black/30 backdrop-blur-md transition-opacity md:hidden",
        visible ? "opacity-100" : "opacity-0"
      )}
      style={{
        transform: `translate(-50%, ${Math.max(0, pull - 42)}px)`,
      }}
    >
      <LoaderCircleIcon
        size={14}
        className={cn(refreshing || pull >= TRIGGER_PX ? "animate-spin text-cloak-gold" : "")}
      />
      {refreshing ? "Refreshing" : pull >= TRIGGER_PX ? "Release to refresh" : "Pull to refresh"}
    </div>
  );
}
