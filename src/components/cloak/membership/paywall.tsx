"use client";

/*
 * Premium access screen — the paywall (pricing & membership update spec
 * §40-§41). Shown when the app is opened without an active membership.
 * Primary: Get Cloak Private. Secondary: invitation redemption — Reserve
 * invitees must be able to enter without paying.
 */

import { useState } from "react";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { CLOAK_PRICING } from "@/lib/cloak/config";
import { KeyRoundIcon, ShieldCheckIcon } from "@animateicons/react/lucide";
import { UsdcCheckoutDialog } from "./usdc-checkout-dialog";

export function PremiumAccessScreen() {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [token, setToken] = useState("");
  const authUser = useCloakStore((s) => s.auth.user);
  const signOut = useCloakStore((s) => s.signOut);

  const redeem = () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    navigate(`/invite/${trimmed}`);
  };

  /* Escape hatch — membership is per-account; a visitor stuck on this
     screen with the wrong account must be able to switch (owner ask:
     "fix this so that I can login as blake"). signOut keeps auth.checked
     true, so the app gate swaps this screen for the sign-in screen. */
  const switchAccount = async () => {
    await signOut();
    navigate("/app/messages");
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cloak-bg px-5 py-16">
      <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-cloak-gold-soft blur-[110px]"
      />

      <div className="relative w-full max-w-md">
        <button
          onClick={() => navigate("/")}
          aria-label="Cloak — home"
          className="mx-auto mb-10 flex items-center gap-2.5 text-cloak-text transition-opacity hover:opacity-85"
        >
          {/* The white C-bubble artwork (/cloak-logo.svg) — same mark as
              the sign-in screen; never the legacy arc (brand rule). */}
          <CloakLogoImage size={36} />
          <span className="cloak-wordmark text-2xl text-cloak-text">Cloak</span>
        </button>

        <div className="cloak-message-in rounded-2xl border border-cloak-border bg-cloak-bg-elevated p-7 text-center md:p-9">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-gold">
            Membership
          </p>
          <h1 className="mt-4 cloak-display text-3xl font-medium text-cloak-text">
            Cloak Private
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
            Private messaging. Private intelligence.
            <br />
            One payment.
          </p>
          <p
            className="mt-6 cloak-display text-5xl font-medium text-cloak-text"
            aria-label={`${CLOAK_PRICING.private.amount} USDC, one-time payment`}
          >
            {CLOAK_PRICING.private.amount.toLocaleString("en-US")}{" "}
            <span className="text-2xl text-cloak-text-secondary">USDC</span>
          </p>
          <p className="mt-1.5 text-[12px] text-cloak-text-muted">
            one-time · settled in native USDC on Solana
          </p>

          <Button
            className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-8 h-12 w-full border border-cloak-gold/30 text-[15px] font-medium text-cloak-gold hover:text-cloak-gold"
            onClick={() => setCheckoutOpen(true)}
          >
            Get Cloak Private
          </Button>

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-cloak-text-muted">
            <ShieldCheckIcon size={12} className="text-cloak-success" />
            Activated after on-chain payment verification
          </div>

          <div className="mt-8 border-t border-cloak-border pt-6">
            <p className="text-[13px] font-medium text-cloak-text">Have a Cloak invitation?</p>
            <div className="mt-3 flex gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && redeem()}
                placeholder="Paste your invitation link or code"
                aria-label="Invitation code"
                className="h-10 border-cloak-border bg-cloak-bg text-[12.5px] text-cloak-text placeholder:text-cloak-text-muted"
              />
              <Button
                variant="outline"
                className="h-10 shrink-0 border-cloak-border-strong px-4 text-[12.5px] text-cloak-text hover:bg-cloak-surface"
                onClick={redeem}
                disabled={!token.trim()}
              >
                <KeyRoundIcon size={13} className="mr-1.5" />
                Redeem invitation
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-cloak-text-muted">
              A redeemed invitation grants full Cloak Private membership — no
              purchase, no limited account. Your account stays private and
              independent.
            </p>
          </div>
        </div>
      </div>

      <UsdcCheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        plan="private"
      />

      {authUser && (
        <p className="relative mt-6 text-center text-[11.5px] text-cloak-text-muted">
          Signed in as @{authUser.handle}.{" "}
          <button
            onClick={switchAccount}
            className="text-cloak-text-secondary underline-offset-2 transition-colors hover:text-cloak-text hover:underline"
          >
            Sign in as a different account
          </button>
        </p>
      )}
    </div>
  );
}
