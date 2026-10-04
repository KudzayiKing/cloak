"use client";

import { useEffect, useState } from "react";

/*
 * Height available to a fixed, TOP-ANCHORED sheet (user feedback round 10).
 *
 * When the on-screen keyboard opens it shrinks the VISUAL viewport while
 * the layout viewport keeps its size (iOS always; Android when
 * interactive-widget is not "resizes-content"). A top-anchored fixed
 * sheet must therefore never grow past:
 *
 *   visualViewport.offsetTop + visualViewport.height
 *
 * — the distance from the top of the layout viewport down to the top
 * edge of the keyboard. With no keyboard open this is simply the full
 * viewport height, so the value is safe to apply unconditionally as a
 * max-height. Returns null until the first measurement settles.
 */
export function useAvailableViewportHeight() {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      /* Ancient engines without visualViewport: the layout viewport is
         the only truth we have. */
      const onResize = () => setHeight(window.innerHeight);
      const firstFrame = requestAnimationFrame(onResize);
      window.addEventListener("resize", onResize);
      return () => {
        cancelAnimationFrame(firstFrame);
        window.removeEventListener("resize", onResize);
      };
    }

    const update = () => {
      /* offsetTop is 0 in this fixed-shell app (no page scroll); guard
         for browsers that report a non-zero offset after focus-driven
         scrolling anyway. */
      setHeight(Math.round(vv.offsetTop + vv.height));
    };

    /* First measurement is scheduled, never synchronous — viewport
       metrics are only settled after the open animation starts, and
       event callbacks are the sanctioned place to setState. */
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
  }, []);

  return height;
}

/*
 * Distance from the BOTTOM of the layout viewport up to the keyboard's top
 * edge — how far a BOTTOM-ANCHORED sheet must rise to stay visible.
 *
 * A top-anchored sheet needs only a max-height (above). A bottom-anchored
 * one needs an OFFSET instead, because `bottom: 0` is the bottom of the
 * LAYOUT viewport, and on iOS that stays put while the keyboard covers it:
 * a sheet anchored there would sit entirely behind the keyboard, footer
 * and all. Subtracting the two viewport heights gives the lift.
 *
 * Returns 0 in the two cases where no lift is wanted:
 * - no keyboard open, where the visual viewport fills the layout viewport
 *   (true in this standalone PWA — no URL bar to disagree over), and
 * - engines that shrink the layout viewport itself (Android with
 *   `interactive-widget=resizes-content`), where `bottom: 0` is already
 *   the keyboard's top edge and lifting again would double-count.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const keyboardTop = vv.offsetTop + vv.height;
      setInset(Math.max(0, Math.round(window.innerHeight - keyboardTop)));
    };

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
  }, []);

  return inset;
}
