"use client";

import { XIcon } from "@animateicons/react/lucide";

export function PanelCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close panel"
      className="grid h-8 w-8 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface hover:text-cloak-text"
    >
      <XIcon size={15} />
    </button>
  );
}
