"use client";

/*
 * Homepage assembly (review spec §3, §77) — sections in the specified order.
 * Shortened hierarchy: hero -> proof -> audience -> Groups & Circles ->
 * Cloak Mode -> Intelligence -> Security evidence -> Identity -> Ghost Chats
 * -> Membership -> Install -> FAQ -> final CTA. Deeper AI architecture lives
 * on /intelligence, detailed security on /security, all five memberships on
 * /pricing.
 */

import { Hero } from "./hero";
import {
  TrustStrip,
  AudienceSection,
  GroupsCirclesSection,
  CloakModeSection,
  DaggerSection,
  IntelligenceSection,
} from "./home-sections-a";
import {
  SecurityEvidenceSection,
  IdentitySection,
  GhostChatsSection,
  MembershipSection,
  InstallSection,
  FAQSection,
  ClosingCTA,
  NearbyResilienceSection,
} from "./home-sections-b";

export function HomePage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <AudienceSection />
      <GroupsCirclesSection />
      <CloakModeSection />
      <DaggerSection />
      <IntelligenceSection />
      <SecurityEvidenceSection />
      <NearbyResilienceSection />
      <IdentitySection />
      <GhostChatsSection />
      <MembershipSection />
      <InstallSection />
      <FAQSection />
      <ClosingCTA />
    </>
  );
}
