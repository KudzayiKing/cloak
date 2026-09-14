"use client";

/*
 * MessageBubble (spec §18) — incoming/outgoing/system/AI/file/voice/view-once,
 * reply state, delivery states. Dark, understated; gold as outgoing/security
 * accent only. Interactive processing badge for AI answers (spec §19).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/cloak/utils";
import { getLocalAttachment } from "@/lib/cloak/attachment-storage";
import { reactionById } from "@/lib/cloak/reactions";
import type { Message } from "@/lib/cloak/types";
import { useCloakStore } from "@/stores/cloak-store";
import { useTranslationStore, type MessageTranslation } from "@/stores/translation-store";
import { translationLanguageByCode } from "@/lib/cloak/translation-languages";
import { useLongPress } from "@/hooks/use-long-press";
import { MessageActionSheet } from "./message-action-sheet";
import {
  CheckIcon,
  CheckCheckIcon,
  EyeOffIcon,
  FileTextIcon,
  DownloadIcon,
  ImageIcon,
  AudioLinesIcon,
  PlayIcon,
  CpuIcon,
  CloudIcon,
  ChevronDownIcon,
  LockIcon,
  TriangleAlertIcon,
} from "@animateicons/react/lucide";
import { GhostGlyph } from "@/components/cloak/shared/ghost-icon";
import { CloakMark } from "@/components/cloak/brand/CloakLogo";

export function MessageBubble({
  message,
  showAuthor,
  authorInitials,
  showAvatar,
  cloakMode,
  onDownloadModel,
  onReact,
}: {
  message: Message;
  showAuthor?: string;
  authorInitials?: string;
  showAvatar?: boolean;
  cloakMode: boolean;
  onDownloadModel?: () => void;
  onReact?: (messageId: string, emoji: string) => void;
}) {
  /* Long-press translation (user request) — hooks run unconditionally at
     the top; text, media, and voice branches attach them where appropriate. */
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const translationLanguage = useCloakStore((s) => s.translationLanguage);
  const translation = useTranslationStore((s) => s.entries[message.id]);
  const showOriginal = useTranslationStore((s) => s.showOriginal[message.id]);
  const translateMessage = useTranslationStore((s) => s.translateMessage);
  const toggleShowOriginal = useTranslationStore((s) => s.toggleShowOriginal);
  const targetLanguage = translationLanguageByCode(translationLanguage);
  const openActionSheet = useCallback(() => setActionSheetOpen(true), []);
  const { longPressHandlers } = useLongPress(openActionSheet);

  const outgoing = message.authorId === "me";
  const cloakRedacted = cloakMode && !outgoing;
  const translatable = message.body.trim().length > 0 && !cloakRedacted;
  const canReact = Boolean(onReact) && !message.bodyLocked && message.kind !== "system" && message.kind !== "ai";
  const actionPreview = message.fileName ?? message.body;

  /* System / security events */
  if (message.kind === "system") {
    return (
      <div className="cloak-message-in flex justify-center py-1.5">
        <div className="inline-flex max-w-md items-center gap-2 rounded-full border border-cloak-border bg-cloak-bg-elevated/70 px-3.5 py-1.5 text-center text-[11px] leading-relaxed text-cloak-text-muted">
          {message.body.includes("locked") && <LockIcon size={11} className="shrink-0 text-cloak-warning" />}
          {message.body.includes("Ghost") && <GhostGlyph size={12} />}
          {message.body}
        </div>
      </div>
    );
  }

  /* E2EE: ciphertext this device cannot decrypt — either the conversation
     key is not synced yet (it will unlock automatically) or the key
     version was retired by the forward-secrecy window (permanent, by
     design). NEVER render the raw envelope. */
  if (message.bodyLocked) {
    const expired = message.bodyLockedReason === "expired";
    return (
      <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
        <div className="cloak-message-in flex max-w-[85%] items-center gap-2.5 rounded-3xl border border-dashed border-cloak-border-strong bg-cloak-surface/60 px-3.5 py-3 md:max-w-[70%]">
          <LockIcon size={14} className="shrink-0 text-cloak-text-muted" />
          <div>
            <p className="text-[13px] font-medium text-cloak-text">
              {expired ? "Message expired" : "Encrypted message"}
            </p>
            <p className="text-[11px] leading-relaxed text-cloak-text-muted">
              {expired
                ? "Forward secrecy removed this message's key — it can no longer be decrypted by anyone."
                : "Key not on this device yet — it will unlock automatically."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* AI answer */
  if (message.kind === "ai") {
    return <AIMessage message={message} cloakMode={cloakMode} onDownloadModel={onDownloadModel} />;
  }

  /* View-once */
  if (message.kind === "view-once") {
    return (
      <div
        {...(canReact ? longPressHandlers : {})}
        className={cn("flex", outgoing ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "cloak-message-in flex max-w-[80%] items-center gap-3 rounded-2xl border border-dashed border-cloak-border-strong bg-cloak-surface px-3.5 py-3",
            outgoing && "border-cloak-gold/20 bg-[#1D1A12]"
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-cloak-gold-soft text-cloak-gold">
            {message.viewed ? <EyeOffIcon size={16} className="text-cloak-text-muted" /> : <EyeOffIcon size={16} />}
          </span>
          <div>
            <p className="text-[13px] font-medium text-cloak-text">{message.fileName}</p>
            <p className="text-[11px] text-cloak-text-muted">
              {message.viewed ? "Opened — will not open again" : "View once"}
            </p>
          </div>
        </div>
        {canReact && (
          <MessageActionSheet
            open={actionSheetOpen}
            onOpenChange={setActionSheetOpen}
            messagePreview={message.fileName ?? "View-once media"}
            targetLanguageName={targetLanguage.name}
            hasTranslation={false}
            showTextActions={false}
            onTranslate={() => undefined}
            onReact={(emoji) => onReact?.(message.id, emoji)}
          />
        )}
      </div>
    );
  }

  /* File */
  if (message.kind === "file") {
    return (
      <AttachmentBubble
        message={message}
        outgoing={outgoing}
        kind="file"
        onReact={onReact}
      />
    );
  }

  /* Image */
  if (message.kind === "image") {
    return (
      <AttachmentBubble
        message={message}
        outgoing={outgoing}
        kind="image"
        onReact={onReact}
      />
    );
  }

  /* Voice note shell */
  if (message.kind === "voice") {
    return (
      <div
        {...(canReact ? longPressHandlers : {})}
        className={cn("flex", outgoing ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "cloak-message-in flex max-w-[80%] items-center gap-3 rounded-2xl border border-cloak-border bg-cloak-surface px-3.5 py-3",
            outgoing && "border-cloak-gold/20 bg-[#1D1A12]"
          )}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-cloak-gold-soft text-cloak-gold">
            <PlayIcon size={13} />
          </span>
          <AudioLinesIcon size={40} className="text-cloak-text-muted" />
          <span className="text-[11px] text-cloak-text-muted">{message.voiceDurationSec ?? 0}:00</span>
          <ReactionRow message={message} onReact={onReact} />
        </div>
        {canReact && (
          <MessageActionSheet
            open={actionSheetOpen}
            onOpenChange={setActionSheetOpen}
            messagePreview="Voice note"
            targetLanguageName={targetLanguage.name}
            hasTranslation={false}
            showTextActions={false}
            onTranslate={() => undefined}
            onReact={(emoji) => onReact?.(message.id, emoji)}
          />
        )}
      </div>
    );
  }

  /* Text — long-press opens the action sheet (Translate / Copy, user
     request). A running or finished translation renders inline with a
     "Show original" toggle; Cloak Mode redaction never gets translated
     (that would defeat the redaction). */
  const translationActive =
    translation && translation.status !== "error" && !showOriginal;

  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start", !outgoing && authorInitials && "items-end gap-2")}>
      {!outgoing && authorInitials && (
        <AuthorAvatar initials={authorInitials} visible={Boolean(showAvatar)} />
      )}
      <div className={cn("max-w-[85%] md:max-w-[70%]")}>
        {showAuthor && !outgoing && (
          <p className="mb-1 pl-1 text-[11px] font-medium text-cloak-text-muted">{showAuthor}</p>
        )}
        <div
          {...(translatable || canReact ? longPressHandlers : {})}
          className={cn(
            "cloak-message-in rounded-3xl border px-3.5 py-2.5",
            "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
            outgoing
              ? "rounded-tr-lg border-cloak-gold/15 bg-[#1D1A12] text-cloak-text"
              : "rounded-tl-lg border-cloak-border bg-cloak-surface text-cloak-text"
          )}
        >
          {translationActive && translation ? (
            <TranslationBody
              translation={translation}
              onToggle={() => toggleShowOriginal(message.id)}
            />
          ) : (
            <>
              <p className="whitespace-pre-wrap text-[length:var(--chat-bubble-text,13.5px)] leading-relaxed">
                {cloakRedacted ? (
                  <span className="cloak-redacted px-6">{message.body}</span>
                ) : (
                  message.body
                )}
              </p>
              {translation?.status === "done" && showOriginal && (
                <button
                  onClick={() => toggleShowOriginal(message.id)}
                  className="mt-1.5 text-[11px] font-medium text-cloak-gold-bright underline-offset-2 hover:underline"
                >
                  Show translation
                </button>
              )}
              {translation?.status === "error" && (
                <div className="mt-1.5">
                  <p className="text-[11px] leading-relaxed text-cloak-danger">
                    {translation.error}
                  </p>
                  <button
                    onClick={() =>
                      translateMessage(message.id, message.body, translationLanguage)
                    }
                    className="mt-1 text-[11px] font-medium text-cloak-gold-bright underline-offset-2 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          )}
          <ReactionRow message={message} onReact={onReact} />
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 px-1 text-[10px] text-cloak-text-muted",
            outgoing ? "justify-end" : "justify-start"
          )}
        >
          {message.disappearsAfter && message.disappearsAfter !== "off" && (
            <GhostGlyph size={11} />
          )}
          {formatTime(message.createdAt)}
          {outgoing && <DeliveryStatus status={message.status ?? "sent"} />}
        </div>

        {(translatable || canReact) && (
          <MessageActionSheet
            open={actionSheetOpen}
            onOpenChange={setActionSheetOpen}
            messagePreview={actionPreview}
            targetLanguageName={targetLanguage.name}
            hasTranslation={translation?.status === "done"}
            showingOriginal={Boolean(showOriginal)}
            onTranslate={() => translateMessage(message.id, message.body, translationLanguage)}
            onToggleTranslation={() => toggleShowOriginal(message.id)}
            onReact={(emoji) => onReact?.(message.id, emoji)}
          />
        )}
      </div>
    </div>
  );
}

function AttachmentBubble({
  message,
  outgoing,
  kind,
  onReact,
}: {
  message: Message;
  outgoing: boolean;
  kind: "file" | "image";
  onReact?: (messageId: string, emoji: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const openActionSheet = useCallback(() => setActionSheetOpen(true), []);
  const { longPressHandlers } = useLongPress(openActionSheet);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    async function load() {
      if (!message.attachmentId) {
        setAvailable(false);
        return;
      }
      const record = await getLocalAttachment(message.attachmentId).catch(() => null);
      if (cancelled) return;
      if (!record) {
        setAvailable(false);
        setUrl(null);
        return;
      }
      objectUrl = URL.createObjectURL(record.blob);
      setUrl(objectUrl);
      setAvailable(true);
    }
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.attachmentId]);

  const name = message.fileName ?? (kind === "image" ? "Photo" : "Attachment");
  const size = formatBytes(message.fileSizeBytes ?? 0);
  const canOpen = Boolean(url);

  const openAttachment = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
  };

  return (
    <div
      {...(onReact ? longPressHandlers : {})}
      className={cn("flex", outgoing ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "cloak-message-in max-w-[82%] rounded-2xl border p-2.5 md:max-w-[65%]",
          outgoing ? "border-cloak-gold/20 bg-[#1D1A12]" : "border-cloak-border bg-cloak-surface"
        )}
      >
        {kind === "image" && url ? (
          <button
            type="button"
            onClick={openAttachment}
            className="mb-2 block overflow-hidden rounded-xl border border-cloak-border bg-black/20"
            title="Open photo"
          >
            <img src={url} alt={name} className="max-h-64 w-full object-cover" />
          </button>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cloak-surface-hover text-cloak-text-secondary">
            {kind === "image" ? <ImageIcon size={16} /> : <FileTextIcon size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-cloak-text">{name}</p>
            <p className="text-[11px] text-cloak-text-muted">
              {size}
              {available === null
                ? " · checking device storage"
                : available
                  ? " · saved on this device"
                  : " · stored on sender device"}
            </p>
          </div>
          <button
            type="button"
            onClick={openAttachment}
            disabled={!canOpen}
            aria-label={canOpen ? `Download ${name}` : `${name} is not stored on this device`}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
              canOpen
                ? "text-cloak-gold hover:bg-cloak-gold-soft"
                : "cursor-not-allowed text-cloak-text-muted/45"
            )}
          >
            <DownloadIcon size={15} />
          </button>
          <ReactionRow message={message} onReact={onReact} />
        </div>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-1.5 px-1 text-[10px] text-cloak-text-muted",
            outgoing ? "justify-end" : "justify-start"
          )}
        >
          {formatTime(message.createdAt)}
          {outgoing && <DeliveryStatus status={message.status ?? "sent"} />}
        </div>
        {onReact && (
          <MessageActionSheet
            open={actionSheetOpen}
            onOpenChange={setActionSheetOpen}
            messagePreview={name}
            targetLanguageName=""
            hasTranslation={false}
            showTextActions={false}
            onTranslate={() => undefined}
            onReact={(emoji) => onReact(message.id, emoji)}
          />
        )}
      </div>
    </div>
  );
}

function AuthorAvatar({ initials, visible }: { initials: string; visible: boolean }) {
  return (
    <span
      className={cn(
        "mb-5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-surface text-[10px] font-semibold text-cloak-text-secondary",
        !visible && "invisible"
      )}
      aria-hidden={!visible}
    >
      {initials}
    </span>
  );
}

function ReactionRow({
  message,
  onReact,
}: {
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
}) {
  const reactions = (message.reactions ?? []).filter((r) => r.count > 0);
  if (!reactions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => {
        const option = reactionById(reaction.emoji);
        if (!option) return null;
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onReact?.(message.id, reaction.emoji)}
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-full px-0.5 text-[12px] font-medium text-cloak-text-muted transition-transform hover:scale-105 active:scale-95",
              reaction.mine && "text-cloak-text"
            )}
            title={option.label}
            aria-label={`${reaction.count} ${option.label} reaction${reaction.count === 1 ? "" : "s"}`}
          >
            <img src={option.src} alt="" className="h-9 w-9 object-contain" />
            {reaction.count > 1 && <span>{reaction.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/*
 * Inline translation states inside the bubble: preparing, one-time model
 * download with progress, model loading, streaming, done.
 */
function TranslationBody({
  translation,
  onToggle,
}: {
  translation: MessageTranslation;
  onToggle: () => void;
}) {
  const bodyTextClass =
    "text-[length:var(--chat-bubble-text,13.5px)] leading-relaxed";

  if (translation.status === "preparing") {
    return (
      <p className={cn(bodyTextClass, "text-cloak-text-secondary")}>
        Preparing on-device translation…
      </p>
    );
  }

  if (translation.status === "downloading") {
    const pct =
      translation.progress != null ? Math.round(translation.progress * 100) : null;
    return (
      <div>
        <p className="text-[11.5px] leading-relaxed text-cloak-text-secondary">
          Downloading translation model
          {pct != null ? ` — ${pct}%` : "…"}
          {translation.receivedBytes != null && translation.totalBytes
            ? ` · ${(translation.receivedBytes / 1_000_000_000).toFixed(1)} / ${(
                translation.totalBytes / 1_000_000_000
              ).toFixed(1)} GB`
            : ""}
        </p>
        <p className="mt-0.5 text-[10px] text-cloak-text-muted">
          One-time download, stored on this device.
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-cloak-border">
          <div
            className="h-full rounded-full bg-cloak-gold transition-[width]"
            style={{ width: `${pct ?? 2}%` }}
          />
        </div>
      </div>
    );
  }

  if (translation.status === "loading") {
    return (
      <p className={cn(bodyTextClass, "text-cloak-text-secondary")}>
        Loading translation model…
      </p>
    );
  }

  /* streaming | done */
  return (
    <>
      <p className={cn(bodyTextClass, "whitespace-pre-wrap")}>
        {translation.text || "…"}
      </p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="text-[10px] text-cloak-gold">
          Translated to {translation.targetName} · on-device
        </span>
        {translation.status === "done" && (
          <button
            onClick={onToggle}
            className="text-[10px] font-medium text-cloak-text-muted underline-offset-2 hover:text-cloak-text hover:underline"
          >
            Show original
          </button>
        )}
      </div>
    </>
  );
}

function DeliveryStatus({ status }: { status: Message["status"] }) {
  if (status === "sending")
    return <span className="text-[10px] text-cloak-text-muted">sending</span>;
  if (status === "failed")
    return <span className="text-[10px] text-cloak-danger">failed — tap to retry</span>;
  if (status === "sent") return <CheckIcon size={11} />;
  if (status === "delivered") return <CheckCheckIcon size={11} />;
  return <CheckCheckIcon size={11} className="text-cloak-gold" />;
}

/*
 * AI message with interactive processing badge (spec §19).
 */
function AIMessage({
  message,
  cloakMode,
  onDownloadModel,
}: {
  message: Message;
  cloakMode: boolean;
  onDownloadModel?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ai = message.ai;

  const isUnavailable = !message.body && ai?.route === "local-llm";
  const needsConsent = ai?.route === "cloud-fallback";

  return (
    <div className="cloak-message-in flex justify-start">
      <div className="max-w-[88%] md:max-w-[75%]">
        <div
          className={cn(
            "rounded-3xl rounded-tl-lg border p-3.5",
            needsConsent
              ? "border-cloak-warning/25 bg-cloak-warning/5"
              : "border-cloak-gold/20 bg-cloak-gold-soft/40"
          )}
        >
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-cloak-gold">
              <CloakMark size={12} />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cloak-gold">
              Cloak Intelligence
            </span>
          </div>

          {isUnavailable ? (
            <div>
              <p className="text-[13px] leading-relaxed text-cloak-text">
                This answer needs local reasoning, but the local model is not
                installed on this device yet.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={onDownloadModel}
                  className="rounded-full border border-cloak-gold/30 bg-cloak-gold-soft px-3 py-1.5 text-[12px] font-medium text-cloak-gold-bright transition-colors hover:bg-cloak-gold-soft/70"
                >
                  Set up in Cloak Intelligence
                </button>
              </div>
            </div>
          ) : needsConsent ? (
            <div>
              <div className="flex items-start gap-2 text-[13px] leading-relaxed text-cloak-text-secondary">
                <TriangleAlertIcon size={15} className="mt-0.5 shrink-0 text-cloak-warning" />
                Local retrieval found no confident answer. To continue, selected
                context would need to leave this device for cloud processing —
                which is off by default and never silent.
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={onDownloadModel}
                  className="rounded-full border border-cloak-gold/30 bg-cloak-gold-soft px-3 py-1.5 text-[12px] font-medium text-cloak-gold-bright transition-colors hover:bg-cloak-gold-soft/70"
                >
                  Install the local model instead
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-cloak-text">
              {cloakMode && false ? "" : message.body}
            </p>
          )}

          {/* Processing badge — interactive */}
          {ai && (
            <button
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="mt-2.5 flex flex-wrap items-center gap-1.5 text-left"
            >
              <span className="inline-flex items-center gap-1 rounded-full border border-cloak-gold/25 bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-gold-bright">
                <CpuIcon size={9} />
                On-device
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-text-secondary">
                <CloudIcon size={9} />
                Cloud not used
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-text-secondary">
                {ai.retrievedItems} memories used
              </span>
              <ChevronDownIcon
                size={11}
                className={cn("text-cloak-text-muted transition-transform", detailsOpen && "rotate-180")}
              />
            </button>
          )}

          {detailsOpen && ai && (
            <dl className="cloak-message-in mt-3 space-y-1.5 rounded-xl border border-cloak-border bg-cloak-bg/80 p-3 text-[11px]">
              <Detail label="Processing" value={ai.route === "deterministic" ? "Deterministic retrieval" : "Local generation"} />
              <Detail label="Provider" value={ai.provider} />
              <Detail label="Model" value={ai.model} />
              <Detail label="Location" value={ai.location} />
              <Detail label="Cloud used" value={ai.cloudUsed ? "Yes" : "No"} />
              <Detail label="Memory uploaded" value={ai.memoryUploaded ? "Yes" : "No"} />
              <Detail label="Retrieved items" value={String(ai.retrievedItems)} />
              {ai.retrieved.length > 0 && (
                <div className="pt-1.5">
                  <dt className="mb-1 text-cloak-text-muted">Retrieved memories</dt>
                  <dd className="space-y-1">
                    {ai.retrieved.map((r) => (
                      <p
                        key={r.id}
                        className="rounded-lg border border-cloak-border bg-cloak-surface px-2 py-1.5 leading-relaxed text-cloak-text-secondary"
                      >
                        {r.label}
                      </p>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
        <p className="mt-1 px-1 text-[10px] text-cloak-text-muted">{formatTime(message.createdAt)}</p>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-cloak-text-muted">{label}</dt>
      <dd className="text-right text-cloak-text-secondary">{value}</dd>
    </div>
  );
}
