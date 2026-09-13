"use client";

/*
 * Marketing: Adviser page (review spec §33, §34, §36).
 * A private invitation to evaluate Cloak — evaluation and credibility,
 * not an affiliate scheme. Shared directly with the adviser shortlist;
 * not part of the main navigation.
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
  TriangleAlertIcon,
  ChevronRightIcon,
  FileSearchIcon,
  LockIcon,
  CpuIcon,
  MonitorSmartphoneIcon,
} from "@animateicons/react/lucide";

const EVALUATION_AREAS = [
  {
    icon: LockIcon,
    title: "Messaging",
    body: "End-to-end encryption, Cloak IDs, trusted devices, and Ghost Chats in daily use.",
  },
  {
    icon: FileSearchIcon,
    title: "Threat model & Security Centre",
    body: "Whether the published model and the in-app security states are honest and complete.",
  },
  {
    icon: CpuIcon,
    title: "Local-first intelligence",
    body: "How the local AI path behaves, where its boundaries sit, and how cloud fallback is gated.",
  },
  {
    icon: MonitorSmartphoneIcon,
    title: "Operational fit",
    body: "How Cloak performs under the communication patterns of real principals and teams.",
  },
];

export function AdvisersPage() {
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Advisers
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              A private invitation to evaluate Cloak.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              Cloak is inviting a small group of cybersecurity, family-office,
              privacy, legal, and executive-protection professionals to
              evaluate Cloak Private.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="cloak-cta-gold h-12 border border-black/20 px-7 text-base font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => setRequestOpen(true)}
              >
                Request Adviser Access
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
          </div>
        </Container>
      </section>

      {/* No obligation */}
      <section className="pb-4">
        <Container>
          <div className="mx-auto flex max-w-3xl items-start gap-3.5 rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft/30 px-6 py-5">
            <ShieldCheckIcon size={18} className="mt-0.5 shrink-0 text-cloak-gold" />
            <p className="text-sm leading-relaxed text-cloak-text-secondary">
              There is no obligation to recommend Cloak. We want informed
              criticism before endorsement.
            </p>
          </div>
        </Container>
      </section>

      {/* Evaluation areas */}
      <section className="py-20 md:py-24">
        <Container>
          <SectionHeading
            eyebrow="Evaluation"
            title="What advisers are asked to evaluate."
            lead="Access to Cloak Private for hands-on use, with direct contact to the team building it."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {EVALUATION_AREAS.map((area) => (
              <Surface key={area.title} hover className="p-6">
                <span className="text-cloak-gold">
                  <area.icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{area.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{area.body}</p>
              </Surface>
            ))}
          </div>

          {/* What this is not (review spec §34) */}
          <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-cloak-border bg-cloak-bg-elevated/40 p-6">
            <h3 className="flex items-center gap-2.5 text-base font-medium text-cloak-text">
              <TriangleAlertIcon size={17} className="text-cloak-warning" />
              What this program is not
            </h3>
            <p className="mt-2.5 text-sm leading-relaxed text-cloak-text-secondary">
              There are no commissions, referral fees, or affiliate tiers in
              the adviser program. It exists for evaluation, credibility, and
              feedback. Commercial partner arrangements are handled separately
              through the partner route.
            </p>
          </div>
        </Container>
      </section>

      {/* Private briefing */}
      <section className="pb-16 md:pb-20">
        <Container>
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-xl border border-cloak-border bg-cloak-surface/50 px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h2 className="cloak-display text-xl font-medium text-cloak-text">
                Prefer a conversation first?
              </h2>
              <p className="mt-1.5 text-sm text-cloak-text-secondary">
                Request a private briefing before deciding to evaluate.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-11 shrink-0 border-cloak-border-strong bg-transparent px-5 text-sm text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
              onClick={() => setRequestOpen(true)}
            >
              Request a private briefing
              <ChevronRightIcon size={14} className="ml-1" />
            </Button>
          </div>
        </Container>
      </section>

      <ClosingCTA />

      <ContactRequestDialog
        open={requestOpen}
        onOpenChange={(v) => {
          if (!v) setRequestOpen(false);
        }}
        product="adviser"
      />
    </>
  );
}
