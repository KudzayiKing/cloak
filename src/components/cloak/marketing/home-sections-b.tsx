"use client";

/*
 * Home sections (review spec §6, §8-§9, §21-§25, §27, §32, §42-§43, §46-§48,
 * §54, §76, §78): security evidence + Security Centre preview, identity,
 * Ghost Chats, membership (two primary cards + organizational strip),
 * PWA install, short FAQ, closing CTA.
 */

import { useState } from "react";
import {
  Container,
  SectionHeading,
  Surface,
} from "@/components/cloak/shared/primitives";
import { InstallPWAButton } from "@/components/cloak/pwa/install-pwa-button";
import { Button } from "@/components/ui/button";
import { UsdcCheckoutDialog } from "@/components/cloak/membership/usdc-checkout-dialog";
import { ContactRequestDialog } from "@/components/cloak/membership/dialogs";
import { CLOAK_PRICING, BRAND, formatUSD } from "@/lib/cloak/config";
import { cn } from "@/lib/utils";
import { navigate, navigateToSection } from "@/hooks/use-hash-route";
import {
  UserRoundCheckIcon,
  QrCodeIcon,
  MonitorSmartphoneIcon,
  TimerIcon,
  EyeOffIcon,
  BrainIcon,
  LockIcon,
  PackageIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
  FileTextIcon,
  FileSearchIcon,
  ClipboardIcon,
} from "@animateicons/react/lucide";
import type { ReactNode } from "react";

/* A. Security evidence + Security Centre preview (review spec §6, §8, §32, §42, §43, §54) */

const EVIDENCE_CARDS = [
  {
    icon: FileSearchIcon,
    title: "Threat model",
    body: "What Cloaq protects against — and what it does not.",
    path: "/security",
    anchor: "threat-model",
  },
  {
    icon: LockIcon,
    title: "Encryption",
    body: "How message and device protection works.",
    path: "/security",
    anchor: "encryption",
  },
  {
    icon: BrainIcon,
    title: "Cloaq AI",
    body: "What stays local and when cloud processing can occur.",
    path: "/intelligence",
    anchor: undefined,
  },
  {
    icon: ClipboardIcon,
    title: "Security reviews",
    body: "Independent assessments and current audit status.",
    path: "/security",
    anchor: "audit",
  },
  {
    icon: FileTextIcon,
    title: "Responsible disclosure",
    body: "How security researchers can report vulnerabilities.",
    path: "/security",
    anchor: "disclosure",
  },
];

const TRUST_STATUS = [
  { label: "Security architecture", value: "Published" },
  { label: "Threat model", value: "Published" },
  { label: "Independent review", value: "Planned" },
  { label: "Responsible disclosure", value: "Open" },
];

/* Stateful, measurable rows (review spec §54) — values the product can
   genuinely determine. Labeled as a preview (review spec §8). */
const SECURITY_PREVIEW_ROWS: { label: string; value: string; tone: "ok" | "muted" }[] = [
  { label: "Messages", value: "End-to-end encrypted", tone: "ok" },
  { label: "Identity", value: "Verified", tone: "ok" },
  { label: "Devices", value: "2 trusted", tone: "ok" },
  { label: "AI processing", value: "On-device", tone: "ok" },
  { label: "Cloud fallback", value: "Off", tone: "muted" },
  { label: "Circle membership", value: "Invite-only", tone: "ok" },
  { label: "Open Circle invites", value: "0", tone: "muted" },
];

export function SecurityEvidenceSection() {
  return (
    <section className="py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Trust"
          title="Security should be inspectable."
          lead="Cloaq does not ask you to trust a slogan. Its security model, processing boundaries, and known limitations are clear enough to inspect."
        />

        <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_1fr]">
          {/* Evidence cards + factual trust status */}
          <div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {EVIDENCE_CARDS.map((card) => (
                <li key={card.title} className={cn(card.title === "Responsible disclosure" && "sm:col-span-2")}>
                  <button
                    onClick={() =>
                      card.anchor
                        ? navigateToSection(card.path, card.anchor)
                        : navigate(card.path)
                    }
                    className="group flex h-full w-full items-start gap-3.5 rounded-xl border border-cloak-border bg-cloak-surface p-5 text-left transition-colors hover:border-cloak-border-strong hover:bg-cloak-surface-hover"
                  >
                    <span className="mt-0.5 text-cloak-gold">
                      <card.icon size={20} />
                    </span>
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium text-cloak-text">
                        {card.title}
                        <ChevronRightIcon
                          size={13}
                          className="text-cloak-text-muted transition-transform duration-200 group-hover:translate-x-0.5"
                        />
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-cloak-text-secondary">
                        {card.body}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Factual trust status, not decorative badges (review spec §32) */}
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {TRUST_STATUS.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-2.5"
                >
                  <span className="text-[13px] text-cloak-text-secondary">{item.label}</span>
                  <span className="text-[12px] font-medium text-cloak-text">{item.value}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Security Centre preview */}
          <Surface className="overflow-hidden">
            <div className="border-b border-cloak-border bg-cloak-bg/50 px-6 py-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                Security Centre preview — example state
              </p>
              <h3 className="cloak-display mt-1.5 text-xl font-medium text-cloak-text">
                See your actual security state.
              </h3>
            </div>
            <ul>
              {SECURITY_PREVIEW_ROWS.map((row) => (
                <li
                  key={row.label}
                  className="flex items-center justify-between border-b border-cloak-border px-6 py-3 last:border-0"
                >
                  <span className="text-sm text-cloak-text-secondary">{row.label}</span>
                  <span className="flex items-center gap-2 text-sm font-medium text-cloak-text">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        row.tone === "ok" ? "bg-cloak-success" : "bg-cloak-text-muted"
                      )}
                    />
                    {row.value}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-cloak-border bg-cloak-bg/50 px-6 py-3.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
              Devices, identities, AI processing, cloud fallback, recovery, and
              conversation policy in one place. Cloak shows the state it can
              verify instead of implying protection it cannot measure.
            </p>
          </Surface>
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={() => navigate("/security")}
            className="inline-flex items-center gap-2 rounded-lg border border-cloak-border-strong bg-cloak-surface px-5 py-3 text-sm font-medium text-cloak-text transition-colors hover:bg-cloak-surface-hover"
          >
            <ShieldCheckIcon size={15} className="text-cloak-gold" />
            Explore Security
            <ChevronRightIcon size={14} />
          </button>
        </div>
      </Container>
    </section>
  );
}

/* B. Identity (review spec §47, §48) --------------------------------------- */

const IDENTITY_FEATURES: { icon: typeof QrCodeIcon; title: string; body: string }[] = [
  { icon: UserRoundCheckIcon, title: "Cloaq ID", body: "Share a private identifier instead of publishing a phone number." },
  { icon: QrCodeIcon, title: "Verify", body: "Confirm identity in person using QR verification." },
  { icon: MonitorSmartphoneIcon, title: "Devices", body: "See and revoke every authorized device." },
];

export function IdentitySection() {
  return (
    <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Identity"
          title="Control who knows you and which devices you trust."
          lead="No public phone-number identity. Cloaq IDs, explicit verification, and device control keep the edges of your network deliberate."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {IDENTITY_FEATURES.map((f, i) => (
            <Surface key={f.title} hover className="relative p-6">
              <span className="absolute right-5 top-5 text-[10px] font-semibold tracking-widest text-cloak-text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-cloak-gold">
                <f.icon size={22} />
              </span>
              <h3 className="mt-4 text-base font-medium text-cloak-text">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{f.body}</p>
            </Surface>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* C. Ghost Chats — compact (review spec §21, §20, §46) ---------------------- */

const GHOST_FEATURES: { icon: typeof TimerIcon; title: string; body: string }[] = [
  { icon: TimerIcon, title: "Timers you choose", body: "Conversations are configured to disappear from Cloaq after the period you set." },
  { icon: EyeOffIcon, title: "View-once media", body: "View-once media can be opened once inside Cloaq." },
  { icon: BrainIcon, title: "No AI memory by default", body: "Ghost Chats are excluded from Cloaq AI memory unless you allow it." },
  { icon: LockIcon, title: "Local retention controls", body: "History rules live on your device and follow your settings." },
];

export function GhostChatsSection() {
  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Ghost Chats"
              title="Some conversations should disappear."
              lead="Set conversations to disappear automatically after the period you choose — with a quiet clock rather than theatrics."
            />
            <ul className="grid gap-4 sm:grid-cols-2">
              {GHOST_FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-cloak-gold">
                    <f.icon size={18} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-cloak-text">{f.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-cloak-text-secondary">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Ghost chat visual */}
          <Surface className="p-5">
            <div className="mb-3 flex items-center justify-between border-b border-dashed border-cloak-border-strong pb-3">
              <span className="text-sm font-medium text-cloak-text">Daniel Reed</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-cloak-warning/40 px-2.5 py-1 text-[11px] text-cloak-warning">
                <TimerIcon size={11} />
                Ghost · 58m left
              </span>
            </div>
            <div className="space-y-2.5 opacity-95">
              <div className="max-w-[80%] rounded-xl rounded-tl-sm border border-dashed border-cloak-border bg-cloak-surface px-3.5 py-2.5">
                <p className="text-[12px] leading-relaxed text-cloak-text">
                  Draft summary attached. View it once, then decide.
                </p>
              </div>
              <div className="flex max-w-[80%] items-center gap-3 rounded-xl rounded-tl-sm border border-dashed border-cloak-border bg-cloak-surface px-3.5 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-cloak-gold-soft text-cloak-gold">
                  <EyeOffIcon size={15} />
                </span>
                <div>
                  <p className="text-[12px] font-medium text-cloak-text">draft-summary-v3.pdf</p>
                  <p className="text-[10px] text-cloak-text-muted">View once · 244 KB</p>
                </div>
              </div>
              <p className="pt-1 text-center text-[10px] text-cloak-text-muted">
                Messages in this chat are set to disappear one hour after sending.
              </p>
            </div>
          </Surface>
        </div>
      </Container>
    </section>
  );
}

/* D. Membership (review spec §23, §24, §25, §27) ---------------------------- */

const MEMBERSHIP_POINTS = [
  "One-time membership",
  "Renewal: never",
  "No behavioral advertising",
];

/* Organizational strip — contact-led settlement, USD indicative pricing. */
const ORG_TIERS: {
  name: string;
  price: string;
  product: "private_circle" | "office" | "sovereign";
}[] = [
  {
    name: "Cloaq Private Circle",
    price: `From ${formatUSD(CLOAK_PRICING.privateCircle.startingAt)}`,
    product: "private_circle",
  },
  {
    name: "Cloaq Office",
    price: `From ${formatUSD(CLOAK_PRICING.office.startingAt)}/year`,
    product: "office",
  },
  {
    name: "Cloaq Sovereign",
    price: "Custom",
    product: "sovereign",
  },
];

export function MembershipSection() {
  const [checkoutPlan, setCheckoutPlan] = useState<"private" | "reserve" | null>(null);
  const [contactProduct, setContactProduct] = useState<
    "private_circle" | "office" | "sovereign" | null
  >(null);

  return (
    <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Membership"
          title="Choose your level of assurance."
          lead="Individual membership is one payment, settled in native USDC on Solana. Private environments are arranged directly with Cloaq."
        />

        {/* Two primary cards only (review spec §23) */}
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {/* Cloaq Private */}
          <Surface className="flex flex-col p-6">
            <p className="text-sm font-medium text-cloak-text">Cloaq Private</p>
            <p className="mt-1 text-[12px] text-cloak-text-muted">For individuals.</p>
            <p
              className="mt-4 cloak-display text-4xl font-medium text-cloak-text"
              aria-label={`${CLOAK_PRICING.private.amount} USDC, one-time payment`}
            >
              {CLOAK_PRICING.private.amount.toLocaleString("en-US")}{" "}
              <span className="text-xl text-cloak-text-secondary">USDC</span>
            </p>
            <p className="mt-0.5 text-[11px] text-cloak-text-muted">
              one-time · Native USDC on Solana
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-cloak-text-secondary">
              Private messaging and private on-device intelligence.
            </p>
            <div className="mt-auto pt-5">
              <Button
                className="cloak-cta-gold h-10 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => setCheckoutPlan("private")}
              >
                Get Cloaq Private
              </Button>
            </div>
          </Surface>

          {/* Cloaq Reserve — restrained gold hairline (review spec §24) */}
          <div className="relative flex flex-col overflow-hidden rounded-xl border border-cloak-gold/25 bg-cloak-bg-elevated/70 p-6">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cloak-gold/60 to-transparent"
            />
            <p className="text-sm font-medium tracking-wide text-cloak-text">{BRAND.cloakReserve}</p>
            <p className="mt-1 text-[12px] text-cloak-text-muted">Higher assurance.</p>
            <p
              className="mt-4 cloak-display text-4xl font-medium tracking-wide text-cloak-text"
              aria-label={`${CLOAK_PRICING.reserve.amount.toLocaleString("en-US")} USDC, one-time payment`}
            >
              {CLOAK_PRICING.reserve.amount.toLocaleString("en-US")}{" "}
              <span className="text-xl tracking-normal text-cloak-text-secondary">USDC</span>
            </p>
            <p className="mt-0.5 text-[11px] text-cloak-text-muted">
              one-time · Native USDC on Solana
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-cloak-text-secondary">
              Everything in Cloaq Private, plus advanced controls, priority
              support, and 10 full Cloaq Private memberships to grant.
            </p>
            <div className="mt-auto pt-5">
              <Button
                className="cloak-cta-gold h-10 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310]"
                onClick={() => setCheckoutPlan("reserve")}
              >
                Get {BRAND.cloakReserve}
              </Button>
            </div>
          </div>
        </div>

        <ul className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-cloak-text-secondary">
          {MEMBERSHIP_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <ShieldCheckIcon size={14} className="shrink-0 text-cloak-success" />
              {point}
            </li>
          ))}
        </ul>

        {/* Organizational strip (review spec §23) */}
        <div className="mx-auto mt-10 max-w-3xl">
          <div className="rounded-xl border border-cloak-border bg-cloak-surface/50 p-6">
            <p className="text-center text-[13px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
              For families, offices and institutions
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {ORG_TIERS.map((tier) => (
                <button
                  key={tier.name}
                  onClick={() => setContactProduct(tier.product)}
                  className="group flex flex-col items-start rounded-lg border border-cloak-border bg-cloak-bg/60 px-4 py-3.5 text-left transition-colors hover:border-cloak-border-strong hover:bg-cloak-surface"
                >
                  <span className="text-sm font-medium text-cloak-text">{tier.name}</span>
                  <span className="mt-1 text-[12px] text-cloak-text-muted">{tier.price}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-cloak-text-secondary transition-colors group-hover:text-cloak-gold">
                    Contact Cloaq
                    <ChevronRightIcon size={11} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            variant="outline"
            size="lg"
            className="h-12 border-cloak-border-strong bg-transparent px-7 text-base text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
            onClick={() => navigate("/pricing")}
          >
            View Membership
          </Button>
        </div>
      </Container>

      <UsdcCheckoutDialog
        open={checkoutPlan !== null}
        onOpenChange={(v) => {
          if (!v) setCheckoutPlan(null);
        }}
        plan={checkoutPlan ?? "private"}
      />
      <ContactRequestDialog
        open={!!contactProduct}
        onOpenChange={(v) => {
          if (!v) setContactProduct(null);
        }}
        product={contactProduct ?? "office"}
      />
    </section>
  );
}

/* E. Install as PWA (review spec §22) --------------------------------------- */

export function InstallSection() {
  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <span className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-cloak-border bg-cloak-surface text-cloak-gold">
            <PackageIcon size={24} />
          </span>
          <SectionHeading
            title="Cloaq belongs on your device."
            lead="Install Cloaq to your home screen or desktop for a focused app experience using the same Cloaq security model."
          />
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <InstallPWAButton variant="gold" size="lg" />
          </div>
          <p className="mt-5 text-xs text-cloak-text-muted">
            iOS, Android, and desktop browsers that support installable web apps.
          </p>
        </div>
      </Container>
    </section>
  );
}

/* F. FAQ — six questions (review spec §78, §79) ------------------------------ */

const FAQS: { q: string; a: string }[] = [
  {
    q: "Is Cloaq Private a subscription?",
    a: "No. Cloaq Private is a one-time individual membership. You pay once — there is no recurring billing and nothing to cancel.",
  },
  {
    q: "Does Cloaq AI upload my conversations?",
    a: "No. Retrieval and reasoning run on your device. Only a small, permissioned context reaches the local model — and cloud processing never happens without your explicit choice.",
  },
  {
    q: "Can cloud AI be disabled?",
    a: "Yes, and it is off by default. Processing can be set to local-only, ask-before-cloud, or allow-cloud — and any cloud use is clearly labeled.",
  },
  {
    q: "Does my payment wallet become my Cloaq identity?",
    a: "No. Payment verification and Cloaq identity are separate systems. Your paying wallet is never used as your username, profile, or login.",
  },
  {
    q: "What is a Cloaq Circle?",
    a: "A trusted, invite-only structure that organizes private groups around the people you rely on. A person can belong to a Circle without automatically seeing every group inside it.",
  },
  {
    q: "What is Dagger?",
    a: "Dagger is Cloaq's emergency device control. It destroys Cloaq's local keys, clears sensitive Cloaq-controlled local data and revokes the selected device from your account.",
  },
  {
    q: "Does Dagger delete my account?",
    a: "No. Dagger removes a device. Your account, membership and other trusted devices remain active unless you separately choose to delete your account.",
  },
  {
    q: "Does Dagger remove every trace?",
    a: "No software running as a PWA can guarantee removal of every operating-system or browser artifact. Dagger destroys Cloaq's keys, private application data and device authorization that Cloaq controls.",
  },
  {
    q: "What if I remotely Dagger an offline device?",
    a: "The device is revoked immediately on Cloaq's servers. Local deletion is attempted when the device next reconnects.",
  },
  {
    q: "Can Cloaq be installed as an app?",
    a: "Yes. Cloaq is an installable app (PWA) on supported platforms — a focused app experience using the same Cloaq security model.",
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-t border-cloak-border py-20 md:py-28">
      <Container>
        <div className="mx-auto max-w-3xl">
          <SectionHeading eyebrow="FAQ" title="Straight answers." />
          <div className="divide-y divide-cloak-border rounded-xl border border-cloak-border bg-cloak-surface/40">
            {FAQS.map((item, i) => {
              const isOpen = open === i;
              return (
                <div key={item.q}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-cloak-surface"
                  >
                    <span className="text-sm font-medium text-cloak-text md:text-base">{item.q}</span>
                    <ChevronDownIcon
                      size={16}
                      className={cn(
                        "shrink-0 text-cloak-text-muted transition-transform duration-200",
                        isOpen && "rotate-180"
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

/* G. Final CTA (review spec §76) ---------------------------------------------- */

export function ClosingCTA({ children }: { children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-t border-cloak-border py-20 md:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[280px] w-[560px] -translate-x-1/2 rounded-full bg-cloak-gold-soft blur-[100px]"
      />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="cloak-display text-balance text-3xl font-medium leading-tight text-cloak-text md:text-4xl">
            For conversations that should remain under your control.
          </h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="cloak-cta-gold h-12 border border-black/20 px-7 text-base font-medium text-[#141310] shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-12px_rgba(214,177,94,0.55)] hover:text-[#141310]"
              onClick={() => navigate("/app/messages")}
            >
              Open Cloaq
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-12 border-cloak-border-strong bg-transparent px-7 text-base text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
              onClick={() => navigate("/security")}
            >
              Explore Security
            </Button>
          </div>
          {children}
        </div>
      </Container>
    </section>
  );
}
