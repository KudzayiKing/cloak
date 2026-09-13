"use client";

/*
 * Hero (spec §9) — visually striking without being noisy.
 */

import { ProductMockup } from "./product-mockup";
import { PrimaryCTA, SecondaryCTA } from "@/components/cloak/shared/primitives";
import { navigate } from "@/hooks/use-hash-route";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-24">
      {/* Vault atmosphere */}
      <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-cloak-gold-soft blur-[120px]"
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-cloak-border bg-cloak-bg-elevated/70 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-secondary backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-cloak-gold" />
            Security-first private messaging
          </p>
          <h1 className="cloak-display text-balance text-[2.6rem] font-medium leading-[1.08] tracking-tight text-cloak-text md:text-6xl">
            Private conversations.
            <br />
            <span className="text-cloak-gold">Private intelligence.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
            Secure messaging and on-device intelligence for conversations that
            should remain under your control.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <PrimaryCTA size="lg" />
            <SecondaryCTA to="/security">Explore security</SecondaryCTA>
          </div>
        </div>

        <div className="mt-14 md:mt-20">
          <ProductMockup className="mx-auto max-w-4xl" />
        </div>
      </div>
    </section>
  );
}
