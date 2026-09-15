"use client";

/*
 * IntelligencePage — private assistant workspace (spec §20).
 * Context selector, query composer with real orchestrator execution,
 * labeled responses, and a control panel for model, permissions, scope.
 */

import { useState } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { AIModelCard } from "./model-install-card";
import { useCloakStore } from "@/stores/cloak-store";
import { cloakOrchestrator, ensureSeededMemories } from "@/ai/orchestrator/CloakOrchestrator";
import { SEED_MEMORIES } from "@/lib/cloak/demo-data";
import { memoryStore } from "@/ai/memory/MemoryStore";
import type { MemoryScope } from "@/lib/cloak/types";
import { cn } from "@/lib/utils";
import { CloakMark } from "@/components/cloak/brand/CloakLogo";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  SparklesIcon,
  SendHorizontalIcon,
  CpuIcon,
  CloudIcon,
  ShieldCheckIcon,
  Trash2Icon,
  MemoryStickIcon,
  TriangleAlertIcon,
} from "@animateicons/react/lucide";

const CONTEXT_OPTIONS: { value: MemoryScope; label: string }[] = [
  { value: "current-conversation", label: "Current chat" },
  { value: "selected-conversations", label: "Selected chats" },
  { value: "selected-contacts", label: "People" },
  { value: "all-permitted", label: "All allowed sources" },
];

interface SessionEntry {
  id: string;
  query: string;
  answer: string;
  state: "answered" | "local-unavailable" | "consent-required";
  provider?: string;
  model?: string;
  retrievedItems: number;
  retrievedLabels: string[];
}

const SUGGESTIONS = [
  "What time did Sarah say dinner was?",
  "What is happening on Thursday?",
  "Summarize what Maya confirmed.",
];

export function IntelligencePage() {
  const aiSettings = useCloakStore((s) => s.ai);
  const setAI = useCloakStore((s) => s.setAI);
  const [scope, setScope] = useState<MemoryScope>(aiSettings.memoryScope);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionEntry[]>([]);

  const disabled = !aiSettings.enabled;

  const ask = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q || busy || disabled) return;
    setBusy(true);
    setQuery("");
    ensureSeededMemories(SEED_MEMORIES);

    const result = await cloakOrchestrator.run({
      query: q,
      retrieval: { scope },
      allowLocalLLM: true,
    });

    const entry: SessionEntry = {
      id: `q-${Date.now()}`,
      query: q,
      answer: result.answer,
      state:
        result.answer
          ? "answered"
          : result.route === "cloud-fallback"
            ? "consent-required"
            : "local-unavailable",
      provider: result.ai?.provider,
      model: result.ai?.model,
      retrievedItems: result.ai?.retrievedItems ?? 0,
      retrievedLabels: result.ai?.retrieved.map((r) => r.label) ?? [],
    };
    setSession((s) => [...s, entry]);
    setBusy(false);
  };

  return (
    <AppShell active="/app/intelligence">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_320px]">
        {/* Main workspace */}
        <div className="cloak-scroll flex min-h-0 flex-col overflow-y-auto pb-[calc(56px+env(safe-area-inset-bottom))] pt-14 md:pb-0 md:pt-0">
          <header className="border-b border-cloak-border bg-cloak-bg-elevated/60 px-5 py-4 md:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
                  <SparklesIcon size={17} />
                </span>
                <div>
                  <h1 className="text-base font-semibold text-cloak-text">Cloaq Intelligence</h1>
                  <p className="text-[11.5px] text-cloak-text-muted">
                    Private assistant workspace · local-first
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  disabled
                    ? "border-cloak-border text-cloak-text-muted"
                    : "border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold-bright"
                )}
              >
                <CpuIcon size={11} />
                {disabled ? "Disabled" : "On-device"}
              </span>
            </div>

            {/* Context selector */}
            <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Memory scope">
              {CONTEXT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  role="tab"
                  aria-selected={scope === opt.value}
                  onClick={() => {
                    setScope(opt.value);
                    setAI({ memoryScope: opt.value });
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition-colors",
                    scope === opt.value
                      ? "border-cloak-gold/40 bg-cloak-gold-soft text-cloak-gold-bright"
                      : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </header>

          {/* Session */}
          <div className="flex-1 space-y-4 px-5 py-6 md:px-8">
            {disabled ? (
              <div className="mx-auto max-w-md rounded-2xl border border-cloak-border bg-cloak-surface p-6 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-cloak-border bg-cloak-bg text-cloak-text-muted">
                  <SparklesIcon size={20} />
                </span>
                <p className="mt-4 text-sm font-medium text-cloak-text">
                  Cloaq Intelligence is disabled.
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-cloak-text-muted">
                  Messaging works normally without it. Re-enable it from the
                  control panel whenever you want local intelligence back.
                </p>
                <Button
                  className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-5 border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
                  size="sm"
                  onClick={() => setAI({ enabled: true })}
                >
                  Enable Cloaq Intelligence
                </Button>
              </div>
            ) : session.length === 0 ? (
              <div className="mx-auto max-w-md py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
                  <CloakMark size={20} />
                </span>
                <p className="mt-4 text-base font-medium text-cloak-text">
                  Ask about what Cloaq already knows.
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-cloak-text-muted">
                  Questions are answered from local memory where possible —
                  deterministically, without invoking the model.
                </p>
                <div className="mt-6 space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="w-full rounded-xl border border-cloak-border bg-cloak-surface px-4 py-3 text-left text-[13px] text-cloak-text-secondary transition-colors hover:border-cloak-gold/30 hover:bg-cloak-surface-hover hover:text-cloak-text"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              session.map((entry) => <SessionCard key={entry.id} entry={entry} />)
            )}

            {busy && (
              <div className="mx-auto max-w-xl animate-pulse rounded-2xl border border-cloak-border bg-cloak-surface/60 p-5">
                <div className="h-3 w-2/3 rounded bg-cloak-surface-hover" />
                <div className="mt-2.5 h-3 w-1/2 rounded bg-cloak-surface-hover" />
                <p className="mt-3 text-[11px] text-cloak-text-muted">
                  Retrieving from local memory…
                </p>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-cloak-border bg-cloak-bg-elevated/60 p-4 md:px-8">
            <div className="flex items-end gap-2 rounded-2xl border border-cloak-border bg-cloak-surface px-4 py-2.5">
              <textarea
                rows={1}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder={disabled ? "Cloaq Intelligence is disabled" : "Ask about your conversations, people, or decisions"}
                aria-label="Ask Cloaq Intelligence"
                className="cloak-scroll max-h-[120px] w-full resize-none bg-transparent py-1.5 text-[13.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted"
                disabled={disabled || busy}
              />
              <button
                aria-label="Send question"
                onClick={() => void ask()}
                disabled={disabled || busy || !query.trim()}
                className="bg-cloak-gold/20 hover:bg-cloak-gold/25 grid h-9 w-9 shrink-0 place-items-center rounded-full text-cloak-gold transition-transform active:scale-95 disabled:opacity-40"
              >
                <SendHorizontalIcon size={15} />
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[10.5px] text-cloak-text-muted">
              Answers run locally. Cloud fallback requires explicit consent and is off by default.
            </p>
          </div>
        </div>

        {/* Control panel */}
        <aside className="cloak-scroll hidden flex-col gap-5 overflow-y-auto border-l border-cloak-border bg-cloak-bg-elevated p-5 lg:flex" aria-label="Intelligence controls">
          <section>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
              Local model
            </h2>
            <AIModelCard />
          </section>

          <section>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
              AI permissions
            </h2>
            <div className="space-y-3 rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
              <ToggleRow
                label="Cloaq Intelligence"
                note="Master switch for local intelligence"
                checked={aiSettings.enabled}
                onChange={(v) => setAI({ enabled: v })}
              />
              <ToggleRow
                label="Persistent memory"
                note="Keep retrieved facts locally between sessions"
                checked={aiSettings.persistentMemory}
                onChange={(v) => setAI({ persistentMemory: v })}
              />
              <ToggleRow
                label="Translation"
                note="Local translation where a model is installed"
                checked={aiSettings.translation}
                onChange={(v) => setAI({ translation: v })}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
              <MemoryStickIcon size={12} />
              Memory scope
            </h2>
            <div className="rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
              <p className="text-[12px] leading-relaxed text-cloak-text-secondary">
                {scopeLabel(scope)}
              </p>
              <p className="mt-2 text-[11px] text-cloak-text-muted">
                {memoryStore.count()} local memories stored · nothing uploaded
              </p>
            </div>
          </section>

          <section className="mt-auto space-y-2.5">
            <button
              onClick={() => setSession([])}
              className="flex w-full items-center gap-2.5 rounded-xl border border-cloak-border bg-cloak-bg/50 p-3.5 text-left text-[13px] text-cloak-text-secondary transition-colors hover:bg-cloak-surface"
            >
              <Trash2Icon size={14} className="text-cloak-text-muted" />
              Clear session
            </button>
            <button
              onClick={() => setAI({ enabled: false })}
              className="flex w-full items-center gap-2.5 rounded-xl border border-cloak-danger/25 bg-cloak-danger/5 p-3.5 text-left text-[13px] text-cloak-danger transition-colors hover:bg-cloak-danger/10"
            >
              <TriangleAlertIcon size={14} />
              Disable Cloaq Intelligence
            </button>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function SessionCard({ entry }: { entry: SessionEntry }) {
  return (
    <article className="mx-auto max-w-xl space-y-2">
      <div className="rounded-2xl border border-cloak-border bg-cloak-surface px-4 py-3">
        <p className="text-[13.5px] leading-relaxed text-cloak-text">{entry.query}</p>
      </div>

      <div
        className={cn(
          "rounded-2xl border p-4",
          entry.state === "answered"
            ? "border-cloak-gold/20 bg-cloak-gold-soft/40"
            : "border-cloak-warning/25 bg-cloak-warning/5"
        )}
      >
        {entry.state === "answered" ? (
          <p className="text-[13.5px] leading-relaxed text-cloak-text">{entry.answer}</p>
        ) : entry.state === "local-unavailable" ? (
          <p className="text-[13px] leading-relaxed text-cloak-text-secondary">
            Local reasoning is not installed on this device yet. Install the
            local model in the panel to answer this locally — Cloaq will not
            send it anywhere without your explicit consent.
          </p>
        ) : (
          <div className="flex items-start gap-2 text-[13px] leading-relaxed text-cloak-text-secondary">
            <TriangleAlertIcon size={15} className="mt-0.5 shrink-0 text-cloak-warning" />
            No confident answer from local memory. Cloud processing would send
            selected context off this device — it remains off unless you allow it.
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-cloak-gold/25 bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-gold-bright">
            <CpuIcon size={9} />
            On-device
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-text-secondary">
            <CloudIcon size={9} />
            Cloud not used
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[10px] text-cloak-text-secondary">
            <ShieldCheckIcon size={9} />
            {entry.retrievedItems} memories used
          </span>
        </div>

        {entry.retrievedLabels.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-cloak-border pt-3">
            {entry.retrievedLabels.map((label) => (
              <li
                key={label}
                className="rounded-md border border-cloak-border bg-cloak-surface px-2.5 py-1.5 text-[11.5px] leading-relaxed text-cloak-text-secondary"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function ToggleRow({
  label,
  note,
  checked,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[13px] text-cloak-text">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-cloak-text-muted">{note}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function scopeLabel(scope: MemoryScope): string {
  switch (scope) {
    case "current-conversation":
      return "Only the current conversation is used for retrieval.";
    case "selected-conversations":
      return "Only conversations you select are used for retrieval.";
    case "selected-contacts":
      return "Only messages with people you select are used.";
    case "all-permitted":
      return "All conversations where AI access is allowed are used.";
    case "none":
      return "No persistent memory. Each request stands alone.";
  }
}
