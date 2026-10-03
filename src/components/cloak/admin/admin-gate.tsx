import { BRAND } from "@/lib/cloak/config";

/*
 * The refusal shown when a signed-in account is not an operator.
 *
 * Shared by every `/admin` screen so the two cannot drift into disagreeing
 * about what an operator is — and so that a new screen cannot quietly ship
 * without one. The authorization *decision* is never made here: callers run
 * `isAdminUser` on the server first and render this only on the negative
 * branch. Rendering it is the consequence of the check, not the check.
 *
 * It names the env vars on purpose. The only person who should ever see this
 * page is the founder, and "which variable do I set" is the only question it
 * can usefully answer.
 */
export function AdminGate() {
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
