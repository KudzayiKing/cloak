import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { SecurityPage } from "@/components/cloak/marketing/security-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/security");

export default function Page() {
  return (
    <MarketingShell path="/security">
      <SecurityPage />
    </MarketingShell>
  );
}
