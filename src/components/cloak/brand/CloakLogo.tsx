"use client";

import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";

/*
 * CloakLogo — the wordmark is set in EB Garamond (user requirement).
 * The mark is always the white C artwork (user feedback: never the
 * legacy gold arc) — used in web headers, the splash screen, and the
 * PWA icon. CloakMark remains exported for gold AI accents only.
 */

export function CloakMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M 356 148 A 148 148 0 1 0 356 364"
        stroke="currentColor"
        strokeWidth="52"
        strokeLinecap="round"
      />
      <circle cx="356" cy="256" r="34" fill="currentColor" />
    </svg>
  );
}

/* The new Cloak logo artwork (user-created, served from /cloak-logo.svg). */
export function CloakLogoImage({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/cloak-logo.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function CloakLogo({
  size = "md",
  withMark = true,
  markClassName,
  className,
  onClick,
}: {
  size?: "sm" | "md" | "lg";
  withMark?: boolean;
  /** Extra classes for the mark wrapper (e.g. hide the mark on mobile). */
  markClassName?: string;
  className?: string;
  onClick?: () => void;
}) {
  /* sm and md are both 3xl (user feedback rounds 4/6); lg is display size. */
  const textClass = size === "lg" ? "text-4xl md:text-5xl" : "text-3xl";

  return (
    <button
      type="button"
      onClick={onClick ?? (() => navigate("/"))}
      aria-label="Cloak — home"
      className={cn(
        "inline-flex items-center gap-2.5 text-cloak-text transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-cloak-gold/70 rounded-sm",
        className
      )}
    >
      {withMark && (
        <span className={cn("inline-flex items-center", markClassName)}>
          <CloakLogoImage size={size === "lg" ? 34 : 28} />
        </span>
      )}
      <span
        className={cn("cloak-wordmark text-cloak-text leading-none pb-0.5", textClass)}
      >
        Cloak
      </span>
    </button>
  );
}
