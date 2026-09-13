"use client";

/*
 * Marketing: Intelligence page (spec §8, §10-D/E).
 */

import {
  Container,
  SectionHeading,
  Surface,
  PrimaryCTA,
  OnDeviceBadge,
} from "@/components/cloak/shared/primitives";
import { ClosingCTA } from "./home-sections-b";
import {
  MemoryStickIcon,
  SearchIcon,
  BrainIcon,
  RouteIcon,
  ShieldCheckIcon,
  CpuIcon,
  CloudOffIcon,
} from "@animateicons/react/lucide";

const PIPELINE = [
  {
    icon: MemoryStickIcon,
    title: "Memory — local store",
    body: "Facts, people, events, and summaries you choose to keep. Browser-local by design and structured for encryption at rest. Ghost Chats are excluded unless you allow otherwise.",
  },
  {
    icon: SearchIcon,
    title: "Retrieval — scoped and small",
    body: "Structured indexes, keyword search, recency, conversation and contact scope, plus local semantic search. The pipeline selects a handful of permissioned items — never your whole history.",
  },
  {
    icon: BrainIcon,
    title: "Reasoning — Gemma on-device",
    body: "Gemma 4 E2B (instruction-tuned, QAT) runs in a Web Worker over WebGPU. Synthesis happens only when a request needs it, and the model never searches memory itself.",
  },
  {
    icon: RouteIcon,
    title: "Orchestration — honest routing",
    body: "Every request is classified: answer deterministically, retrieve only, reason locally, translate, or — only with explicit consent — fall back to cloud. Each answer carries its route as a label.",
  },
];

const FAQS = [
  {
    q: "Does the model see my whole memory database?",
    a: "No. The model receives only the small retrieved context selected by the retrieval pipeline under your permission scope. It cannot browse or query memory directly.",
  },
  {
    q: "What if my device cannot run local inference?",
    a: "Messaging works normally, and Cloak Intelligence states precisely why local inference is unavailable — WebGPU, storage, or installation. Cloud is only ever an explicit choice.",
  },
  {
    q: "How do I know where an answer was processed?",
    a: "Every AI answer carries a processing badge: provider, model, location, whether cloud was used, and how many local memories were retrieved. The badge opens the details.",
  },
  {
    q: "Is translation also local?",
    a: "Where a local translation model is installed, yes. Translation is a separate provider with its own artifact — independent from generation.",
  },
];

export function IntelligencePage() {
  return (
    <>
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-cloak-gold-soft blur-[120px]"
        />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Cloak Intelligence
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Intelligence that lives where your conversations live.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              A local-first assistant inside the messenger: private memory,
              precise retrieval, on-device reasoning, and labeled processing —
              with cloud only as a choice you make.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <OnDeviceBadge />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-bg-elevated/80 px-2.5 py-1 text-[11px] text-cloak-text-secondary">
                <CloudOffIcon size={12} />
                Cloud off by default
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-bg-elevated/80 px-2.5 py-1 text-[11px] text-cloak-text-secondary">
                <CpuIcon size={12} />
                Gemma 4 E2B · WebGPU
              </span>
            </div>
          </div>
        </Container>
      </section>

      <section className="pb-20 md:pb-24">
        <Container>
          <SectionHeading
            eyebrow="Pipeline"
            title="Cloak AI is not your memory."
            lead="Four layers with separate responsibilities keep the assistant precise and private — the model reasons, it does not rummage. It is deliberately not a chatbot bolted onto a messenger."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {PIPELINE.map((stage, i) => (
              <Surface key={stage.title} hover className="p-6">
                <div className="flex items-center justify-between">
                  <span className="text-cloak-gold">
                    <stage.icon size={22} />
                  </span>
                  <span className="text-[10px] font-semibold tracking-widest text-cloak-text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{stage.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{stage.body}</p>
              </Surface>
            ))}
          </div>
        </Container>
      </section>

      {/* Cloud boundary (review spec §18) */}
      <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl">
            <SectionHeading
              eyebrow="Cloud boundary"
              title="Local-first — not local-only."
              lead="Local processing is the default. Cloud fallback can be disabled completely and must never occur silently."
            />
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  title: "Local-only",
                  body: "Processing never leaves the local path. Cloud fallback is fully disabled.",
                },
                {
                  title: "Ask before cloud processing",
                  body: "Cloak requests your consent first, and labels the answer with the route it used.",
                },
                {
                  title: "Allow cloud",
                  body: "Cloud processing is permitted — still labeled, still revocable at any time.",
                },
              ].map((mode) => (
                <Surface key={mode.title} className="p-6">
                  <h3 className="text-base font-medium text-cloak-text">{mode.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{mode.body}</p>
                </Surface>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* FAQ (review spec §79 — detail questions live here, not on the homepage) */}
      <section className="border-t border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl">
            <SectionHeading eyebrow="Questions" title="Detail, without the dark patterns." />
            <div className="space-y-4">
              {FAQS.map((f) => (
                <Surface key={f.q} className="p-6">
                  <h3 className="flex items-start gap-2.5 text-base font-medium text-cloak-text">
                    <ShieldCheckIcon size={17} className="mt-1 shrink-0 text-cloak-gold" />
                    {f.q}
                  </h3>
                  <p className="mt-2 pl-7 text-sm leading-relaxed text-cloak-text-secondary">{f.a}</p>
                </Surface>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <ClosingCTA />
    </>
  );
}
