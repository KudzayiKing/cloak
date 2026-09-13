"use client";

/*
 * Marketing: Partner page (review spec §35, §36).
 * Relationship-led — for organizations already trusted to protect people,
 * information, and private operations. Not self-serve affiliate marketing.
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
import { ChevronRightIcon, ShieldUserIcon, HouseIcon, UserRoundCheckIcon, GlobeLockIcon } from "@animateicons/react/lucide";

const PARTNER_PROFILES = [
  {
    icon: ShieldUserIcon,
    title: "Executive-protection firms",
    body: "Communication layers that belong inside the protection plan, not alongside it.",
  },
  {
    icon: HouseIcon,
    title: "Family-office technology firms",
    body: "Private messaging and Circles that respect the operating model of the office.",
  },
  {
    icon: UserRoundCheckIcon,
    title: "Private-client advisers",
    body: "A credible recommendation for clients whose communications carry real exposure.",
  },
  {
    icon: GlobeLockIcon,
    title: "Security consultancies & MSSPs",
    body: "Deployments where controlled membership and explicit AI boundaries matter.",
  },
];

export function PartnersPage() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Partners
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Cloak Partners
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              For organizations already trusted to protect people, information,
              and private operations.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="cloak-cta-gold h-12 border border-black/20 px-7 text-base font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => setContactOpen(true)}
              >
                Discuss a partnership
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* Partner profiles */}
      <section className="py-20 md:py-24">
        <Container>
          <SectionHeading
            eyebrow="Who it is for"
            title="Partnerships arranged directly."
            lead="Partnerships are relationship-led, not self-serve. If your organization advises or protects principals, we should talk."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {PARTNER_PROFILES.map((p) => (
              <Surface key={p.title} hover className="p-6">
                <span className="text-cloak-gold">
                  <p.icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{p.body}</p>
              </Surface>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-cloak-text-muted">
            Cloak does not run a public reseller program. Commercial terms,
            deployment scope, and support boundaries are agreed directly with
            the Cloak team.
          </p>
        </Container>
      </section>

      <ClosingCTA />

      <ContactRequestDialog
        open={contactOpen}
        onOpenChange={(v) => {
          if (!v) setContactOpen(false);
        }}
        product="partner"
      />
    </>
  );
}
