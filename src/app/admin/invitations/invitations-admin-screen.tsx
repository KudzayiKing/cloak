import { cookies } from "next/headers";
import { AdviserInvitationsAdmin } from "@/components/cloak/admin/adviser-invitations-admin";
import { BRAND } from "@/lib/cloak/config";
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
    return (
      <main className="grid min-h-dvh place-items-center bg-cloak-bg px-5 text-cloak-text">
        <div className="max-w-sm text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cloak-gold">
            {BRAND.uppercaseName}
          </p>
          <h1 className="cloak-display mt-3 text-2xl font-medium">Admin access required</h1>
          <p className="mt-3 text-sm leading-relaxed text-cloak-text-secondary">
            Sign in with an account listed in `CLOAK_ADMIN_HANDLES` or `CLOAK_ADMIN_USER_IDS`.
          </p>
        </div>
      </main>
    );
  }

  const invitations = await listAdviserInvitations();
  return <AdviserInvitationsAdmin initialInvitations={invitations} openFormInitially={openFormInitially} />;
}
