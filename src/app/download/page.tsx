import { MarketingShell } from "@/components/cloak/marketing/marketing-shell";
import { DownloadPage } from "@/components/cloak/marketing/download-page";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/download");

export default function Page() {
  return (
    <MarketingShell path="/download">
      <DownloadPage />
    </MarketingShell>
  );
}
