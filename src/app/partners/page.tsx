import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { PartnersPage } from "@/components/cloak/marketing/partners-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/partners");

export default function Page() {
  return (
    <MarketingShell path="/partners">
      <PartnersPage />
    </MarketingShell>
  );
}
