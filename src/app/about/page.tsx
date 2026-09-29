import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { AboutPage } from "@/components/cloak/marketing/about-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/about");

export default function Page() {
  return (
    <MarketingShell path="/about">
      <AboutPage />
    </MarketingShell>
  );
}
