import { cookies } from "next/headers";
import { AdminGate } from "@/components/cloak/admin/admin-gate";
import { AdviserInvitationsAdmin } from "@/components/cloak/admin/adviser-invitations-admin";
import { SESSION_COOKIE, getSessionUserFromToken } from "@/lib/cloak/server/auth";
import { isAdminUser, listAdviserInvitations } from "@/lib/cloak/server/adviser-invitations";

/*
 * Shared body for /admin/invitations and /admin/invitations/new (spec §42).
 *
 * The authorization decision is made HERE, on the server, before any
 * invitation data is read. `isAdminUser` is the same predicate the API routes
 * use, so the page and the endpoints cannot disagree about who is an admin —
 * hiding the navigation would not be authorization (spec §4).
 *
 * This module is not a route: only page.tsx / route.ts are special in the App
 * Router, so it can sit beside them and be shared.
 */
export async function InvitationsAdminScreen({ openFormInitially = false }: { openFormInitially?: boolean }) {
  const cookieStore = await cookies();
  const user = await getSessionUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!isAdminUser(user)) {
    return <AdminGate />;
  }

  const invitations = await listAdviserInvitations();
  return <AdviserInvitationsAdmin initialInvitations={invitations} openFormInitially={openFormInitially} />;
}
