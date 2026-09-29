import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { AdvisersPage } from "@/components/cloak/marketing/advisers-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/advisers");

export default function Page() {
  return (
    <MarketingShell path="/advisers">
      <AdvisersPage />
    </MarketingShell>
  );
}
