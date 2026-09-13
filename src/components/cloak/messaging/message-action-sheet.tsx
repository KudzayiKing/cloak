"use client";

/*
 * MessageActionSheet — opens on long-press of a text bubble (user request:
 * "longpress should show translate button"). Bottom sheet on phones,
 * compact centered dialog on desktop. Buttons:
 *   - Translate to <chosen language>  (or "Show translation" once done)
 *   - Copy text
 * The translation itself runs entirely on-device (TranslateGemma/WebGPU);
 * nothing about the message is uploaded.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CopyIcon, CheckIcon, EyeIcon } from "@animateicons/react/lucide";
import { LanguagesIcon } from "lucide-react";

export function MessageActionSheet({
  open,
  onOpenChange,
  messagePreview,
  targetLanguageName,
  hasTranslation,
  showingOriginal,
  disabled,
  onTranslate,
  onToggleTranslation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messagePreview: string;
  targetLanguageName: string;
  hasTranslation?: boolean;
  showingOriginal?: boolean;
  disabled?: boolean;
  onTranslate: () => void;
  onToggleTranslation?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(messagePreview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; fail quietly, the user can still translate.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Mobile: bottom action sheet.
          "top-auto bottom-0 left-1/2 w-full max-w-none translate-x-[-50%] translate-y-0",
          "rounded-t-3xl rounded-b-none border-x-0 border-b-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
          // Desktop: compact centered dialog.
          "sm:top-[50%] sm:bottom-auto sm:max-w-sm sm:translate-y-[-50%] sm:rounded-2xl sm:border",
          "bg-cloak-bg-elevated border-cloak-border p-4"
        )}
      >
        <DialogTitle className="sr-only">Message actions</DialogTitle>
        <DialogDescription className="sr-only">
          Translate this message on-device or copy its text.
        </DialogDescription>

        {/* Quoted preview of the message being acted on */}
        <p className="mb-3 line-clamp-2 rounded-xl border border-cloak-border bg-cloak-bg/60 px-3 py-2 text-[12px] leading-relaxed text-cloak-text-secondary">
          {messagePreview}
        </p>

        <div className="flex flex-col gap-1.5">
          {hasTranslation ? (
            <SheetButton
              onClick={() => {
                onToggleTranslation?.();
                onOpenChange(false);
              }}
              icon={<EyeIcon size={15} />}
              label={showingOriginal ? "Show translation" : "Show original"}
            />
          ) : (
            <SheetButton
              gold
              disabled={disabled}
              onClick={() => {
                onTranslate();
                onOpenChange(false);
              }}
              icon={<LanguagesIcon size={15} />}
              label={`Translate to ${targetLanguageName}`}
            />
          )}
          <SheetButton
            onClick={copy}
            icon={copied ? <CheckIcon size={15} className="text-cloak-gold" /> : <CopyIcon size={15} />}
            label={copied ? "Copied" : "Copy text"}
          />
        </div>

        <p className="mt-3 px-1 text-[10.5px] leading-relaxed text-cloak-text-muted">
          Translation runs entirely on this device — the message text is never
          uploaded.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function SheetButton({
  icon,
  label,
  onClick,
  gold,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  gold?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[13.5px] font-medium transition-colors",
        gold
          ? "bg-cloak-gold-soft text-cloak-gold-bright hover:bg-cloak-gold-soft/70"
          : "text-cloak-text hover:bg-cloak-surface",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}
