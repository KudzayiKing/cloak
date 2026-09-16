"use client";

/*
 * Marketing: Security page (review spec §29-§32, §36).
 * The main credibility asset: principles, threat model, encryption,
 * Circle security model, Intelligence boundaries, metadata approach,
 * audit status, responsible disclosure, privacy.
 *
 * Audience: advisers, CISOs, family-office technology teams, lawyers,
 * security researchers, procurement reviewers. No marketing fluff —
 * every claim is either implemented, configurable, planned, or explicitly
 * limited by platform (review spec §81).
 */

import { useState } from "react";
import {
  Container,
  SectionHeading,
  Surface,
} from "@/components/cloak/shared/primitives";
import { ClosingCTA } from "./home-sections-b";
import { Sword as SwordIcon } from "lucide-react";
import { ContactRequestDialog } from "@/components/cloak/membership/dialogs";
import { Button } from "@/components/ui/button";
import { SECURITY_AUDIT_STATUS } from "@/lib/cloak/config";
import { navigateToSection } from "@/hooks/use-hash-route";
import {
  LockIcon,
  CpuIcon,
  CloudOffIcon,
  MonitorSmartphoneIcon,
  KeyRoundIcon,
  EyeOffIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  FileSearchIcon,
  FileTextIcon,
  UsersRoundIcon,
  ChevronRightIcon,
} from "@animateicons/react/lucide";

const PRINCIPLES = [
  {
    icon: LockIcon,
    title: "End-to-end encryption",
    body: "Message content is encrypted on your device and decrypted only by the intended recipients. The server relays ciphertext it cannot read.",
  },
  {
    icon: CpuIcon,
    title: "Local-first intelligence",
    body: "AI memory, retrieval, and reasoning run on your device through a Web Worker. Conversations never become training material.",
  },
  {
    icon: CloudOffIcon,
    title: "No silent cloud",
    body: "Cloud processing is off by default. If you ever allow it, Cloaq asks first and labels the answer. There is no configuration in which Cloaq uploads context quietly.",
  },
  {
    icon: MonitorSmartphoneIcon,
    title: "Trusted devices only",
    body: "Every device that holds your conversations is listed and revocable. Linking a new device is an explicit, verifiable act.",
  },
  {
    icon: KeyRoundIcon,
    title: "No secrets in the client",
    body: "Model artifacts are delivered from object storage via public or short-lived URLs. Access keys never exist in the app bundle.",
  },
  {
    icon: EyeOffIcon,
    title: "No tracking by default",
    body: "No analytics SDKs, no ad networks, no session replay, no fingerprinting. Operational metrics, if any, exclude message and AI content.",
  },
];

/* Threat model (review spec §30) — exposures Cloaq is designed to reduce. */
const THREAT_REDUCTIONS = [
  { title: "Service-provider message access", body: "Conversation content is end-to-end encrypted; the relay cannot read it." },
  { title: "Cloud AI prompt retention", body: "AI retrieval and reasoning run locally; prompts are not sent to cloud models by default." },
  { title: "Public phone-number identity", body: "People reach you by Cloaq ID — there is no public phone-number identity." },
  { title: "Casual device observation", body: "Cloaq Mode reduces previews, sender details, and activity indicators." },
  { title: "Uncontrolled group membership", body: "Groups and Circles are invite-only with controlled membership and no open invitation links." },
  { title: "Stale trusted devices", body: "Every authorized device is visible and revocable in one step." },
  { title: "Message retention beyond user intent", body: "Ghost Chats are configured to disappear from Cloaq on the timer you choose." },
];

/* Threat model limitations (review spec §30) — stated plainly. */
const THREAT_LIMITS = [
  "Cloaq cannot protect a conversation if an authorized device is already compromised.",
  "Cloaq cannot prevent another participant from photographing their screen.",
  "A PWA cannot guarantee every OS-level anti-capture control.",
  "Blockchain settlement is public. Cloaq does not claim payment anonymity.",
];

const AUDIT_STATUS_COPY: Record<
  typeof SECURITY_AUDIT_STATUS,
  { label: string; state: string; body: string }
> = {
  not_started: {
    label: "Independent security assessment",
    state: "Not started",
    body: "No independent assessment has been commissioned yet. Cloaq does not claim independent verification.",
  },
  planned: {
    label: "Independent security assessment",
    state: "Planned",
    body: "An independent assessment of the cryptographic protocol layer and application security is planned before wide-scale marketing. Cloaq does not claim independent verification until a report exists.",
  },
  in_progress: {
    label: "Independent security assessment",
    state: "In progress",
    body: "An independent assessment is underway. Cloaq does not claim completed independent verification until a final report exists.",
  },
  completed: {
    label: "Independently assessed",
    state: "View report",
    body: "The latest independent assessment report is available on request.",
  },
};

export function SecurityPage() {
  const [briefingOpen, setBriefingOpen] = useState(false);
  const audit = AUDIT_STATUS_COPY[SECURITY_AUDIT_STATUS];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Security
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Security you can read about in plain language.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              No absolute guarantees, no theater. A precise description of what
              Cloaq protects, how it is built, and where the honest limits sit.
            </p>
            <nav aria-label="Security sections" className="mt-7 flex flex-wrap items-center justify-center gap-2">
              {[
                ["Threat model", "threat-model"],
                ["Encryption", "encryption"],
                ["Dagger", "dagger"],
                ["Groups & Circles", "circles"],
                ["Audit status", "audit"],
                ["Responsible disclosure", "disclosure"],
                ["Privacy", "privacy"],
              ].map(([label, anchor]) => (
                <button
                  key={anchor}
                  onClick={() => navigateToSection("/security", anchor)}
                  className="rounded-full border border-cloak-border bg-cloak-bg-elevated/60 px-3.5 py-1.5 text-xs text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-text"
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </Container>
      </section>

      {/* Principles */}
      <section className="pb-20 md:pb-24">
        <Container>
          <SectionHeading eyebrow="Principles" title="How Cloaq is built." />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <Surface key={p.title} hover className="p-6">
                <span className="text-cloak-gold">
                  <p.icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{p.body}</p>
              </Surface>
            ))}
          </div>
        </Container>
      </section>

      {/* Threat model */}
      <section id="threat-model" className="scroll-mt-20 border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <SectionHeading
            eyebrow="Threat model"
            title="What Cloaq is designed to reduce."
            lead="A threat model states exposures honestly — including the ones that remain."
          />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {THREAT_REDUCTIONS.map((t) => (
              <Surface key={t.title} className="p-5">
                <h3 className="flex items-start gap-2.5 text-sm font-medium text-cloak-text">
                  <ShieldCheckIcon size={15} className="mt-0.5 shrink-0 text-cloak-success" />
                  {t.title}
                </h3>
                <p className="mt-2 pl-6 text-[13px] leading-relaxed text-cloak-text-secondary">{t.body}</p>
              </Surface>
            ))}
          </div>

          <div className="mx-auto mt-8 max-w-4xl rounded-xl border border-cloak-warning/25 bg-cloak-warning/5 p-6">
            <h3 className="flex items-center gap-2.5 text-base font-medium text-cloak-text">
              <TriangleAlertIcon size={17} className="text-cloak-warning" />
              What Cloaq cannot protect against
            </h3>
            <ul className="mt-4 grid gap-2.5 md:grid-cols-2">
              {THREAT_LIMITS.map((limit) => (
                <li key={limit} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-cloak-text-secondary">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cloak-warning" />
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* Encryption architecture */}
      <section id="encryption" className="scroll-mt-20 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Encryption"
              title="How message and device protection works."
              lead="Plain-language architecture — the detailed cryptographic review is part of the planned independent assessment."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Message content</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Conversation content is encrypted on the sending device using
                  keys derived per conversation, and decrypted only on the
                  recipient&apos;s device. The server relays encrypted payloads
                  and cannot read them.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Keys on your device</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Identity keys are generated on your device when your account
                  is created. Your private key is wrapped with your passphrase
                  for backup — Cloaq cannot recover it for you.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Media stays on devices</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Shared documents, images, and videos are transferred directly
                  between the devices in a conversation. The server does not
                  store your attachments.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Devices and recovery</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Every authorized device is listed and revocable. New device
                  linking is an explicit act; access requires your credentials.
                </p>
              </Surface>
            </div>
          </div>
        </Container>
      </section>

      {/* Emergency device control — Dagger (codex §38/§39) */}
      <section id="dagger" className="scroll-mt-20 border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Dagger"
              title="Emergency device control."
              lead="Dagger destroys local Cloaq keys first, then removes application-controlled sensitive data and revokes the device."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-6">
                <h3 className="flex items-center gap-2.5 text-base font-medium text-cloak-text">
                  <SwordIcon size={16} className="cloak-dagger-glyph text-cloak-gold" />
                  Keys first.
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Cloaq&apos;s Dagger flow is designed to invalidate the
                  cryptographic material required to use local encrypted data
                  before slower storage cleanup runs. Keys go first — always.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Remote Dagger</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Remote Dagger revokes a device immediately. If the target is
                  offline, local data destruction cannot occur until the device
                  reconnects.
                </p>
              </Surface>
            </div>
            <p className="mx-auto mt-7 max-w-2xl text-center text-[12px] leading-relaxed text-cloak-text-muted">
              Dagger removes Cloaq-controlled local data and device
              authorization. It does not delete your account or membership, and
              it cannot remove operating-system or browser artifacts outside
              Cloaq&apos;s control.
            </p>
          </div>
        </Container>
      </section>

      {/* Group & Circle security model */}
      <section id="circles" className="scroll-mt-20 border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Groups & Circles"
              title="Organizing trust without a public graph."
              lead="The Circle model is designed so trust stays controlled — and stays private."
            />
            <div className="grid gap-4 md:grid-cols-3">
              <Surface className="p-6">
                <span className="text-cloak-gold">
                  <UsersRoundIcon size={20} />
                </span>
                <h3 className="mt-3.5 text-base font-medium text-cloak-text">Invite-only membership</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Members are added deliberately by the people who own the
                  group. There are no open invitation links, no discovery, and
                  no follower graph.
                </p>
              </Surface>
              <Surface className="p-6">
                <span className="text-cloak-gold">
                  <FileSearchIcon size={20} />
                </span>
                <h3 className="mt-3.5 text-base font-medium text-cloak-text">Group-level visibility</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  A person can belong to a Circle without automatically seeing
                  every group inside it. Membership and visibility are managed
                  per group.
                </p>
              </Surface>
              <Surface className="p-6">
                <span className="text-cloak-gold">
                  <CpuIcon size={20} />
                </span>
                <h3 className="mt-3.5 text-base font-medium text-cloak-text">Same encryption model</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Group conversations use the same device-side encryption model
                  as one-to-one chats, and local-first intelligence rules apply
                  unchanged.
                </p>
              </Surface>
            </div>
            <p className="mt-6 rounded-lg border border-cloak-border bg-cloak-surface/60 px-5 py-3.5 text-[12.5px] leading-relaxed text-cloak-text-secondary">
              Status — private groups and Cloaq Circles are live in member
              accounts: server-enforced membership and roles, least-privilege
              invite links that grant only the groups you select, circle
              security policies, archiving, and a private activity log.
              Capabilities ship further refinements over time on the same
              model described above.
            </p>
          </div>
        </Container>
      </section>

      {/* Intelligence boundaries */}
      <section className="py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Cloaq AI"
              title="What stays local, and when cloud can occur."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-6">
                <h3 className="flex items-center gap-2.5 text-base font-medium text-cloak-text">
                  <CpuIcon size={17} className="text-cloak-gold" />
                  The local path
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Memory, retrieval, and reasoning run on your device. The
                  model does not search your entire message history — only the
                  small context permitted for the request is selected. AI
                  prompt context is not sent to a cloud model when Cloaq is
                  operating on the local path.
                </p>
              </Surface>
              <Surface className="p-6">
                <h3 className="flex items-center gap-2.5 text-base font-medium text-cloak-text">
                  <CloudOffIcon size={17} className="text-cloak-gold" />
                  The cloud boundary
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
                  Cloud processing is off by default and never silent. You can
                  choose local-only, ask-before-cloud, or allow-cloud — and
                  every answer is labeled with where processing happened.
                </p>
              </Surface>
            </div>
          </div>
        </Container>
      </section>

      {/* Metadata approach */}
      <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Metadata & infrastructure"
              title="What the server sees."
              lead="Precision here matters more than comfort."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Sees</h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-cloak-text-secondary">
                  <li>Account identifiers and membership state.</li>
                  <li>Routing metadata required to deliver messages — which conversations exist and when traffic occurs.</li>
                  <li>Payment verification data for direct USDC settlement, kept separate from messaging identity.</li>
                </ul>
              </Surface>
              <Surface className="p-6">
                <h3 className="text-base font-medium text-cloak-text">Cannot read</h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-cloak-text-secondary">
                  <li>Message content — end-to-end encrypted on devices.</li>
                  <li>Attachments — media moves device-to-device and is not stored server-side.</li>
                  <li>AI prompts and local memory — they never leave the local path.</li>
                </ul>
              </Surface>
            </div>
          </div>
        </Container>
      </section>

      {/* Audit status + responsible disclosure */}
      <section className="py-20 md:py-24">
        <Container>
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
            {/* Audit status (review spec §7) */}
            <Surface id="audit" className="scroll-mt-20 p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                Audit status
              </p>
              <h3 className="cloak-display mt-3 text-xl font-medium text-cloak-text">{audit.label}</h3>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-cloak-gold/25 bg-cloak-gold-soft px-3 py-1 text-[11px] font-medium text-cloak-gold-bright">
                {audit.state}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">{audit.body}</p>
            </Surface>

            {/* Responsible disclosure (review spec §31) */}
            <Surface id="disclosure" className="scroll-mt-20 p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                Responsible disclosure
              </p>
              <h3 className="cloak-display mt-3 flex items-center gap-2 text-xl font-medium text-cloak-text">
                <FileTextIcon size={17} className="text-cloak-gold" />
                Report a vulnerability
              </h3>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-cloak-text-secondary">
                <li className="flex gap-2.5">
                  <ShieldCheckIcon size={14} className="mt-1 shrink-0 text-cloak-success" />
                  Scope: the public website and the Cloaq application.
                </li>
                <li className="flex gap-2.5">
                  <ShieldCheckIcon size={14} className="mt-1 shrink-0 text-cloak-success" />
                  Good-faith research within scope will not be met with legal action.
                </li>
                <li className="flex gap-2.5">
                  <TriangleAlertIcon size={14} className="mt-1 shrink-0 text-cloak-warning" />
                  Prohibited: testing against real user accounts, denial of service, or data exfiltration.
                </li>
              </ul>
              <p className="mt-4 text-[12.5px] leading-relaxed text-cloak-text-muted">
                Send responsible-disclosure reports through the private launch
                contact channel with the affected route, severity, impact, and
                safe reproduction notes. No vulnerability bounty program is
                offered at this time.
              </p>
            </Surface>
          </div>
        </Container>
      </section>

      {/* Privacy summary */}
      <section id="privacy" className="scroll-mt-20 border-t border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Privacy"
              title="What this product does not do."
              lead="The practices below are implemented today, not aspirations."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "No advertising and no behavioral tracking anywhere in the product.",
                "No analytics SDKs, session replay, or fingerprinting — including in the app.",
                "Message content is end-to-end encrypted; attachments never touch the server.",
                "AI prompts and local memory stay on your device unless you explicitly allow cloud processing.",
                "Payment verification is separated from your Cloaq identity.",
                "Marketing analytics, if ever used, stay isolated from application telemetry and never capture messages, prompts, tokens, or payment details.",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2.5 rounded-lg border border-cloak-border bg-cloak-surface/50 px-4 py-3.5">
                  <ShieldCheckIcon size={15} className="mt-0.5 shrink-0 text-cloak-success" />
                  <p className="text-[13px] leading-relaxed text-cloak-text-secondary">{item}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[12.5px] leading-relaxed text-cloak-text-muted">
              For the private launch, account terms, privacy details, and
              institutional legal requests are handled through private
              onboarding.
            </p>
          </div>
        </Container>
      </section>

      {/* Private briefing (review spec §36) */}
      <section className="py-16 md:py-20">
        <Container>
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-xl border border-cloak-border bg-cloak-surface/50 px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h2 className="cloak-display text-xl font-medium text-cloak-text">
                Evaluating Cloaq for an organization?
              </h2>
              <p className="mt-1.5 text-sm text-cloak-text-secondary">
                Request a private briefing with the Cloaq team.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-11 shrink-0 border-cloak-border-strong bg-transparent px-5 text-sm text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
              onClick={() => setBriefingOpen(true)}
            >
              Request a private briefing
              <ChevronRightIcon size={14} className="ml-1" />
            </Button>
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
