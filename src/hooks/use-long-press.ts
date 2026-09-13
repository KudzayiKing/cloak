"use client";

import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/*
 * Long-press hook for touch (and mouse-hold) — opens the message action
 * sheet (user request: "longpress should show translate button").
 *
 * Behavior notes:
 * - Fires after `ms` of an unmoved press; movement beyond the threshold
 *   cancels (so scrolling the message list never opens the sheet).
 * - The press that fires the long-press must NOT also act as a click —
 *   `suppressClick` swallows the trailing click.
 * - On Android, a long-press also raises the system text-selection
 *   contextmenu; callers preventDefault it (touch) and optionally open
 *   the sheet on right-click (desktop).
 */

interface Options {
  ms?: number;
  moveThresholdPx?: number;
}

export function useLongPress(
  onLongPress: () => void,
  { ms = 450, moveThresholdPx = 10 }: Options = {}
) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      // Only the primary button / touch / pen starts a long-press.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        // Light haptic on supporting Android devices (best effort).
        try {
          navigator.vibrate?.(8);
        } catch {
          // ignore
        }
        onLongPress();
      }, ms);
    },
    [clear, ms, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (!origin.current) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > moveThresholdPx) {
        clear();
        origin.current = null;
      }
    },
    [clear, moveThresholdPx]
  );

  const onPointerUp = useCallback(() => {
    clear();
    origin.current = null;
  }, [clear]);

  /** Attach to the same element to stop the long-press from also clicking. */
  const onClickCapture = useCallback((e: ReactMouseEvent<Element>) => {
    if (fired.current) {
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    }
  }, []);

  /** Android fires a contextmenu on long-press; suppress it on touch.
      On fine-pointer devices, right-click opens the sheet directly. */
  const onContextMenu = useCallback(
    (e: ReactMouseEvent<Element>) => {
      e.preventDefault();
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      if (!coarse && !fired.current) {
        onLongPress();
      }
      fired.current = false;
    },
    [onLongPress]
  );

  return {
    longPressHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave: onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      onContextMenu,
    },
  };
}
