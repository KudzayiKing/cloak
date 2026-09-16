"use client";

/*
 * Marketing: Pricing page (pricing & membership update spec §24-§31, §47, §60;
 * review spec §2, §24-§26, §38-§41).
 *
 * Structure: hero → PRIMARY MEMBERSHIPS (Private + Reserve) → direct
 * settlement (USDC on Solana — QR + treasury address) → Reserve grant
 * explanation + trusted-circle visual → PRIVATE ENVIRONMENTS (Private
 * Circle → Office → Sovereign) → membership philosophy → FAQ → CTA.
 *
 * Review spec §2: the display name for the $2,500 tier is "Cloaq Reserve"
 * (configurable via MEMBERSHIP_NAMES). Internal entitlement values that use
 * "black" type vocabulary is retired everywhere (owner decision, 2026-09).
 * No discounts, no countdowns, no "best value" gimmicks, no fake scarcity,
 * no emoji. Reserve treatment: restrained gold hairline, "Higher assurance"
 * label (review spec §39) — never "MOST POPULAR".
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Container,
  SectionHeading,
  Surface,
} from "@/components/cloak/shared/primitives";
import { ClosingCTA } from "./home-sections-b";
import { CLOAK_PRICING, MEMBERSHIP_NAMES, formatUSD } from "@/lib/cloak/config";
import { Button } from "@/components/ui/button";
import { navigate } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "@animateicons/react/lucide";
import { ContactRequestDialog } from "@/components/cloak/membership/dialogs";
import { UsdcCheckoutDialog } from "@/components/cloak/membership/usdc-checkout-dialog";
import type { CloakMembership } from "@/lib/cloak/types";
import {
  TREASURY_ADDRESS,
  TREASURY_QR_SRC,
  solscanAccountUrl,
} from "@/lib/cloak/payments";

const PRIVATE_INCLUDES = [
  "Cloaq messaging",
  "Private groups",
  "Join trusted Circles",
  "Cloaq ID",
  "Ghost Chats",
  "Cloaq Mode",
  "Dagger emergency device wipe",
  "Trusted devices",
  "Identity verification",
  "Cloaq AI",
  "Local memory and retrieval",
  "Core security updates",
];

const RESERVE_PLUS = [
  "10 full Cloaq Private memberships to grant",
  "Create a personal Circle",
  "Advanced Circle controls",
  "Advanced device controls",
  "Enhanced verification",
  "Priority security support",
  "Assisted secure onboarding",
  "Early access to selected security features",
];

const PRICING_FAQS: { q: string; a: string }[] = [
  {
    q: "How do I pay for Cloaq Private or Reserve?",
    a: "Individual membership can be settled directly with native USDC on Solana. Scan the QR or copy the payment details, send the exact amount, and Cloaq activates membership after the transaction is verified.",
  },
  {
    q: "Do I need a credit card?",
    a: "No card is required for USDC settlement. There is no recurring card mandate for individual membership.",
  },
  {
    q: "Does my wallet become my Cloaq identity?",
    a: "No. Payment verification and Cloaq identity are separate systems. Your paying wallet is never used as your username, profile, or login.",
  },
  {
    q: "Is USDC payment anonymous?",
    a: "No. Standard blockchain activity is public. Cloaq separates payment verification from messaging identity but does not claim blockchain payments are anonymous.",
  },
  {
    q: "Do Reserve grants need USDC?",
    a: "No. A Reserve grant gives the recipient full Cloaq Private membership without payment — no wallet, no card, nothing to buy.",
  },
  {
    q: "What about organizations?",
    a: "Private Circle, Office, and Sovereign support contact-led settlement including invoice, bank transfer, and USDC where appropriate.",
  },
  {
    q: "Is Cloaq Private a subscription?",
    a: "No. Cloaq Private is a one-time individual membership. Renewal: never.",
  },
  {
    q: "Is Cloaq Reserve a subscription?",
    a: "No. Cloaq Reserve is a one-time individual membership.",
  },
  {
    q: "What happens to the 10 Private membership grants?",
    a: "Each grant can be given to one person. Once accepted, that person receives Cloaq Private membership and the grant is permanently consumed.",
  },
  {
    q: "Can I reuse a pass after someone accepts?",
    a: "No. Redeemed passes cannot be recycled.",
  },
  {
    q: "Do Reserve recipients receive a limited account?",
    a: "No. A redeemed Reserve grant provides full Cloaq Private membership — the recipient is a full member, not a guest.",
  },
  {
    q: "Is Cloaq Office one-time?",
    a: "No. Cloaq Office is an annual organizational product because it includes ongoing administration, support, and organizational infrastructure.",
  },
  {
    q: "What does Sovereign cost?",
    a: "Cloaq Sovereign is priced according to deployment, support, integration, and infrastructure requirements.",
  },
];

export function PricingPage() {
  const [checkoutPlan, setCheckoutPlan] = useState<CloakMembership | null>(null);
  const [contactProduct, setContactProduct] = useState<
    "private_circle" | "office" | "sovereign" | null
  >(null);

  return (
    <>
      {/* ---------- Pricing hero (spec §25) ---------- */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Membership
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Membership built around assurance, not attention.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              Cloaq is designed for private communications, not advertising,
              engagement metrics, or mass-market reach. Choose the level of
              assurance and service you require.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="cloak-cta-gold h-12 border border-black/20 px-7 text-base font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => navigate("/app/messages")}
              >
                Open Cloaq
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-cloak-border-strong bg-transparent px-7 text-base text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
                onClick={() =>
                  document
                    .getElementById("memberships")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                Explore memberships
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ---------- Primary memberships (review spec §38, §39) ---------- */}
      <section id="memberships" className="scroll-mt-20 pb-4 md:pb-8">
        <Container>
          <p className="mb-5 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-text-muted">
            Primary memberships
          </p>
          <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">

            {/* Cloaq Private */}
            <Surface className="flex flex-col p-7 md:p-8">
              <h2 className="cloak-display text-2xl font-medium text-cloak-text">
                Cloaq Private
              </h2>
              <p className="mt-1 text-[13px] text-cloak-text-muted">For individuals.</p>
              <p
                className="mt-6 cloak-display text-5xl font-medium text-cloak-text"
                aria-label={`${CLOAK_PRICING.private.amount} USDC, one-time payment`}
              >
                {CLOAK_PRICING.private.amount.toLocaleString("en-US")}{" "}
                <span className="text-2xl text-cloak-text-secondary">USDC</span>
              </p>
              <p className="mt-1.5 text-[12.5px] text-cloak-text-muted">one-time</p>
              <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
                Private messaging and private on-device intelligence.
              </p>
              <ul className="mt-6 space-y-2.5 border-t border-cloak-border pt-6">
                {PRIVATE_INCLUDES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px] text-cloak-text-secondary">
                    <CheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-success" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-lg border border-cloak-border bg-cloak-surface/60 px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-cloak-text-muted">Settlement</p>
                <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-cloak-text">
                  <ShieldCheckIcon size={14} className="shrink-0 text-cloak-gold" />
                  Native USDC on Solana
                </div>
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-cloak-text-muted">
                No recurring card mandate. No ads. No behavioral tracking.
              </p>
              <div className="mt-auto pt-7">
                <Button
                  className="h-11 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310] cloak-cta-gold"
                  onClick={() => setCheckoutPlan("private")}
                >
                  Get Cloaq Private
                </Button>
              </div>
            </Surface>

            {/* Cloaq Reserve — deeper surface, restrained gold hairline
                (review spec §39: "Higher assurance", never "Best value") */}
            <div className="relative flex flex-col overflow-hidden rounded-xl border border-cloak-gold/25 bg-cloak-bg-elevated p-7 md:p-8">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cloak-gold/60 to-transparent"
              />
              <h2 className="cloak-display text-2xl font-medium tracking-wide text-cloak-text">
                {MEMBERSHIP_NAMES.reserve}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-cloak-text-muted">
                Higher assurance for individuals and the people they trust.
              </p>
              <p
                className="mt-6 cloak-display text-5xl font-medium tracking-wide text-cloak-text"
                aria-label={`${CLOAK_PRICING.reserve.amount.toLocaleString("en-US")} USDC, one-time payment`}
              >
                {CLOAK_PRICING.reserve.amount.toLocaleString("en-US")}{" "}
                <span className="text-2xl tracking-normal text-cloak-text-secondary">USDC</span>
              </p>
              <p className="mt-1.5 text-[12.5px] text-cloak-text-muted">one-time</p>
              <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
                Everything in Cloaq Private, plus:
              </p>
              <ul className="mt-4 space-y-2.5">
                {RESERVE_PLUS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px] text-cloak-text-secondary">
                    <CheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-gold" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-cloak-border pt-5 text-[12.5px] leading-relaxed text-cloak-text-secondary">
                Bring your trusted circle into Cloaq without asking each person
                to purchase membership separately.
              </p>
              <div className="mt-5 rounded-lg border border-cloak-gold/20 bg-cloak-bg/60 px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-cloak-text-muted">Settlement</p>
                <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-cloak-text">
                  <ShieldCheckIcon size={14} className="shrink-0 text-cloak-gold" />
                  Native USDC on Solana
                </div>
              </div>
              <div className="mt-auto pt-7">
                <Button
                  className="cloak-cta-gold h-11 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310]"
                  onClick={() => setCheckoutPlan("reserve")}
                >
                  Get {MEMBERSHIP_NAMES.reserve}
                </Button>
              </div>
            </div>
          </div>

          {/* ---------- Direct settlement — QR + treasury address ---------- */}
          <DirectSettlementPanel />

          {/* ---------- Organizational tiers — PRIVATE ENVIRONMENTS (review spec §39) ---------- */}
          <div className="mx-auto mt-14 max-w-4xl">
            <p className="mb-5 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-text-muted">
              Private environments
            </p>
            <SectionHeading
              eyebrow="Organizations"
              title="Beyond individual membership."
              lead="For principals, executive teams, and institutions — arranged directly with Cloaq."
            />
            <div className="grid gap-5 md:grid-cols-3">
              <OrgTierCard
                title="Cloaq Private Circle"
                forLine="For principals and their trusted personal network."
                price={`From ${formatUSD(CLOAK_PRICING.privateCircle.startingAt)}`}
                body="Structured onboarding, higher-touch support, and a private communications environment for the people closest to your work and life."
                settlement="USDC · Bank transfer · Invoice"
                onContact={() => setContactProduct("private_circle")}
              />
              <OrgTierCard
                title="Cloaq Office"
                forLine="For executive teams and high-trust organizations."
                price={`From ${formatUSD(CLOAK_PRICING.office.startingAt)}/year`}
                body="Managed identities, organizational controls, deployment support, and priority security support."
                settlement="Contract / invoice settlement. USDC where appropriate."
                onContact={() => setContactProduct("office")}
              />
              <OrgTierCard
                title="Cloaq Sovereign"
                forLine="Private infrastructure. Customer-controlled deployment."
                price="Custom pricing"
                body="For institutions requiring greater control over communications infrastructure, identity, deployment, and data locality."
                settlement="Settlement terms defined by contract."
                onContact={() => setContactProduct("sovereign")}
              />
            </div>
          </div>

          {/* ---------- Reserve grant explanation + trusted-circle visual (review spec §40) ---------- */}
          <div className="relative mx-auto mt-6 max-w-4xl overflow-hidden rounded-xl border border-cloak-border bg-cloak-surface/60 p-7 md:p-9">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-cloak-gold/50 to-transparent"
            />
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Your trusted circle, included
            </p>
            <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              {MEMBERSHIP_NAMES.reserve} includes 10 full Cloaq Private
              memberships to grant. Each redeemed grant becomes a full,
              independent Cloaq Private membership.
            </p>

            {/* Grant tree (review spec §40) */}
            <div className="mt-6 flex flex-col items-start gap-1.5 rounded-lg border border-cloak-border bg-cloak-bg/60 p-5 font-mono text-[12.5px] leading-relaxed text-cloak-text-secondary">
              <p className="font-medium text-cloak-text">Reserve Member</p>
              {Array.from({ length: 6 }).map((_, i) => (
                <p key={i} className="pl-5 text-cloak-text-muted">
                  {"├──"} Cloaq Private
                </p>
              ))}
              <p className="pl-5 text-cloak-text-muted">└── … 10 total</p>
            </div>

            <div className="mt-5 grid gap-4 text-[13px] leading-relaxed text-cloak-text-secondary md:grid-cols-2">
              <p>
                The Reserve member does not gain access to a recipient&apos;s
                messages, devices, contacts, or Cloaq AI. An
                invitation grants membership — never access, oversight, or
                control.
              </p>
              <p>
                Bring your trusted circle into Cloaq without asking each
                person to purchase membership separately. Designed for
                families, boards, and close professional teams.
              </p>
            </div>

            {/* Reserve Concierge — optional Reserve service, honest state */}
            <div className="mt-7 flex flex-col gap-3 rounded-lg border border-dashed border-cloak-border-strong bg-cloak-bg/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-cloak-text">
                  Reserve Concierge <span className="text-cloak-text-muted">— {formatUSD(CLOAK_PRICING.reserveConcierge.amount)}</span>
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-cloak-text-muted">
                  Assisted setup: devices, recovery, local intelligence, and
                  grant configuration, delivered in a secure onboarding session.
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-cloak-border px-3 py-1 text-[11px] text-cloak-text-muted sm:self-center">
                Available later
              </span>
            </div>
          </div>
        </Container>
      </section>

      {/* ---------- Membership philosophy (spec §2, §33) ---------- */}
      <section className="border-t border-cloak-border bg-cloak-bg-elevated/40 py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Membership philosophy
            </p>
            <p className="mt-6 cloak-display text-balance text-2xl font-medium leading-snug text-cloak-text md:text-3xl">
              You do not need everyone on Cloaq.
              <br />
              You need the people you trust.
            </p>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary">
              Cloaq is funded by membership, not attention. There is no ad
              model, no behavioral tracking, and no engagement machinery — the
              product is priced on assurance, service, and the number of
              trusted people it protects.
            </p>
            <p className="mt-4 text-[13px] text-cloak-text-muted">
              Private communications. For people with something to protect.
            </p>
          </div>
        </Container>
      </section>

      {/* ---------- FAQ (spec §47) ---------- */}
      <PricingFAQ />

      <ClosingCTA />

      <UsdcCheckoutDialog
        open={checkoutPlan === "private" || checkoutPlan === "reserve"}
        onOpenChange={(v) => {
          if (!v) setCheckoutPlan(null);
        }}
        plan={checkoutPlan === "reserve" ? "reserve" : "private"}
      />
      <ContactRequestDialog
        open={!!contactProduct}
        onOpenChange={(v) => !v && setContactProduct(null)}
        product={contactProduct ?? "office"}
      />
    </>
  );
}

/* ---------- Organizational tier card (all tiers visible as cards) ---------- */

function OrgTierCard({
  title,
  forLine,
  price,
  body,
  settlement,
  onContact,
}: {
  title: string;
  forLine: string;
  price: string;
  body: string;
  settlement: string;
  onContact: () => void;
}) {
  return (
    <Surface className="flex flex-col p-7">
      <h3 className="cloak-display text-xl font-medium text-cloak-text">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-cloak-text-secondary">{forLine}</p>
      <p
        className="mt-4 cloak-display text-lg font-medium text-cloak-text"
        aria-label={`${price} — arranged with the Cloaq team`}
      >
        {price}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-cloak-text-secondary">{body}</p>
      <p className="mt-4 text-[11.5px] leading-relaxed text-cloak-text-muted">
        <span className="font-medium text-cloak-text-secondary">Settlement — </span>
        {settlement}
      </p>
      <div className="mt-auto pt-6">
        <Button
          variant="outline"
          className="h-10 w-full border-cloak-border-strong bg-transparent text-[13px] text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
          onClick={onContact}
        >
          Contact Cloaq
          <ChevronRightIcon size={14} className="ml-1" />
        </Button>
      </div>
    </Surface>
  );
}

/* ---------- Direct settlement panel — public QR + treasury address ---------- */

function DirectSettlementPanel() {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    []
  );

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(TREASURY_ADDRESS);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* selection remains the accessible fallback */
    }
  };

  return (
    <div
      id="direct-settlement"
      className="relative mx-auto mt-8 max-w-4xl overflow-hidden rounded-xl border border-cloak-border bg-cloak-surface/40"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cloak-gold/50 to-transparent"
      />
      <div className="grid gap-8 p-7 md:grid-cols-[auto_1fr] md:gap-10 md:p-9">
        {/* QR — white panel for scan reliability (spec §17, §78) */}
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-white p-3">
            <Image
              src={TREASURY_QR_SRC}
              alt={`QR code for the Cloaq treasury address ${TREASURY_ADDRESS} — native USDC on Solana`}
              width={148}
              height={148}
              className="h-[148px] w-[148px]"
              unoptimized
            />
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-cloak-text-muted">
            <QrCodeIcon size={13} className="shrink-0" />
            Scan with a Solana wallet
          </div>
        </div>

        {/* Payment details */}
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
            Direct settlement
          </p>
          <h3 className="cloak-display mt-3 text-xl font-medium text-cloak-text md:text-2xl">
            Pay directly. No card required.
          </h3>
          <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-cloak-text-secondary">
            No recurring card dependency. Cloaq Private and{" "}
            {MEMBERSHIP_NAMES.reserve} can be
            acquired with native USDC on Solana — settled to the address below,
            verified on-chain, and activated after confirmation.
          </p>

          <div className="mt-5 max-w-xl">
            <p className="text-[11px] uppercase tracking-[0.18em] text-cloak-text-muted">
              Cloaq treasury · Solana
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-cloak-border bg-cloak-bg px-3.5 py-2.5">
              <code
                className="min-w-0 truncate font-mono text-[12.5px] text-cloak-text"
                title={TREASURY_ADDRESS}
              >
                {TREASURY_ADDRESS}
              </code>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={copyAddress}
                  aria-label="Copy treasury address"
                  className="grid h-8 w-8 place-items-center rounded-md border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold"
                >
                  {copied ? (
                    <CheckIcon size={14} className="text-cloak-success" />
                  ) : (
                    <CopyIcon size={14} />
                  )}
                </button>
                <a
                  href={solscanAccountUrl(TREASURY_ADDRESS)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View the treasury on Solscan"
                  title="View on Solscan"
                  className="grid h-8 w-8 place-items-center rounded-md border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold"
                >
                  <ExternalLinkIcon size={14} />
                </a>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
              <div className="rounded-lg border border-cloak-border bg-cloak-bg px-3.5 py-2.5">
                <p className="text-cloak-text-muted">Cloaq Private</p>
                <p className="mt-0.5 font-medium text-cloak-text">499 USDC · one-time</p>
              </div>
              <div className="rounded-lg border border-cloak-border bg-cloak-bg px-3.5 py-2.5">
                <p className="text-cloak-text-muted">{MEMBERSHIP_NAMES.reserve}</p>
                <p className="mt-0.5 font-medium text-cloak-text">2,500 USDC · one-time</p>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-cloak-text-muted">
              <TriangleAlertIcon size={13} className="mt-0.5 shrink-0 text-cloak-warning" />
              Send native USDC on Solana only. Sending another asset or using the
              wrong network may result in loss of funds.
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[12px] text-cloak-text-secondary">
              <ShieldCheckIcon size={13} className="shrink-0 text-cloak-gold" />
              Your payment wallet does not become your Cloaq identity.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Pricing FAQ ---------- */

function PricingFAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="border-t border-cloak-border py-16 md:py-24">
      <Container>
        <div className="mx-auto max-w-3xl">
          <SectionHeading eyebrow="Questions" title="Membership, answered plainly." />
          <div className="divide-y divide-cloak-border rounded-xl border border-cloak-border bg-cloak-surface/40">
            {PRICING_FAQS.map((item, i) => {
              const isOpen = open === i;
              return (
                <div key={item.q}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-cloak-surface"
                  >
                    <span className="text-sm font-medium text-cloak-text md:text-base">{item.q}</span>
                    <ChevronRightIcon
                      size={15}
                      className={cn(
                        "shrink-0 text-cloak-text-muted transition-transform duration-200",
                        isOpen && "rotate-90"
                      )}
                    />
                  </button>
                  {isOpen && (
                    <p className="cloak-message-in px-5 pb-5 text-sm leading-relaxed text-cloak-text-secondary">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
