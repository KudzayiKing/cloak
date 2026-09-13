"use client";

/*
 * Home sections (review spec §5, §11-§14, §16, §44-§45):
 * trust strip, audience, Groups & Circles, Cloak Mode demo,
 * condensed Cloak Intelligence.
 *
 * Copy rules (review spec §80/§81): short, precise, calm, technically
 * defensible. No absolute security claims, no "Communities"/discovery
 * language, no wealth-coded content.
 */

import { useState } from "react";
import {
  Container,
  SectionHeading,
  Surface,
} from "@/components/cloak/shared/primitives";
import { cn } from "@/lib/utils";
import { navigate, navigateToSection } from "@/hooks/use-hash-route";
import {
  LockIcon,
  CpuIcon,
  EyeOffIcon,
  CoinsIcon,
  MessageCircleIcon,
  UsersIcon,
  TimerIcon,
  UserRoundCheckIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  ChevronRightIcon,
  UsersRoundIcon,
  HouseIcon,
  FileTextIcon,
  PencilIcon,
  ShieldUserIcon,
  GlobeLockIcon,
  UserRoundCogIcon,
} from "@animateicons/react/lucide";
import { Sword as SwordIcon } from "lucide-react";
import type { ReactNode } from "react";

/* A. Trust strip (review spec §5) ----------------------------------------- */

const TRUST_ITEMS = [
  { icon: LockIcon, title: "Private messaging", note: "Encrypted conversation content" },
  { icon: CpuIcon, title: "Local-first AI", note: "Processing on your device" },
  { icon: EyeOffIcon, title: "No behavioral advertising", note: "No ad model, no trackers" },
  { icon: CoinsIcon, title: "Direct settlement", note: "Native USDC on Solana" },
];

export function TrustStrip() {
  return (
    <section className="border-y border-cloak-border bg-cloak-bg-elevated/40">
      <Container className="py-10">
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <li key={item.title} className="group flex items-start gap-3">
              <span className="mt-0.5 text-cloak-gold transition-transform duration-200 group-hover:scale-110">
                <item.icon size={20} />
              </span>
              <div>
                <p className="text-sm font-medium text-cloak-text">{item.title}</p>
                <p className="mt-0.5 text-xs text-cloak-text-muted">{item.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* B. Audience + product concepts (review spec §13, §14) ------------------- */

const AUDIENCES = [
  { icon: UserRoundCogIcon, title: "Executives & founders", body: "Decisions that move markets and reputations." },
  { icon: HouseIcon, title: "Family offices", body: "Discretion across principals, family, and staff." },
  { icon: FileTextIcon, title: "Legal teams", body: "Client work that demands confidentiality." },
  { icon: PencilIcon, title: "Journalists", body: "Sources that must stay protected." },
  { icon: ShieldUserIcon, title: "Security teams", body: "Operations where timing and privacy matter." },
  { icon: GlobeLockIcon, title: "Private organizations", body: "Teams that outgrew consumer messengers." },
];

const PRODUCT_CONCEPTS = [
  { icon: MessageCircleIcon, title: "Private messaging" },
  { icon: UsersIcon, title: "Private groups" },
  { icon: UsersRoundIcon, title: "Cloak Circles" },
  { icon: UserRoundCheckIcon, title: "Cloak IDs" },
  { icon: MonitorSmartphoneIcon, title: "Trusted devices" },
  { icon: TimerIcon, title: "Disappearing conversations" },
];

export function AudienceSection() {
  return (
    <section className="py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Who Cloak is for"
          title="Built for conversations where exposure has consequences."
          lead="Cloak is a deliberate choice for people whose communications carry real professional, legal, or personal stakes — not a status symbol."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => (
            <li key={a.title}>
              <Surface hover className="h-full p-6">
                <span className="text-cloak-gold">
                  <a.icon size={22} />
                </span>
                <h3 className="mt-4 text-base font-medium text-cloak-text">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{a.body}</p>
              </Surface>
            </li>
          ))}
        </ul>

        {/* Six product concepts (review spec §13) */}
        <ul className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-2.5">
          {PRODUCT_CONCEPTS.map((c) => (
            <li
              key={c.title}
              className="inline-flex items-center gap-2 rounded-full border border-cloak-border bg-cloak-bg-elevated/60 px-4 py-2 text-[13px] text-cloak-text-secondary"
            >
              <c.icon size={14} className="text-cloak-gold" />
              {c.title}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* C. Groups & Circles (review spec §11, §12) ------------------------------- */

const CIRCLE_MEMBERS = ["Principal", "Executive Team", "Legal", "Investments", "Security", "Travel"];

const CIRCLE_POINTS = [
  "Invite-only",
  "Controlled membership",
  "Group-level permissions",
  "Security policies",
  "Local-first intelligence",
  "No public discovery",
];

export function GroupsCirclesSection() {
  return (
    <section id="groups" className="scroll-mt-20 border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Groups & Circles"
              title="Private groups. Trusted Circles."
              lead="Organize trusted people into private groups without creating a public community, follower graph, or discoverable social network."
            />
            <p className="-mt-6 mb-8 max-w-xl text-sm leading-relaxed text-cloak-text-secondary md:text-base">
              A person can belong to a Circle without automatically seeing
              every group inside it. Cloak organizes trust — it does not create
              a public social network.
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:max-w-md">
              {CIRCLE_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2.5 text-sm text-cloak-text-secondary">
                  <ShieldCheckIcon size={15} className="shrink-0 text-cloak-success" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-9">
              <button
                onClick={() => navigateToSection("/security", "circles")}
                className="inline-flex items-center gap-2 rounded-lg border border-cloak-border-strong bg-cloak-surface px-4 py-2.5 text-sm text-cloak-text transition-colors hover:bg-cloak-surface-hover"
              >
                Explore Groups &amp; Circles
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>

          {/* Family Office Circle visual */}
          <Surface className="p-7 md:p-9">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Example Circle
            </p>
            <h3 className="cloak-display mt-3 text-2xl font-medium text-cloak-text">Family Office</h3>
            <p className="mt-1.5 text-[13px] text-cloak-text-muted">Invite-only · 6 private groups</p>
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {CIRCLE_MEMBERS.map((member, i) => (
                <div
                  key={member}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-4 py-3",
                    i === 0
                      ? "border-cloak-gold/30 bg-cloak-gold-soft/40"
                      : "border-cloak-border bg-cloak-bg/60"
                  )}
                >
                  <span className={cn("text-sm", i === 0 ? "font-medium text-cloak-text" : "text-cloak-text-secondary")}>
                    {member}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-cloak-text-muted">
                    {i === 0 ? "Owner" : `Group ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-cloak-border pt-4 text-[12px] leading-relaxed text-cloak-text-muted">
              Membership is granted by the Circle owner. No open invitation
              links, no discovery, no follower graph.
            </p>
          </Surface>
        </div>
      </Container>
    </section>
  );
}

/* D. Cloak Mode — interactive demo (review spec §44, §45) ------------------ */

const CLOAK_MODE_BEHAVIORS: { label: string; demo: ReactNode }[] = [
  {
    label: "Message previews hidden",
    demo: (
      <div className="flex items-center justify-between">
        <span className="text-sm text-cloak-text-secondary">Sarah Ahmed</span>
        <span className="cloak-redacted px-8 text-sm">Board pack — revised terms</span>
      </div>
    ),
  },
  {
    label: "Sender information reduced",
    demo: (
      <div className="flex items-center justify-between">
        <span className="cloak-redacted px-8 text-sm">Daniel Reed</span>
        <span className="text-sm text-cloak-text-secondary">New message</span>
      </div>
    ),
  },
  {
    label: "Read and activity status hidden",
    demo: (
      <div className="flex items-center gap-2 text-sm text-cloak-text-muted">
        <EyeOffIcon size={14} className="text-cloak-warning" />
        Last seen hidden · typing indicator off
      </div>
    ),
  },
  {
    label: "Sensitive chats locked",
    demo: (
      <div className="flex items-center gap-2 text-sm text-cloak-text-secondary">
        <LockIcon size={14} className="text-cloak-gold" />
        Board pack — locked in Cloak Mode
      </div>
    ),
  },
];

const CLOAK_MODE_SCENARIOS = ["Board meeting", "Screen sharing", "Travel", "Handing your device to someone else"];

export function CloakModeSection() {
  const [enabled, setEnabled] = useState(true);

  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Cloak Mode"
              title="Reduce exposure. One control."
              lead="When someone else can see your screen, Cloak should reveal less. One control reduces notification details, hides activity information, and locks selected conversations."
            />
            <ul className="mb-8 flex flex-wrap gap-2">
              {CLOAK_MODE_SCENARIOS.map((scenario) => (
                <li
                  key={scenario}
                  className="rounded-full border border-cloak-border bg-cloak-bg-elevated/60 px-3.5 py-1.5 text-xs text-cloak-text-secondary"
                >
                  {scenario}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setEnabled((v) => !v)}
              aria-pressed={enabled}
              className="group inline-flex items-center gap-4 rounded-xl border border-cloak-border-strong bg-cloak-surface p-4 pr-6 transition-colors hover:bg-cloak-surface-hover focus-visible:outline-2 focus-visible:outline-cloak-gold/70"
            >
              <span
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
                  enabled ? "bg-cloak-gold" : "bg-cloak-border-strong"
                )}
              >
                <span
                  className={cn(
                    "absolute h-5 w-5 rounded-full bg-cloak-bg shadow transition-all duration-200",
                    enabled ? "left-6.5 translate-x-0" : "left-1"
                  )}
                  style={{ left: enabled ? "calc(100% - 26px)" : "4px" }}
                />
              </span>
              <span className="text-left">
                <span className="block text-sm font-medium text-cloak-text">
                  Cloak Mode {enabled ? "on" : "off"}
                </span>
                <span className="block text-xs text-cloak-text-muted">
                  Try it — the demo panel responds instantly.
                </span>
              </span>
            </button>
          </div>

          <Surface className={cn("p-5 transition-all duration-300", enabled && "border-cloak-gold/20")}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                Notification surface
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  enabled
                    ? "bg-cloak-gold-soft text-cloak-gold-bright"
                    : "border border-cloak-border text-cloak-text-muted"
                )}
              >
                <ShieldUserIcon size={12} />
                {enabled ? "Cloak Mode active" : "Standard"}
              </span>
            </div>
            <ul className="space-y-3">
              {CLOAK_MODE_BEHAVIORS.map((b, i) => (
                <li
                  key={b.label}
                  className={cn(
                    "rounded-lg border border-cloak-border bg-cloak-bg/60 px-4 py-3 transition-all duration-300",
                    enabled ? "opacity-100" : "opacity-40"
                  )}
                >
                  <div className="mb-2 text-[11px] font-medium text-cloak-text-secondary">
                    {i + 1}. {b.label}
                  </div>
                  {b.demo}
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      </Container>
    </section>
  );
}

/* D2. Dagger — emergency device control (codex §35-§37).
   Sits AFTER Cloak Mode and BEFORE Cloak Intelligence:
   Cloak Mode = reduce exposure while using the device.
   Dagger = end trust in the device. */

const DAGGER_FEATURES = [
  {
    title: "Destroy local keys",
    body: "Cloak removes the keys required to use local encrypted data.",
  },
  {
    title: "Clear private local data",
    body: "Messages, AI memory, indexes and Cloak-controlled sensitive caches are cleared.",
  },
  {
    title: "Revoke the device",
    body: "The device loses access to your Cloak account.",
  },
];

export function DaggerSection() {
  return (
    <section id="dagger" className="scroll-mt-20 py-20 md:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Dagger"
              title="When you stop trusting the device."
              lead="Dagger is Cloak's emergency device control. Activate it to destroy local Cloak keys, clear sensitive local data and revoke the device from your account. Your other trusted devices and Cloak membership remain active."
            />
            <ul className="mb-8 space-y-3">
              {DAGGER_FEATURES.map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <SwordIcon
                    size={15}
                    className="cloak-dagger-glyph mt-1 shrink-0 text-cloak-gold"
                  />
                  <div>
                    <p className="text-sm font-medium text-cloak-text">{f.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-cloak-text-secondary">
                      {f.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigateToSection("/security", "dagger")}
              className="inline-flex items-center gap-2 rounded-lg border border-cloak-border-strong bg-cloak-surface px-5 py-3 text-sm font-medium text-cloak-text transition-colors hover:bg-cloak-surface-hover"
            >
              Learn about Dagger
              <ChevronRightIcon size={15} className="text-cloak-gold" />
            </button>
          </div>

          {/* Product-style Dagger preview (codex §37) — no spy artwork. */}
          <Surface className="p-6">
            <div className="mb-5 flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                <SwordIcon size={14} className="cloak-dagger-glyph text-cloak-gold" />
                Dagger
              </span>
              <span className="rounded-full border border-cloak-border px-2.5 py-1 text-[11px] text-cloak-text-muted">
                Emergency
              </span>
            </div>
            <div className="rounded-xl border border-cloak-border bg-cloak-bg/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-cloak-text">This device</p>
                  <p className="mt-0.5 text-[12px] text-cloak-text-muted">MacBook Pro</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border px-2.5 py-1 text-[11px] text-cloak-success">
                  Trusted
                </span>
              </div>
              <div className="mt-3.5 space-y-1.5 text-[12px] text-cloak-text-secondary">
                <p>Destroy local Cloak data</p>
                <p>Revoke device</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-cloak-danger/30 bg-cloak-danger/10 px-4 py-3 text-center text-[13px] font-medium text-cloak-danger">
              Hold to Dagger
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-cloak-text-muted">
              Dagger removes Cloak-controlled local data and device
              authorization. Operating-system or browser artifacts outside
              Cloak&apos;s control may remain.
            </p>
          </Surface>
        </div>
      </Container>
    </section>
  );
}

/* E. Cloak Intelligence — condensed (review spec §16-§19) ------------------ */

const INTELLIGENCE_STAGES = [
  {
    title: "Retrieve locally",
    body: "Only permitted context is selected.",
  },
  {
    title: "Reason locally",
    body: "Cloak Intelligence runs on the device where supported.",
  },
  {
    title: "Show the boundary",
    body: "Cloak tells you whether processing stayed local.",
  },
];

export function IntelligenceSection() {
  return (
    <section className="border-y border-cloak-border bg-cloak-bg-elevated/40 py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Cloak Intelligence"
          title="Your AI should not need your conversations in the cloud."
          lead="The model does not search your entire message history. Cloak retrieves only the context permitted for the request."
        />

        {/* Three stages */}
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-3 md:grid-cols-3">
            {INTELLIGENCE_STAGES.map((stage, i) => (
              <div key={stage.title} className="relative">
                <Surface className="h-full p-6">
                  <span className="text-[11px] font-semibold text-cloak-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 text-base font-medium text-cloak-text">{stage.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-cloak-text-secondary">{stage.body}</p>
                </Surface>
                {i < INTELLIGENCE_STAGES.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-2.5 top-1/2 hidden h-px w-2 bg-cloak-gold/40 md:block"
                  />
                )}
              </div>
            ))}
          </div>

          <p className="mx-auto mt-7 max-w-2xl text-center text-sm leading-relaxed text-cloak-text-secondary">
            Local processing is the default. Cloud fallback can be disabled
            completely and must never occur silently.
          </p>

          <div className="mt-9 flex justify-center">
            <button
              onClick={() => navigate("/intelligence")}
              className="inline-flex items-center gap-2 rounded-lg border border-cloak-border-strong bg-cloak-surface px-5 py-3 text-sm font-medium text-cloak-text transition-colors hover:bg-cloak-surface-hover"
            >
              Explore Cloak Intelligence
              <ChevronRightIcon size={15} className="text-cloak-gold" />
            </button>
          </div>
        </div>
      </Container>
    </section>
  );
}
