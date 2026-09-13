"use client";

/*
 * GhostGlyph — the Ghost Chat marker (user requirement):
 * the Lucide "ghost" glyph (lucide.dev/icons/ghost), always white
 * (#ffffff).
 *
 * Animation is interaction-driven (user feedback round 3):
 *  - Web: floats while the mouse is over the icon
 *  - Mobile: floats only while the icon is pressed
 * Pointer events cover both: mouseenter/mouseleave for hover,
 * pointerdown/pointerup/pointercancel for touch presses.
 */

import { useState } from "react";
import { Ghost } from "lucide-react";
import { cn } from "@/lib/utils";

export function GhostGlyph({
  size = 12,
  className,
  animate = true,
}: {
  size?: number;
  className?: string;
  /** When true (default) the float animation plays on hover (web) / press (mobile). */
  animate?: boolean;
}) {
  const [engaged, setEngaged] = useState(false);
  const engage = () => setEngaged(true);
  const disengage = () => setEngaged(false);

  const handlers = animate
    ? {
        onPointerEnter: engage,
        onPointerDown: engage,
        onPointerLeave: disengage,
        onPointerUp: disengage,
        onPointerCancel: disengage,
      }
    : undefined;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center leading-none",
        className
      )}
      {...handlers}
    >
      <Ghost
        color="#ffffff"
        size={size}
        strokeWidth={2}
        className={engaged ? "cloak-ghost-float" : undefined}
      />
    </span>
  );
}
