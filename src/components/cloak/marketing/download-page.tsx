"use client";

/*
 * Marketing: Download page (spec §10-J, §28).
 * Installability with platform-appropriate guidance.
 */

import {
  Container,
  SectionHeading,
  Surface,
  PrimaryCTA,
} from "@/components/cloak/shared/primitives";
import { InstallPWAButton } from "@/components/cloak/pwa/install-pwa-button";
import { ClosingCTA } from "./home-sections-b";
import { SUPPORTED_PLATFORMS } from "@/lib/cloak/config";
import { SmartphoneIcon, MonitorIcon, TabletIcon, CheckIcon } from "@animateicons/react/lucide";

const PLATFORM_ICONS = [SmartphoneIcon, TabletIcon, MonitorIcon];

export function DownloadPage() {
  return (
    <>
      <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20">
        <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
        <Container className="relative">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
              Install
            </p>
            <h1 className="cloak-display text-balance text-4xl font-medium leading-tight text-cloak-text md:text-5xl">
              Cloaq belongs on your device.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-cloak-text-secondary md:text-lg">
              Install Cloaq as an app on the platforms it supports. It opens
              full-screen, keeps the same dark discipline, and never turns your
              home screen into a notification billboard.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <InstallPWAButton variant="gold" size="lg" />
              <PrimaryCTA size="lg" />
            </div>
          </div>
        </Container>
      </section>

      <section className="pb-20 md:pb-24">
        <Container>
          <SectionHeading eyebrow="Platforms" title="Install on supported devices." />
          <div className="grid gap-4 md:grid-cols-3">
            {SUPPORTED_PLATFORMS.map((p, i) => {
              const Icon = PLATFORM_ICONS[i] ?? MonitorIcon;
              return (
                <Surface key={p.platform} hover className="p-6 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-cloak-border bg-cloak-bg text-cloak-gold">
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-4 text-base font-medium text-cloak-text">{p.platform}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">{p.detail}</p>
                </Surface>
              );
            })}
          </div>

          <div className="mx-auto mt-12 max-w-3xl">
            <Surface className="p-6 md:p-8">
              <h3 className="text-base font-medium text-cloak-text">What installation changes</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  "Full-screen, standalone window",
                  "Home screen / dock presence",
                  "Offline shell for the interface",
                  "Cloaq AI stored on-device",
                  "Same dark, quiet interface",
                  "Same privacy defaults",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-cloak-text-secondary">
                    <CheckIcon size={15} className="shrink-0 text-cloak-success" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs leading-relaxed text-cloak-text-muted">
                Installation is optional — Cloaq remains fully usable in the
                browser. In the installed PWA, Cloaq AI downloads automatically
                on first launch where the device supports it and keeps the
                artifact on that device.
              </p>
            </Surface>
          </div>
        </Container>
      </section>

      <ClosingCTA />
    </>
  );
}
