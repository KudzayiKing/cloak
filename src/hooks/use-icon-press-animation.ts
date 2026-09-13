"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

/*
 * Press animation for animated icons on touch surfaces (user feedback
 * rounds 5, 6, 9 and 14). Desktop icons animate on hover (built into the
 * icon components); touch surfaces have no hover, so pressing an icon
 * starts its animation and holds it for two seconds — clear, calm press
 * feedback. Attach `iconRef` to the icon and `onPointerDown` to the
 * pressable parent (button).
 *
 * Round 9 hardening — why icons could still look dead on a real phone:
 * several real-phone setups report a MOUSE pointer on every tap —
 * "Desktop site" mode, some in-app webviews, casting, connected
 * peripherals — and silently got no animation. The gate now also allows
 * mouse-typed pointers whenever the device's primary pointer is coarse
 * (i.e. an actual touch device).
 *
 * Round 15 (current) — EXACTLY ONE animation per press (user report:
 * "icons animate twice, once when user presses and second 2 seconds
 * after"). The old halfway re-pulse (round 9) was a SECOND trigger that
 * replayed one-shot icons mid-window; it is gone. A press now runs the
 * icon's built-in animation a single time and the stop timer merely
 * closes the two-second window.
 *
 * Round 14 hardening (kept) — navigation remounts killed the animation:
 * every app route renders its own AppShell, so tapping a bottom-nav tab
 * unmounts the pressed icon ~100ms into its window. The press is
 * remembered in a module-scope variable keyed by `pressKey`; when the
 * freshly mounted icon for the same key appears it replays ONCE for the
 * remaining time (a continuation, not a new trigger). Remaining windows
 * under 250ms are skipped — a cut-off flicker would read as a second
 * animation, which is exactly what round 15 removes.
 */

export type IconAnimationHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

/** Most recent press: which key, and when (module scope survives the
    route-change remount that destroyed the in-flight animation). */
let lastPress: { key: string; at: number } | null = null;

export function useIconPressAnimation(durationMs = 2000, pressKey?: string) {
  const iconRef = useRef<IconAnimationHandle | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const pulse = useCallback(() => {
    const icon = iconRef.current;
    if (!icon?.startAnimation) return;
    if (pressKey) lastPress = { key: pressKey, at: Date.now() };
    clearTimers();
    icon.startAnimation();
    /* Round 15: a single trigger per press — no halfway re-pulse. The
       stop timer only closes the window; the stop handle is the pressed
       instance itself, so a route change during the window can never
       touch the wrong icon. */
    timersRef.current.push(
      window.setTimeout(() => {
        timersRef.current = [];
        icon.stopAnimation();
      }, durationMs),
    );
  }, [clearTimers, durationMs, pressKey]);

  /* Resume after a navigation remount: if this exact icon (same key) was
     pressed moments ago and the window is still open, replay it ONCE for
     the remaining time — a continuation of the same press, never a new
     trigger (round 15). Skip when almost nothing remains: a cut-off
     flicker would read as a second animation. The imperative handle
     exists before effects run, so this is safe on first mount. */
  useEffect(() => {
    if (!pressKey) return;
    const press = lastPress;
    if (!press || press.key !== pressKey) return;
    const elapsed = Date.now() - press.at;
    const remaining = durationMs - elapsed;
    if (remaining <= 250) return;
    const icon = iconRef.current;
    if (!icon?.startAnimation) return;
    icon.startAnimation();
    const stop = window.setTimeout(() => icon.stopAnimation(), remaining);
    return () => window.clearTimeout(stop);
  }, [pressKey, durationMs]);

  const onPointerDown = useCallback(
    (e?: ReactPointerEvent<Element>) => {
      if (typeof window === "undefined") return;
      if (e && e.pointerType === "mouse") {
        /* A real mouse on a fine-pointer device keeps the built-in hover
           animation. A mouse-TYPED pointer on a touch device (desktop-site
           mode, webviews) still gets press feedback — the device decides,
           not the event. */
        const coarse =
          window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
        if (!coarse) return;
      }
      pulse();
    },
    [pulse],
  );

  return { iconRef, onPointerDown };
}
