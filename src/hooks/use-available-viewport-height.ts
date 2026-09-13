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
