"use client";

import { type ComponentProps, type CSSProperties } from "react";
import { DialogContent } from "@/components/ui/dialog";
import {
  useAvailableViewportHeight,
  useKeyboardInset,
} from "@/hooks/use-available-viewport-height";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof DialogContent> & {
  /** Which edge the phone sheet hangs from. Desktop is unaffected. */
  anchor?: "top" | "bottom";
};

/*
 * Mobile sheet, classic centered dialog on desktop.
 *
 * `anchor` picks the edge the phone sheet hangs from. Everything else — full
 * width, horizontal centring, the max-height that tracks the visual viewport,
 * the desktop reset — is shared.
 *
 * - "top" (default) — the original behaviour (user feedback round 10).
 *   Problem it solves: the centered chat dialogs put their action button at
 *   the bottom of a tall panel. When the phone keyboard opens it covers the
 *   lower half of the layout viewport, the create button disappeared under
 *   it, and a centered dialog cannot rise far enough to clear a keyboard that
 *   tall. So the sheet hangs from the TOP edge, grows downward, its body
 *   scrolls, and its footer stays pinned to the sheet's bottom edge — which
 *   the max-height keeps exactly at the keyboard's top edge.
 *
 * - "bottom" — the new-chat picker (user feedback round 45). It is a short,
 *   scannable list rather than a form, so it belongs where a thumb already
 *   is: pinned to the bottom edge at 70% of the screen, square-bottomed and
 *   rounded on top.
 *
 *   The keyboard needs different handling here, and that is the whole reason
 *   `useKeyboardInset` exists: `bottom: 0` is the bottom of the LAYOUT
 *   viewport, which on iOS does not move when the keyboard opens — a sheet
 *   anchored there would sit behind the keyboard, footer and all. So the
 *   bottom offset is the keyboard's height, and the shared max-height still
 *   caps the sheet at the space above it. Searching contacts therefore never
 *   buries the list.
 *
 * The two placements are written as whole, mutually exclusive strings rather
 * than assembled from shared fragments, because their ORDER against
 * `className` is load-bearing and differs:
 *
 *   `className` is where callers pass `p-0`, and twMerge resolves a later
 *   `p-0` against an earlier `pb-`/`pt-` by dropping the longhand. The top
 *   branch therefore stays BEFORE `className` — byte-for-byte its previous
 *   classes, so the two dialogs that use it cannot be affected by this
 *   change — while the bottom branch goes AFTER, so its safe-area padding
 *   survives. (Net effect today: the top branch's safe-area inset is inert.
 *   Left alone deliberately, to keep this change scoped to the new-chat
 *   modal; see the note in the round-45 log.)
 */
export function SheetDialogContent({
  className,
  style,
  anchor = "top",
  ...props
}: Props) {
  const available = useAvailableViewportHeight();
  const keyboardInset = useKeyboardInset();
  const bottom = anchor === "bottom";

  return (
    <DialogContent
      {...props}
      className={cn(
        "flex flex-col gap-0 overflow-hidden",
        !bottom &&
          "top-0 left-1/2 translate-x-[-50%] translate-y-0 rounded-t-none rounded-b-2xl pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[max(1rem,env(safe-area-inset-top))] sm:top-[50%] sm:translate-y-[-50%] sm:rounded-lg sm:pt-0 sm:max-h-[calc(100dvh-2rem)]",
        className,
        bottom &&
          "bottom-[var(--cloak-sheet-bottom)] top-auto left-1/2 h-[70dvh] translate-x-[-50%] translate-y-0 rounded-t-2xl rounded-b-none pb-[env(safe-area-inset-bottom)] sm:top-[50%] sm:bottom-auto sm:h-auto sm:translate-y-[-50%] sm:rounded-lg sm:pb-0 sm:pt-0 sm:max-h-[calc(100dvh-2rem)]"
      )}
      style={
        {
          ...style,
          /* How far a bottom-anchored sheet rises to clear the keyboard; 0
             when none is open. Always set — an unset `var()` would make
             `bottom` fall back to `auto` and unanchor the sheet. */
          "--cloak-sheet-bottom": `${keyboardInset}px`,
          /* Distance from the layout top down to the keyboard top (the full
             viewport height when the keyboard is closed) — the hard ceiling
             for either anchor. */
          maxHeight: available != null ? `${available}px` : undefined,
        } as CSSProperties
      }
    />
  );
}
