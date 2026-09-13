"use client";

import { type ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { useAvailableViewportHeight } from "@/hooks/use-available-viewport-height";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof DialogContent>;

/*
 * Top-anchored sheet on phones, classic centered dialog on desktop
 * (user feedback round 10 — "new chat" flows).
 *
 * Problem this solves: the centered chat dialogs put their action
 * button at the bottom of a tall panel. When the phone keyboard opens
 * it covers the lower half of the layout viewport, the create button
 * disappeared under it, and a centered dialog cannot rise far enough
 * to clear a keyboard that tall.
 *
 * Design, per the user's request:
 * - Mobile: the sheet hangs from the TOP edge (tabs sit just under the
 *   status bar via the safe-area inset), grows downward, its body
 *   scrolls, and its footer stays pinned to the sheet's bottom edge.
 *   The sheet's max-height tracks the visual viewport, so when the
 *   keyboard opens the whole sheet — footer included — ends exactly at
 *   the keyboard's top edge. Nothing is ever under the keyboard.
 * - Desktop (sm+): unchanged centered dialog, capped to the viewport.
 */
export function SheetDialogContent({ className, style, ...props }: Props) {
  const available = useAvailableViewportHeight();

  return (
    <DialogContent
      {...props}
      className={cn(
        "flex flex-col gap-0 overflow-hidden",
        // Mobile: full-width sheet pinned to the top edge.
        "top-0 left-1/2 translate-x-[-50%] translate-y-0 rounded-t-none rounded-b-2xl",
        "pt-[env(safe-area-inset-top)]",
        // Keep the Radix close button clear of the notch / status bar.
        "[&_[data-slot=dialog-close]]:top-[max(1rem,env(safe-area-inset-top))]",
        // Desktop: back to the centered dialog.
        "sm:top-[50%] sm:translate-y-[-50%] sm:rounded-lg sm:pt-0",
        "sm:max-h-[calc(100dvh-2rem)]",
        className
      )}
      style={{
        ...style,
        /* Distance from layout top to the keyboard top (full viewport
           height when the keyboard is closed). */
        maxHeight: available != null ? `${available}px` : undefined,
      }}
    />
  );
}
