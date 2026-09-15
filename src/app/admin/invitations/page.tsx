import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdviserInvitationsAdmin } from "@/components/cloak/admin/adviser-invitations-admin";
import { BRAND } from "@/lib/cloak/config";
import { SESSION_COOKIE, getSessionUserFromToken } from "@/lib/cloak/server/auth";
import { isAdminUser, listAdviserInvitations } from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Founding Adviser Invitations — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default async function AdminInvitationsPage() {
  const cookieStore = await cookies();
  const user = await getSessionUserFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!isAdminUser(user)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-cloak-bg px-5 text-cloak-text">
        <div className="max-w-sm text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cloak-gold">{BRAND.uppercaseName}</p>
          <h1 className="cloak-display mt-3 text-2xl font-medium">Admin access required</h1>
          <p className="mt-3 text-sm leading-relaxed text-cloak-text-secondary">
            Sign in with an account listed in `CLOAQ_ADMIN_HANDLES` or `CLOAQ_ADMIN_USER_IDS`.
          </p>
        </div>
      </main>
    );
  }
  const invitations = await listAdviserInvitations();
  return <AdviserInvitationsAdmin initialInvitations={invitations} />;
}
