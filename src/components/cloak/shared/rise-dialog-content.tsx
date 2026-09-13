"use client";

import { useRef, type ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { useKeyboardRise } from "@/hooks/use-keyboard-rise";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof DialogContent>;

/*
 * DialogContent that rises above the on-screen keyboard on phones
 * (user feedback round 9). Drop-in replacement for DialogContent on
 * in-app dialogs: Radix unmounts dialog content while the dialog is
 * closed, so the keyboard-rise hook running "always" is exactly active
 * while open — listeners exist only for the open dialog.
 *
 * The rise is capped so the dialog's top edge never leaves the screen;
 * geometry is derived from layout values (centered top + offsetHeight),
 * so the applied transform can never feed back into the measurement.
 */
export function RiseDialogContent({ className, style, ...props }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const rise = useKeyboardRise(contentRef, true);

  return (
    <DialogContent
      {...props}
      ref={contentRef}
      className={cn(
        // Single explicit track that may shrink to 0 — truncatable content
        // (long addresses, signatures) can never inflate the implicit grid
        // track and push the dialog wider than the viewport.
        "grid grid-cols-[minmax(0,1fr)] transition-transform duration-200 ease-out",
        className
      )}
      style={{
        ...style,
        ...(rise > 0 ? { transform: `translateY(-${rise}px)` } : null),
      }}
    />
  );
}
