"use client";

/*
 * CloakApp — hash router switch.
 *
 * Route map (mirrors the eventual file-system routes, spec §8/§16;
 * review spec §33/§35/§50):
 *   Marketing: #/  #/security  #/intelligence  #/pricing  #/download
 *              #/advisers  #/partners  #/about
 *   Invite:    #/invite/{token}   (standalone — no marketing chrome)
 *   App:       #/app/messages  #/app/intelligence  #/app/contacts
 *              #/app/security  #/app/security/devices
 *              #/app/settings  #/app/settings/{membership|cloak|privacy|notifications|ai|storage|appearance}
 *
 * /security and /intelligence exist in both worlds in the spec (§8 vs §16):
 * they resolve to marketing pages pre-auth and to app pages once inside.
 * App routes require an active membership — without one the premium access
 * screen (paywall) is shown, with invitation redemption (spec §40-§41).
 */

import { useEffect } from "react";
import type { RouteInfo } from "@/hooks/use-hash-route";
import { MarketingHeader } from "@/components/cloak/navigation/MarketingHeader";
import { MarketingFooter } from "@/components/cloak/navigation/MarketingFooter";
import { HomePage } from "@/components/cloak/marketing/home-page";
import { SecurityPage } from "@/components/cloak/marketing/security-page";
import { IntelligencePage as MarketingIntelligencePage } from "@/components/cloak/marketing/intelligence-page";
import { PricingPage } from "@/components/cloak/marketing/pricing-page";
import { DownloadPage } from "@/components/cloak/marketing/download-page";
import { AdvisersPage } from "@/components/cloak/marketing/advisers-page";
import { PartnersPage } from "@/components/cloak/marketing/partners-page";
import { AboutPage } from "@/components/cloak/marketing/about-page";
import { MessagesPage } from "@/components/cloak/messaging/messages-page";
import { IntelligencePage } from "@/components/cloak/intelligence/intelligence-page";
import { ContactsPage } from "@/components/cloak/contacts/contacts-page";
import { CirclesPage } from "@/components/cloak/circles/circles-page";
import { CirclePage } from "@/components/cloak/circles/circle-detail";
import { CircleInvitePage } from "@/components/cloak/circles/circle-invite-page";
import { SecurityCentrePage, DevicesPage } from "@/components/cloak/security/security-pages";
import { SettingsPage } from "@/components/cloak/settings/settings-page";
import { InvitePage } from "@/components/cloak/membership/invite-page";
import { PremiumAccessScreen } from "@/components/cloak/membership/paywall";
import { SignInScreen } from "@/components/cloak/auth/sign-in-screen";
import { ensureSeededMemories } from "@/ai/orchestrator/CloakOrchestrator";
import { SEED_MEMORIES } from "@/lib/cloak/demo-data";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { LoaderCircleIcon } from "@animateicons/react/lucide";

const APP_SEGMENTS = ["messages", "intelligence", "contacts", "circles", "security", "settings"];

const KNOWN_MARKETING = [
  "/",
  "/security",
  "/intelligence",
  "/pricing",
  "/download",
  "/advisers",
  "/partners",
  "/about",
];

function isAppRoute(segments: string[]): boolean {
  return segments[0] === "app" && APP_SEGMENTS.includes(segments[1] ?? "");
}

function isInviteRoute(segments: string[]): boolean {
  return segments[0] === "invite" && !!segments[1];
}

/** Public circle-invite landing (circles spec §40): #/circles/invite/<token>. */
function isCircleInviteRoute(segments: string[]): boolean {
  return segments[0] === "circles" && segments[1] === "invite" && !!segments[2];
}

export function CloakApp({ route }: { route: RouteInfo }) {
  const { path, segments } = route;
  const membership = useCloakStore((s) => s.membership.membership);
  const membershipActive = useCloakStore((s) => s.membership.active);
  const authUser = useCloakStore((s) => s.auth.user);
  const authChecked = useCloakStore((s) => s.auth.checked);
  const bootstrapAuth = useCloakStore((s) => s.bootstrapAuth);

  /* Restore the session (cookie is the truth) once on mount. */
  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  /* Seed demo memories once so the orchestrator answers on first use. */
  useEffect(() => {
    ensureSeededMemories(SEED_MEMORIES);
  }, []);

  /* Unknown routes fall back to home. */
  useEffect(() => {
    const known =
      KNOWN_MARKETING.includes(path) ||
      isAppRoute(segments) ||
      isInviteRoute(segments) ||
      isCircleInviteRoute(segments) ||
      path.startsWith("/settings/");
    if (!known) navigate("/");
  }, [path, segments]);

  /* ---------- Invitation redemption (spec §42) ---------- */
  if (isInviteRoute(segments)) {
    return <InvitePage token={segments[1]} />;
  }

  /* ---------- Circle invite landing (circles spec §40) ---------- */
  if (isCircleInviteRoute(segments)) {
    return <CircleInvitePage token={segments[2]} />;
  }

  /* ---------- Application routes ---------- */
  if (isAppRoute(segments)) {
    /* Identity gate: wait for the session check, then require sign-in. */
    if (!authChecked) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-cloak-bg">
          <LoaderCircleIcon size={22} className="animate-spin text-cloak-gold" />
        </div>
      );
    }
    if (!authUser) {
      return <SignInScreen />;
    }
    /* Paywall: no active membership -> premium access screen (spec §40).
       Reserve invitees enter through the invitation route instead. */
    if (!membershipActive || membership === "none") {
      return <PremiumAccessScreen />;
    }
    switch (segments[1]) {
      case "messages":
        return <MessagesPage />;
      case "circles":
        return segments[2] ? <CirclePage circleId={segments[2]} /> : <CirclesPage />;
      case "intelligence":
        return <IntelligencePage />;
      case "contacts":
        return <ContactsPage />;
      case "security":
        return segments[2] === "devices" ? <DevicesPage /> : <SecurityCentrePage />;
      case "settings": {
        const sectionMap: Record<
          string,
          | "membership"
          | "cloak"
          | "privacy"
          | "notifications"
          | "ai"
          | "storage"
          | "appearance"
        > = {
          membership: "membership",
          cloak: "cloak",
          privacy: "privacy",
          notifications: "notifications",
          ai: "ai",
          storage: "storage",
          appearance: "appearance",
        };
        const section = segments[2] ? sectionMap[segments[2]] : undefined;
        if (segments[2] && !section) {
          return <SettingsPage section="account" />;
        }
        return <SettingsPage section={section ?? "account"} />;
      }
    }
  }

  /* ---------- Marketing routes ---------- */
  let page = <HomePage />;
  if (path === "/security") page = <SecurityPage />;
  else if (path === "/intelligence") page = <MarketingIntelligencePage />;
  else if (path === "/pricing") page = <PricingPage />;
  else if (path === "/download") page = <DownloadPage />;
  else if (path === "/advisers") page = <AdvisersPage />;
  else if (path === "/partners") page = <PartnersPage />;
  else if (path === "/about") page = <AboutPage />;

  return (
    <div className="flex min-h-dvh flex-col bg-cloak-bg">
      <MarketingHeader route={route} />
      <div className="flex-1">{page}</div>
      <MarketingFooter />
    </div>
  );
}
