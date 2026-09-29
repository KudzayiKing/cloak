import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/cloak/config";

export const metadata: Metadata = {
  title: { absolute: `Membership Settings — ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export default function MembershipSettingsRedirect() {
  redirect("/#/app/settings/membership");
}
