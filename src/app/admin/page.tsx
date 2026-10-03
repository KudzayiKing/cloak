import type { Metadata } from "next";
import { BRAND } from "@/lib/cloak/config";
import { AdminOverviewScreen } from "./overview-screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Overview — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return <AdminOverviewScreen />;
}
