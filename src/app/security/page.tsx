import { CloakRoot } from "@/components/cloak/router/cloak-root";
import { marketingMetadata } from "@/lib/cloak/seo";

export const metadata = marketingMetadata("/security");

export default function Page() {
  return <CloakRoot />;
}
