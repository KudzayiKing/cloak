import type { Metadata } from "next";
import { BRAND } from "@/lib/cloak/config";
import { CloakRoot } from "@/components/cloak/router/cloak-root";

export const metadata: Metadata = {
  title: { absolute: `Messages — ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export default function MessagesPage() {
  return <CloakRoot />;
}
