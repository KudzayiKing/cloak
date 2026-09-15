"use client";

/*
 * Marketing: About page (review spec §50, §51, §52, §36).
 * Company legitimacy for sophisticated buyers — mission, security
 * philosophy, and an accountable way to make contact. Legal entity
 * details are populated only when real; nothing is invented.
 */

import { useState } from "react";
import {
  Container,
  SectionHeading,
  Surface,
} from "@/components/cloak/shared/primitives";
import { ClosingCTA } from "./home-sections-b";
import { ContactRequestDialog } from "@/components/cloak/membership/dialogs";
import { Button } from "@/components/ui/button";
import { navigate } from "@/hooks/use-hash-route";
import {
  ShieldCheckIcon,
  ScanLineIcon,
  EyeOffIcon,
} from "@animateicons/react/lucide";

const PHILOSOPHY = [
  {
    icon: ScanLineIcon,
    title: "Claims must be inspectable",
    body: "Security is communicated as precise, verifiable states — never slogans. If a protection cannot be shown, it is not claimed.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Boundaries are explicit",
    body: "The product states what it protects, what it does not, and where processing happens — locally or in the cloud.",
  },
  {
    icon: EyeOffIcon,
    title: "No attention economy",
    body: "Cloaq is funded by membership, not advertising. There is no engagement machinery because there is no ad model to feed.",
  },
];

export function AboutPage() {
  const [briefingOpen, setBriefingOpen] = useState(false);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              About
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Private communications. Private intelligence.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              Cloaq is built for conversations where exposure has consequences
              — messaging and on-device intelligence designed to remain under
              your control.
            </p>
          </div>
        </Container>
      </section>

      {/* Mission */}
      <section className="pb-20 md:pb-24">
        <Container>
          <div className="mx-auto max-w-3xl">
            <SectionHeading eyebrow="Mission" title="Why Cloaq exists." />
            <div className="space-y-4 text-base leading-relaxed text-cloak-text-secondary">
              <p>
                Most communication tools are optimized for reach and attention.
                A small group of professionals — executives, family offices,
                legal teams, journalists, security teams — needs the opposite:
                a messenger that reveals less, organizes trust deliberately,
                and keeps intelligence on the device where the conversations
                already live.
              </p>
              <p>
                Cloaq exists to build that product to a standard its users can
                inspect: private messaging without a public identity graph,
                local-first intelligence without default cloud exposure, and
                membership without recurring card dependency.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Security philosophy */}
      <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <SectionHeading eyebrow="Security philosophy" title="How Cloaq makes decisions." />
          <div className="grid gap-4 md:grid-cols-3">
            {PHILOSOPHY.map((p) => (
              <Surface key={p.title} className="p-6">
                <span className="text-cloak-gold">
                  <p.icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{p.body}</p>
              </Surface>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-cloak-text-muted">
            The security architecture and threat model are published on the
            Security page, and the audit status is kept current there.
          </p>
        </Container>
      </section>

      {/* Company + contact */}
      <section className="py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl">
            <SectionHeading
              eyebrow="Company"
              title="An accountable point of contact."
              lead="A security product should be easy to verify and easy to reach."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Company details</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Cloaq is operated as a private-launch product. Legal,
                  billing, and company-verification requests are handled
                  directly through the onboarding or purchase channel used for
                  the account.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Security contact</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Responsible-disclosure reports should use the private launch
                  contact channel and include the affected route, impact, and
                  safe reproduction notes. The current disclosure policy is on
                  the Security page.
                </p>
              </Surface>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="cloak-cta-gold h-12 border border-black/20 px-7 text-base font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => setBriefingOpen(true)}
              >
                Request a private briefing
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-cloak-border-strong bg-transparent px-7 text-base text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
                onClick={() => navigate("/security")}
              >
                Explore Security
              </Button>
            </div>
            <p className="mt-5 text-center text-[11.5px] text-cloak-text-muted">
              Do not include confidential information in this form.
            </p>
          </div>
        </Container>
      </section>

      <ClosingCTA />

      <ContactRequestDialog
        open={briefingOpen}
        onOpenChange={(v) => {
          if (!v) setBriefingOpen(false);
        }}
        product="briefing"
      />
    </>
  );
}
