import { cookies } from "next/headers";
import { AdminGate } from "@/components/cloak/admin/admin-gate";
import { AdminOverview } from "@/components/cloak/admin/admin-overview";
import { SESSION_COOKIE, getSessionUserFromToken } from "@/lib/cloak/server/auth";
import { isAdminUser } from "@/lib/cloak/server/adviser-invitations";
import { getAdminOverview } from "@/lib/cloak/server/admin-metrics";

/*
 * Server body for /admin.
 *
 * The authorization decision happens HERE, before a single aggregate is read —
 * and it uses the same `isAdminUser` predicate as `/api/admin/overview` and
 * `/api/admin/adviser-invitations`, so the page and the endpoints cannot
 * disagree about who is an operator. Rendering the nav link from Settings is
 * convenience, never authorization.
 *
 * The whole payload is fetched on the server and handed to a presentational
 * component. That keeps the panel's numbers server-authoritative: there is no
 * client fetch to race, no loading state to get wrong, and no way for a browser
 * to ask for a different slice of the data than the page decided to show.
 *
 * This module is not a route — only page.tsx / route.ts are special in the App
 * Router — so it sits beside page.tsx and can be shared, exactly as
 * `invitations-admin-screen.tsx` does.
 */
export async function AdminOverviewScreen() {
  const cookieStore = await cookies();
  const user = await getSessionUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!isAdminUser(user)) {
    return <AdminGate />;
  }

  return <AdminOverview overview={await getAdminOverview()} />;
}
