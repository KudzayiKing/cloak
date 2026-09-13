"use client";

/*
 * Shared Cloak primitives — surfaces, badges, CTAs.
 * One visual language across marketing and app (spec §8).
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate } from "@/hooks/use-hash-route";
import type { ProtectionState } from "@/lib/cloak/types";
import { ShieldCheckIcon, CloudIcon, CpuIcon } from "@animateicons/react/lucide";
import type { ReactNode } from "react";

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 md:px-8", className)}>
      {children}
    </div>
  );
}

export function Surface({
  children,
  className,
  hover = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-xl border border-cloak-border bg-cloak-surface",
        hover && "transition-colors hover:border-cloak-border-strong hover:bg-cloak-surface-hover",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PrimaryCTA({
  children = "Open Cloak",
  to = "/app/messages",
  size = "default",
  className,
}: {
  children?: ReactNode;
  to?: string;
  size?: "default" | "lg" | "sm";
  className?: string;
}) {
  return (
    <Button
      size={size}
      className={cn(
        "cloak-cta-gold border border-black/20 font-medium text-[#141310] shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-12px_rgba(214,177,94,0.55)] hover:text-[#141310] focus-visible:ring-cloak-gold/60",
        size === "lg" && "h-12 px-7 text-base",
        className
      )}
      onClick={() => navigate(to)}
    >
      {children}
    </Button>
  );
}

export function SecondaryCTA({
  children,
  to,
  className,
}: {
  children: ReactNode;
  to: string;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      className={cn(
        "h-12 border-cloak-border-strong bg-transparent px-7 text-base text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text",
        className
      )}
      onClick={() => navigate(to)}
    >
      {children}
    </Button>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  serif = true,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: "center" | "left";
  serif?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-10 md:mb-14",
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"
      )}
    >
      {eyebrow && (
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "text-balance text-3xl font-semibold leading-tight tracking-tight text-cloak-text md:text-[2.6rem] md:leading-[1.15]",
          serif && "cloak-display"
        )}
      >
        {title}
      </h2>
      {lead && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
          {lead}
        </p>
      )}
    </div>
  );
}

/* Security badges (spec §38) */

const PROTECTION_STYLES: Record<ProtectionState, { dot: string; text: string; label: string }> = {
  protected: { dot: "bg-cloak-success", text: "text-cloak-success", label: "Protected" },
  attention: { dot: "bg-cloak-warning", text: "text-cloak-warning", label: "Attention" },
  disabled: { dot: "bg-cloak-text-muted", text: "text-cloak-text-muted", label: "Disabled" },
  unavailable: { dot: "bg-cloak-text-muted", text: "text-cloak-text-muted", label: "Unavailable" },
  "not-configured": { dot: "bg-cloak-warning", text: "text-cloak-warning", label: "Not configured" },
};

export function ProtectionDot({ state, className }: { state: ProtectionState; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-1.5 w-1.5 rounded-full", PROTECTION_STYLES[state].dot, className)}
    />
  );
}

export function SecurityBadge({
  state = "protected",
  label,
  className,
}: {
  state?: ProtectionState;
  label?: string;
  className?: string;
}) {
  const style = PROTECTION_STYLES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-bg-elevated/80 px-2.5 py-1 text-[11px] font-medium",
        style.text,
        className
      )}
    >
      <ProtectionDot state={state} />
      {label ?? style.label}
    </span>
  );
}

export function OnDeviceBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-cloak-gold/25 bg-cloak-gold-soft px-2.5 py-1 text-[11px] font-medium text-cloak-gold-bright",
        className
      )}
    >
      <CpuIcon size={12} />
      {compact ? "On-device" : "Processed on-device"}
    </span>
  );
}

export function CloudBadge({ used, className }: { used: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        used
          ? "border-cloak-warning/30 bg-cloak-warning/10 text-cloak-warning"
          : "border-cloak-border bg-cloak-bg-elevated/80 text-cloak-text-secondary",
        className
      )}
    >
      <CloudIcon size={12} />
      {used ? "Cloud used" : "Cloud not used"}
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-cloak-gold/25 bg-cloak-gold-soft px-2.5 py-0.5 text-[11px] font-medium text-cloak-gold-bright",
        className
      )}
    >
      <ShieldCheckIcon size={12} />
      Verified
    </span>
  );
}
