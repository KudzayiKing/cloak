import type { Metadata } from "next";
import { BRAND } from "@/lib/cloak/config";
import { InvitationsAdminScreen } from "../invitations-admin-screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `New Founding Adviser Invitation — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * Spec §42 lists /admin/invitations/new as its own route. The create flow is
 * a sheet on the dashboard, so this route renders the same screen with that
 * sheet already open rather than duplicating the form.
 */
export default function NewAdminInvitationPage() {
  return <InvitationsAdminScreen openFormInitially />;
}
