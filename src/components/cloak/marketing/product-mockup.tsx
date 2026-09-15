"use client";

/*
 * Interactive Cloak product mockup (spec §9-Hero).
 * Built with CSS/React — no screenshots, no stock photography.
 * Shows: conversation sidebar, encrypted conversation, Cloaq Intelligence
 * answer, on-device processing status, security state, restrained gold.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CloakLogoImage, CloakMark } from "@/components/cloak/brand/CloakLogo";
import {
  SearchIcon,
  ShieldCheckIcon,
  LockIcon,
  CpuIcon,
  CheckCheckIcon,
  EllipsisIcon,
} from "@animateicons/react/lucide";
import { Ghost } from "lucide-react";

const SIDEBAR_ITEMS = [
  { name: "Sarah Ahmed", preview: "On it. I will confirm once…", time: "14:32", verified: true, active: true },
  { name: "Daniel Reed", preview: "Ghost · 58m left", time: "13:05", ghost: true },
  { name: "Legal — revised terms", preview: "Maya: Comments by Wednesday", time: "Mon", group: true, muted: true },
  { name: "Maya Chen", preview: "I will send my notes this…", time: "Mon" },
];

export function ProductMockup({ className }: { className?: string }) {
  const [stage, setStage] = useState(0);

  /* One quiet loop: message arrives -> Cloaq Intelligence answers. */
  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 1800),
      window.setTimeout(() => setStage(2), 3600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      className={cn(
        "relative w-full max-w-full overflow-hidden rounded-2xl border border-cloak-border-strong bg-cloak-bg-elevated shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]",
        className
      )}
      role="img"
      aria-label="Cloaq application preview showing an encrypted conversation and a Cloaq Intelligence answer processed on-device"
    >
      {/* Window chrome */}
      <div className="flex items-center justify-between border-b border-cloak-border bg-cloak-bg/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <CloakLogoImage size={14} />
          <span className="cloak-wordmark text-[11px] text-cloak-text-secondary">Cloaq</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-surface px-2 py-0.5 text-[10px] text-cloak-text-secondary">
            <LockIcon size={10} className="text-cloak-success" />
            End-to-end encrypted
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] md:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="hidden flex-col gap-0.5 border-r border-cloak-border bg-cloak-bg/50 p-2.5 sm:flex">
          <div className="mb-2 flex items-center gap-2 rounded-full border border-cloak-border bg-cloak-surface px-3 py-1.5 text-[11px] text-cloak-text-muted">
            <SearchIcon size={12} />
            Search
          </div>
          {SIDEBAR_ITEMS.map((item) => (
            <div
              key={item.name}
              className={cn(
                "rounded-lg px-2.5 py-2",
                item.active ? "bg-cloak-gold-soft/60" : "hover:bg-cloak-surface"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-cloak-text">
                  {item.name}
                  {item.verified && <ShieldCheckIcon size={11} className="text-cloak-gold" />}
                </span>
                <span className="text-[9px] text-cloak-text-muted">{item.time}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-cloak-text-muted">
                {item.ghost && <Ghost size={10} color="#ffffff" className="shrink-0" />}
                {item.muted && <span className="rounded-sm bg-cloak-surface px-1 text-[8px]">muted</span>}
                <span className="truncate">{item.preview}</span>
              </div>
            </div>
          ))}
          <div className="mt-auto rounded-lg border border-cloak-border bg-cloak-surface/60 p-2.5">
            {/* Review spec §8/§9: labeled example state, no absolute claims. */}
            <div className="text-[9px] uppercase tracking-[0.14em] text-cloak-text-muted">
              Example security status
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium text-cloak-success">
              <span className="cloak-pulse-once inline-block h-1.5 w-1.5 rounded-full bg-cloak-success" />
              Security status — no action required
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-cloak-text-muted">
              <CpuIcon size={10} className="text-cloak-gold" />
              AI on-device · cloud off
            </div>
          </div>
        </aside>

        {/* Conversation */}
        <div className="relative flex min-h-[420px] flex-col sm:min-h-[380px] md:min-h-[440px]">
          <div className="flex items-center justify-between border-b border-cloak-border px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-cloak-gold-soft text-[10px] font-semibold text-cloak-gold">
                SA
              </span>
              <div>
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-cloak-text">
                  Sarah Ahmed
                  <ShieldCheckIcon size={11} className="text-cloak-gold" />
                </div>
                <div className="text-[9px] text-cloak-text-muted">@sarah.8K2 · verified</div>
              </div>
            </div>
            <EllipsisIcon size={14} className="text-cloak-text-muted" />
          </div>

          <div className="flex-1 space-y-2.5 p-3 sm:p-4">
            {/* Review spec §15: professional, consequence-focused sample
                conversation — legal, executive, and security context. */}
            <Bubble side="in" text="The revised terms are acceptable with the two amendments we discussed." time="14:29" />
            <Bubble side="out" text="Keep this between us until the board receives the final version." time="14:30" />
            <Bubble side="in" text="Security moved tomorrow's arrival window to 08:30. Use the updated itinerary." time="14:31" />

            {/* Cloaq Intelligence answer */}
            <div
              className={cn(
                "max-w-[92%] rounded-xl border border-cloak-gold/20 bg-cloak-gold-soft/50 p-3 transition-all duration-500 sm:max-w-[85%]",
                stage >= 2 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-cloak-gold">
                  <CloakMark size={11} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cloak-gold">
                  Cloaq Intelligence
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-cloak-text">
                Tomorrow&apos;s arrival window changed to 08:30. The final board
                version is still confidential.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-cloak-gold/25 bg-cloak-bg px-2 py-0.5 text-[9px] text-cloak-gold-bright">
                  <CpuIcon size={9} />
                  On-device
                </span>
                <span className="rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[9px] text-cloak-text-muted">
                  2 memories used
                </span>
                <span className="rounded-full border border-cloak-border bg-cloak-bg px-2 py-0.5 text-[9px] text-cloak-text-muted">
                  Cloud not used
                </span>
              </div>
            </div>

            {/* Live incoming message */}
            <div
              className={cn(
                "max-w-[80%] rounded-xl rounded-tl-sm border border-cloak-border bg-cloak-surface px-3.5 py-2.5 transition-all duration-500",
                stage >= 1 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              )}
            >
              <p className="text-[12px] leading-relaxed text-cloak-text">
                Understood. Legal has the amended draft now.
              </p>
              <span className="mt-1 block text-right text-[9px] text-cloak-text-muted">14:32</span>
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-cloak-border p-3">
            <div className="flex items-center gap-2 rounded-xl border border-cloak-border bg-cloak-surface px-3.5 py-2.5">
              <span className="text-[12px] text-cloak-text-muted">Write a message</span>
              <span className="ml-auto rounded-md border border-cloak-gold/25 bg-cloak-gold-soft px-1.5 py-0.5 text-[9px] font-medium text-cloak-gold-bright">
                @Cloaq
              </span>
              <CheckCheckIcon size={13} className="text-cloak-gold" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  text,
  time,
}: {
  side: "in" | "out";
  text: string;
  time: string;
}) {
  return (
    <div className={cn("flex", side === "out" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] px-3.5 py-2.5",
          side === "out"
            ? "rounded-xl rounded-tr-sm border border-cloak-gold/15 bg-[#1D1A12] text-cloak-text"
            : "rounded-xl rounded-tl-sm border border-cloak-border bg-cloak-surface text-cloak-text"
        )}
      >
        <p className="text-[12px] leading-relaxed">{text}</p>
        <span className="mt-1 block text-right text-[9px] text-cloak-text-muted">{time}</span>
      </div>
    </div>
  );
}
