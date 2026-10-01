import type { Metadata } from "next";
import { BRAND } from "@/lib/cloak/config";
import { InvitationsAdminScreen } from "./invitations-admin-screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Founding Adviser Invitations — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default function AdminInvitationsPage() {
  return <InvitationsAdminScreen />;
}
