import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { PricingPage } from "@/components/cloak/marketing/pricing-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/pricing");

export default function Page() {
  return (
    <MarketingShell path="/pricing">
      <PricingPage />
    </MarketingShell>
  );
}
