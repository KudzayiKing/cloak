"use client";

/*
 * MessageComposer (spec §18) — attachment, textarea, @Cloak trigger,
 * voice action, send. Multiline, robust, premium.
 */

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ORCHESTRATOR_TRIGGER } from "@/lib/cloak/config";
import {
  PaperclipIcon,
  MicIcon,
  SendHorizontalIcon,
  SparklesIcon,
} from "@animateicons/react/lucide";

export function MessageComposer({
  onSend,
  onAttach,
  disabled,
  ghost,
}: {
  onSend: (body: string) => void;
  onAttach?: (files: File[]) => void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invoked = value.trim().toLowerCase().startsWith(ORCHESTRATOR_TRIGGER.toLowerCase());

  const submit = () => {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  return (
    <div
      className={cn(
        "bg-cloak-bg-elevated/60 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:p-4",
        /* Ghost chats: no separator line above the input (user feedback) */
        !ghost && "border-t border-cloak-border"
      )}
    >
      <div
        className={cn(
          "flex items-end gap-2 rounded-full border bg-cloak-surface px-3 py-2 transition-colors",
          invoked ? "border-cloak-gold/40" : "border-cloak-border"
        )}
      >
        <button
          aria-label="Attach a file"
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface-hover hover:text-cloak-text"
          title="Attachments arrive with the secure transport layer"
        >
          <PaperclipIcon size={17} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            if (!files.length || disabled) return;
            onAttach?.(files);
          }}
        />

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Message or ${ORCHESTRATOR_TRIGGER}`}
          aria-label="Message"
          className="cloak-scroll max-h-[140px] min-h-[36px] w-full resize-none bg-transparent py-2 text-[13.5px] leading-relaxed text-cloak-text outline-none placeholder:text-cloak-text-muted"
        />

        {invoked && (
          <span className="mb-2 hidden shrink-0 items-center gap-1 rounded-full border border-cloak-gold/30 bg-cloak-gold-soft px-2 py-1 text-[10px] font-medium text-cloak-gold-bright sm:inline-flex">
            <SparklesIcon size={10} />
            Cloaq Intelligence
          </span>
        )}

        {value.trim() ? (
          <button
            aria-label="Send message"
            onClick={submit}
            className="bg-cloak-gold/20 hover:bg-cloak-gold/25 grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-gold transition-transform active:scale-95"
          >
            {/* Rotated 90° counter-clockwise per user feedback */}
            <SendHorizontalIcon size={15} className="-rotate-90" />
          </button>
        ) : (
          <button
            aria-label="Record a voice note"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface-hover hover:text-cloak-text"
            title="Voice notes arrive with the secure transport layer"
          >
            <MicIcon size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
