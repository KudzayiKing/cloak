"use client";

import { useEffect, useState, type RefObject } from "react";

/*
 * Keyboard-rise for centered dialogs on phones (user feedback round 9).
 *
 * When the on-screen keyboard opens it shrinks the VISUAL viewport while
 * the layout viewport keeps its size (iOS always; Android when the
 * interactive-widget viewport meta is not "resizes-content"). A dialog
 * centered in the layout viewport therefore stays put and the keyboard
 * covers its lower half.
 *
 * This hook measures the overlap between the keyboard and the dialog and
 * returns how many pixels the dialog should rise so its bottom edge
 * clears the keyboard — capped so the top edge never leaves the screen.
 * Apply the value as an inline translateY on the dialog content; with
 * Tailwind 4 the shadcn centering uses the standalone CSS `translate`
 * property, so an inline `transform` composes with it instead of
 * fighting it.
 */
export function useKeyboardRise(
  contentRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const [rise, setRise] = useState(0);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const el = contentRef.current;
      if (!el) return;
      /* Keyboard height in layout pixels = the slice of the layout
         viewport the visual viewport does not reach. Zero when no
         keyboard (or on Android resizes-content mode, where centering
         already handles the rise on its own). */
      const overlap = Math.max(
        0,
        window.innerHeight - vv.offsetTop - vv.height,
      );
      if (overlap <= 0) {
        setRise(0);
        return;
      }
      /* Geometry from layout values only (centered top + offsetHeight) —
         immune to the transform we set, so repeated viewport events can
         never feed back into themselves and drift. */
      const top = (window.innerHeight - el.offsetHeight) / 2;
      const bottom = top + el.offsetHeight;
      const aboveKeyboard = window.innerHeight - overlap;
      /* Lift so the bottom clears the keyboard with a small gap… */
      const desired = bottom - aboveKeyboard + 12;
      /* …but never push the top edge off-screen. */
      const maxLift = Math.max(0, top - 12);
      setRise(Math.min(Math.max(0, desired), maxLift));
    };

    /* Schedule the first measurement — viewport metrics are only settled
       after the open animation starts, and event callbacks (below) are
       the sanctioned place to setState. */
    const firstFrame = requestAnimationFrame(update);

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(firstFrame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [active, contentRef]);

  return rise;
}
