import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { IntelligencePage } from "@/components/cloak/marketing/intelligence-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/intelligence");

export default function Page() {
  return (
    <MarketingShell path="/intelligence">
      <IntelligencePage />
    </MarketingShell>
  );
}
