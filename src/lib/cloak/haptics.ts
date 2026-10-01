/*
 * Haptic tap feedback (mobile bottom nav).
 *
 * A short vibration on a navigation press is the one piece of feedback a phone
 * gives that no animation can: it arrives under the finger, before the new
 * screen has painted, so the tap feels connected to what it did even on a
 * device where the press animation is still running.
 *
 * Three rules, all of them about not lying to the user:
 *
 *  - Best effort, never a throw. `navigator.vibrate` is absent on iOS Safari
 *    (the platform exposes no Vibration API to the web) and can throw on a
 *    locked-down webview. Both are no-ops, never errors.
 *  - Touch only. A mouse click on a desktop must never buzz. The gate accepts a
 *    mouse-typed pointer only when the device's PRIMARY pointer is coarse — the
 *    same rule use-icon-press-animation uses, because several real-phone setups
 *    (iOS "Desktop site" mode, in-app webviews) report a mouse on every tap.
 *  - Cheap. A single short pulse. No patterns, no repeats: a nav press is one
 *    discrete event and anything longer reads as a notification.
 */

/** Long enough to be felt, short enough to never be mistaken for an alert. */
const TAP_MS = 12;

export function isTouchDrivenPress(pointerType?: string): boolean {
  if (typeof window === "undefined") return false;
  if (pointerType === "touch" || pointerType === "pen") return true;
  if (pointerType === "mouse") {
    return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  }
  /* Keyboard activation and programmatic calls: no pointer at all. Fall back
     to the device's primary pointer so a keyboard user on a tablet still gets
     the confirmation, and a desktop user does not. */
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/** Fire a single tap pulse. Safe to call unconditionally. */
export function hapticTap(pointerType?: string): void {
  if (typeof navigator === "undefined") return;
  if (!isTouchDrivenPress(pointerType)) return;
  try {
    navigator.vibrate?.(TAP_MS);
  } catch {
    /* Blocked by the platform or a permissions policy — the visual press
       feedback has already fired, so there is nothing to recover. */
  }
}
