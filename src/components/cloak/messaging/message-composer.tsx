"use client";

/*
 * MessageComposer (spec §18) — attachment, textarea, @CD trigger,
 * voice action, send. Multiline, robust, premium.
 *
 * Voice notes: the mic records with MediaRecorder and hands the caller a File
 * plus its duration. The bytes never leave the device — see
 * `attachment-storage.ts` — so the note travels as the same encrypted envelope
 * a file attachment uses, carrying name/mime/size/duration and nothing else.
 *
 * While recording, the recording bar REPLACES the input row rather than sitting
 * beside it. The composer is in flow, so its box already owns the strip against
 * the gesture area; swapping the row keeps that the only thing down there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ORCHESTRATOR_TRIGGER } from "@/lib/cloak/config";
import { formatVoiceClock } from "@/lib/cloak/utils";
import {
  PaperclipIcon,
  MicIcon,
  SendHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "@animateicons/react/lucide";

/** Longest single note, so a forgotten recording cannot grow without bound. */
const MAX_RECORDING_SEC = 300;

/** Preferred container/codec, best first. Safari has no webm and needs mp4. */
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function MessageComposer({
  onSend,
  onAttach,
  onVoice,
  disabled,
  ghost,
}: {
  onSend: (body: string) => void;
  onAttach?: (files: File[]) => void;
  onVoice?: (file: File, durationSec: number) => void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  /* Set when the take is being thrown away, so `onstop` does not send it. */
  const discardRef = useRef(false);
  const aliveRef = useRef(true);

  const invoked = value.trim().toLowerCase().startsWith(ORCHESTRATOR_TRIGGER.toLowerCase());

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(
    (send: boolean) => {
      discardRef.current = !send;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else releaseStream();
    },
    [releaseStream]
  );

  const startRecording = useCallback(async () => {
    if (recording || disabled) return;
    setRecordError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordError("This browser cannot record audio.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setRecordError("This browser cannot record audio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setRecordError("Microphone access is needed to record a voice note.");
      return;
    }

    const mimeType = pickAudioMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setRecordError("This browser cannot record audio.");
      return;
    }

    chunksRef.current = [];
    discardRef.current = false;
    streamRef.current = stream;
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const discarded = discardRef.current;

      releaseStream();
      recorderRef.current = null;
      if (!aliveRef.current) return;
      setRecording(false);
      setElapsed(0);

      if (discarded || blob.size === 0 || chunks.length === 0) return;
      const file = new File([blob], `voice-note-${Date.now()}.${extensionFor(type)}`, { type });
      onVoice?.(file, seconds);
    };

    startedAtRef.current = Date.now();
    recorder.start();
    setRecording(true);
    setElapsed(0);
    tickRef.current = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_RECORDING_SEC) stopRecording(true);
    }, 250);
  }, [recording, disabled, onVoice, releaseStream, stopRecording]);

  /* Leaving the screen mid-take must release the microphone — an open stream
     keeps the OS recording indicator on. */
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseStream();
    };
  }, [releaseStream]);

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
        /* Opaque, like the chat-list bottom nav (round 22). Inside a
           conversation the nav is hidden, so this bar is what sits against the
           gesture area — and a surface that has to match something the platform
           paints has to be a known colour, not a blend of whatever is behind it.

           No gesture-area bleed here, unlike the nav: the composer is IN FLOW,
           so its box already ends at the viewport bottom and its background
           already owns that strip. The nav is `fixed`, which is why it needs
           the documented grow-then-pull-down pattern instead. The safe-area
           padding keeps the content clear of the gesture bar either way, and
           resolves to 0 where there is no inset. */
        "bg-cloak-bg-elevated p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:p-4",
        /* Ghost chats: no separator line above the input (user feedback) */
        !ghost && "border-t border-cloak-border"
      )}
    >
      {recording ? (
        <div
          data-testid="voice-recording-bar"
          className="flex items-center gap-2 rounded-full border border-cloak-gold/40 bg-cloak-surface px-3 py-2"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cloak-gold-soft text-cloak-gold">
            <MicIcon size={16} />
          </span>
          <span className="cloak-rec-pulse h-2.5 w-2.5 shrink-0 rounded-full bg-cloak-gold" />
          <span
            data-testid="voice-elapsed"
            className="flex-1 text-[13px] tabular-nums text-cloak-text"
          >
            {formatVoiceClock(elapsed)}
          </span>
          <button
            aria-label="Discard voice note"
            type="button"
            onClick={() => stopRecording(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface-hover hover:text-cloak-text"
          >
            <Trash2Icon size={16} />
          </button>
          <button
            aria-label="Send voice note"
            type="button"
            onClick={() => stopRecording(true)}
            className="bg-cloak-gold/20 hover:bg-cloak-gold/25 grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-gold transition-transform active:scale-95"
          >
            <SendHorizontalIcon size={15} className="-rotate-90" />
          </button>
        </div>
      ) : (
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
              Cloak Dagger AI
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
              type="button"
              disabled={disabled}
              onClick={() => void startRecording()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface-hover hover:text-cloak-text"
              title="Record a voice note"
            >
              <MicIcon size={17} />
            </button>
          )}
        </div>
      )}

      {recordError && (
        <p role="status" className="mt-2 px-1 text-[11px] text-cloak-warning">
          {recordError}
        </p>
      )}
    </div>
  );
}
