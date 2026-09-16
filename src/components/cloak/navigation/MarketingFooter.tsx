"use client";

/*
 * Marketing footer (review spec §49, §10).
 * Columns: Product / Trust / Company / Access. No social icons, no noise,
 * no absolute claims. Trust links resolve to sections of /security via the
 * hash-router-safe section navigator.
 */

import { Container } from "@/components/cloak/shared/primitives";
import { CloakLogo } from "@/components/cloak/brand/CloakLogo";
import { navigate, navigateToSection } from "@/hooks/use-hash-route";

type FooterLink = { label: string; path: string; anchor?: string };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Messaging", path: "/" },
      { label: "Groups & Circles", path: "/", anchor: "groups" },
      { label: "Cloaq AI", path: "/intelligence" },
      { label: "Security", path: "/security" },
      { label: "Membership", path: "/pricing" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Threat Model", path: "/security", anchor: "threat-model" },
      { label: "Security Reviews", path: "/security", anchor: "audit" },
      { label: "Responsible Disclosure", path: "/security", anchor: "disclosure" },
      { label: "Privacy", path: "/security", anchor: "privacy" },
      { label: "Terms", path: "/security", anchor: "privacy" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Cloaq", path: "/about" },
      { label: "Advisers", path: "/advisers" },
      { label: "Partners", path: "/partners" },
    ],
  },
  {
    title: "Access",
    links: [
      { label: "Open Cloaq", path: "/app/messages" },
      { label: "Install Cloaq", path: "/download" },
    ],
  },
];

export function MarketingFooter() {
  const go = (link: FooterLink) => {
    if (link.anchor) navigateToSection(link.path, link.anchor);
    else navigate(link.path);
  };

  return (
    <footer className="mt-auto border-t border-cloak-border bg-cloak-bg">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <CloakLogo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-cloak-text-muted">
              Private communications. Private intelligence.
            </p>
          </div>
          {GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-cloak-text-muted">
                {group.title}
              </h3>
              <ul className="space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => go(link)}
                      className="text-sm text-cloak-text-secondary transition-colors hover:text-cloak-text"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-cloak-border pt-6 text-xs text-cloak-text-muted md:flex-row md:items-center md:justify-between">
          <span>CLOAQ</span>
          <span>No ads. No behavioral advertising.</span>
        </div>
      </Container>
    </footer>
  );
}
