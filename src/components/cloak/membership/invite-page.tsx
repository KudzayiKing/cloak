"use client";

/*
 * InvitePage — #/invite/[token] (pricing & membership update spec §9, §41-§43).
 *
 * Flow: open invite -> validate token against the server (no auth needed —
 * the 256-bit token in the link IS the capability) -> show invitation ->
 * accept -> consume the pass server-side -> grant Cloaq Private -> open
 * /messages.
 *
 * Recipients without an account register INLINE (Cloaq ID + passphrase);
 * the token rides along so the pass redeems atomically at account
 * creation. No wallet, no payment, no Cloaq ID beforehand — a pre-payment
 * guest cannot have one. Redeemed, expired, revoked, and unknown tokens
 * receive honest states — never a silent fallback.
 */

import { useEffect, useState } from "react";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { membershipService } from "@/lib/cloak/membership-service";
import { BRAND } from "@/lib/cloak/config";
import { LoaderCircleIcon, ShieldCheckIcon, InfoIcon, MailIcon } from "@animateicons/react/lucide";
import type { MembershipEntitlement } from "@/lib/cloak/types";

type Phase =
  | { kind: "checking" }
  | { kind: "invitation"; inviterName: string; expiresAt?: string }
  | { kind: "activating" }
  | { kind: "active" }
  | { kind: "invalid"; reason: "unknown_token" | "already_redeemed" | "already_expired" | "already_revoked" }
  | { kind: "blocked"; reason: "recipient_already_private" | "recipient_already_reserve" };

const REASON_COPY: Record<Phase extends { kind: "invalid"; reason: infer R } ? R : never, string> = {
  unknown_token: "This invitation link is not valid. Check the link you were sent, or ask the person who invited you to resend it.",
  already_redeemed: "This invitation has already been accepted. A redeemed pass is permanently used and cannot be redeemed twice.",
  already_expired: "This invitation expired before it was accepted. Ask the member who invited you to send a new one.",
  already_revoked: "This invitation was revoked before it was accepted.",
};

export function InvitePage({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const authChecked = useCloakStore((s) => s.auth.checked);
  const authUser = useCloakStore((s) => s.auth.user);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) setPhase({ kind: "invalid", reason: "unknown_token" });
        return;
      }
      const lookup = await membershipService.lookupInvite?.(token);
      if (cancelled) return;
      if (!lookup || !lookup.found) {
        setPhase({ kind: "invalid", reason: "unknown_token" });
        return;
      }
      if (lookup.status === "redeemed") {
        setPhase({ kind: "invalid", reason: "already_redeemed" });
      } else if (lookup.status === "expired") {
        setPhase({ kind: "invalid", reason: "already_expired" });
      } else if (lookup.status === "revoked") {
        setPhase({ kind: "invalid", reason: "already_revoked" });
      } else if (lookup.status === "pending") {
        setPhase({
          kind: "invitation",
          inviterName: lookup.inviterName ?? "A Cloaq Reserve member",
          expiresAt: lookup.expiresAt,
        });
      } else {
        setPhase({ kind: "invalid", reason: "unknown_token" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const done = () => setPhase({ kind: "active" });

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
          aria-label={`${BRAND.name} — home`}
          className="mx-auto mb-10 flex items-center gap-2.5 text-cloak-text transition-opacity hover:opacity-85"
        >
          {/* The white C-bubble artwork (/cloak-logo.svg) — brand rule. */}
          <CloakLogoImage size={24} />
          <span className="cloak-wordmark text-2xl text-cloak-text">{BRAND.name}</span>
        </button>

        {phase.kind === "checking" && (
          <p className="flex items-center justify-center gap-2 text-sm text-cloak-text-secondary">
            <LoaderCircleIcon size={15} className="animate-spin" />
            Checking your invitation…
          </p>
        )}

        {phase.kind === "invitation" && !authChecked && (
          <p className="flex items-center justify-center gap-2 text-sm text-cloak-text-secondary">
            <LoaderCircleIcon size={15} className="animate-spin" />
            Checking your invitation…
          </p>
        )}

        {phase.kind === "invitation" && authChecked && (
          authUser ? (
            <SignedInAccept
              token={token}
              inviterName={phase.inviterName}
              onActivating={() => setPhase({ kind: "activating" })}
              onDone={done}
              onPhase={setPhase}
            />
          ) : (
            <GuestRegister
              token={token}
              inviterName={phase.inviterName}
              onDone={done}
              onPhase={setPhase}
            />
          )
        )}

        {phase.kind === "activating" && (
          <p className="flex items-center justify-center gap-2 text-sm text-cloak-text-secondary">
            <LoaderCircleIcon size={15} className="animate-spin" />
            Activating your membership…
          </p>
        )}

        {phase.kind === "active" && (
          <div className="cloak-message-in rounded-2xl border border-cloak-gold/25 bg-cloak-bg-elevated p-7 text-center md:p-9">
            <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
              <ShieldCheckIcon size={20} />
            </span>
            <h1 className="cloak-display text-2xl font-medium text-cloak-text">Cloaq Private</h1>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-cloak-success">
              <ShieldCheckIcon size={14} />
              Active
            </div>
            <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
              Granted through Cloaq Reserve.
              <br />
              Lifetime core access.
            </p>
            <Button
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-8 h-12 w-full border border-cloak-gold/30 text-[15px] font-medium text-cloak-gold hover:text-cloak-gold"
              onClick={() => navigate("/app/messages")}
            >
              Open Cloaq
            </Button>
          </div>
        )}

        {phase.kind === "invalid" && (
          <div className="cloak-message-in rounded-2xl border border-cloak-border bg-cloak-bg-elevated p-7 text-center md:p-9">
            <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-2xl border border-cloak-border bg-cloak-surface text-cloak-text-muted">
              <InfoIcon size={20} />
            </span>
            <h1 className="cloak-display text-xl font-medium text-cloak-text">
              Invitation unavailable
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
              {REASON_COPY[phase.reason]}
            </p>
            <Button
              variant="outline"
              className="mt-8 h-11 w-full border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              onClick={() => navigate("/")}
            >
              Open Cloaq
            </Button>
          </div>
        )}

        {phase.kind === "blocked" && (
          <div className="cloak-message-in rounded-2xl border border-cloak-warning/25 bg-cloak-bg-elevated p-7 text-center md:p-9">
            <h1 className="cloak-display text-xl font-medium text-cloak-text">
              {phase.reason === "recipient_already_reserve"
                ? "This account already holds Cloaq Reserve."
                : "This account already has Cloaq Private."}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
              {phase.reason === "recipient_already_reserve"
                ? "A Private invitation cannot alter a Reserve membership. The pass was not used."
                : "To avoid silently wasting the pass, nothing was consumed. If you want to use this invitation instead of your current membership, contact the person who invited you."}
            </p>
            <Button
              variant="outline"
              className="mt-8 h-11 w-full border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              onClick={() => navigate("/app/messages")}
            >
              Open Cloaq
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Signed-in redemption ---------- */

function SignedInAccept({
  token,
  inviterName,
  onActivating,
  onDone,
  onPhase,
}: {
  token: string;
  inviterName: string;
  onActivating: () => void;
  onDone: () => void;
  onPhase: (phase: Phase) => void;
}) {
  const accept = async () => {
    onActivating();
    const result = (await membershipService.redeemGuestPass?.(token)) ?? {
      ok: false as const,
      error: "unknown_token",
    };
    if (result.ok) {
      onDone();
    } else if (
      result.error === "recipient_already_private" ||
      result.error === "recipient_already_reserve"
    ) {
      onPhase({ kind: "blocked", reason: result.error });
    } else {
      onPhase({
        kind: "invalid",
        reason:
          result.error === "already_redeemed" ||
          result.error === "already_expired" ||
          result.error === "already_revoked"
            ? result.error
            : "unknown_token",
      });
    }
  };

  return (
    <div className="cloak-message-in rounded-2xl border border-cloak-border bg-cloak-bg-elevated p-7 text-center md:p-9">
      <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
        <MailIcon size={20} />
      </span>
      <h1 className="cloak-display text-2xl font-medium text-cloak-text">
        You have been invited to Cloaq.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
        {inviterName} has granted you Cloaq Private membership.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
        No purchase is required. Your membership has been provided for you.
      </p>
      <Button
        className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-8 h-12 w-full border border-cloak-gold/30 text-[15px] font-medium text-cloak-gold hover:text-cloak-gold"
        onClick={accept}
      >
        Accept Cloaq Private
      </Button>
      <p className="mt-4 text-[11.5px] leading-relaxed text-cloak-text-muted">
        Cloaq Private — lifetime core access. Your account will remain
        private and independent.
      </p>
    </div>
  );
}

/* ---------- Guest registration (no account yet) ---------- */

function GuestRegister({
  token,
  inviterName,
  onDone,
  onPhase,
}: {
  token: string;
  inviterName: string;
  onDone: () => void;
  onPhase: (phase: Phase) => void;
}) {
  const register = useCloakStore((s) => s.register);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ERROR_COPY: Record<string, string> = {
    bad_handle: "Cloaq IDs are 3-24 characters using letters, numbers, and underscores.",
    bad_password: "Passphrases are 8-256 characters.",
    handle_taken: "That Cloaq ID is already taken. Choose another.",
    invite_race: "That invitation was just redeemed. Ask for a new one.",
    rate_limited: "Too many attempts. Wait a few minutes and try again.",
    network: "Cloaq could not reach the server. Check your connection.",
    server_error: "Something went wrong on our side. Try again.",
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await register(handle.trim(), password, displayName.trim() || undefined, token);
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    setError(ERROR_COPY[result.error] ?? "The account could not be created. Try again.");
  };

  return (
    <div className="cloak-message-in rounded-2xl border border-cloak-border bg-cloak-bg-elevated p-7 md:p-9">
      <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
        <MailIcon size={20} />
      </span>
      <div className="text-center">
        <h1 className="cloak-display text-2xl font-medium text-cloak-text">
          You have been invited to Cloaq.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-cloak-text-secondary">
          {inviterName} has granted you Cloaq Private membership.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-cloak-text-secondary">
          Create your Cloaq ID to accept — no wallet, no payment.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
            Cloaq ID
          </span>
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="your-name"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
            Display name (optional)
          </span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How you appear to others"
            className="h-11 border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
            Passphrase
          </span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="h-11 border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
          />
        </label>

        {error && (
          <p className="flex items-center gap-1.5 text-[12px] text-cloak-warning">
            <InfoIcon size={12} />
            {error}
          </p>
        )}

        <Button
          className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-12 w-full border border-cloak-gold/30 text-[15px] font-medium text-cloak-gold hover:text-cloak-gold"
          onClick={create}
          disabled={busy || !handle.trim() || !password}
        >
          {busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
          Create account & accept
        </Button>
        <p className="text-[11px] leading-relaxed text-cloak-text-muted">
          Cloaq Private — lifetime core access. Your account will remain
          private and independent from the person who invited you.
        </p>
      </div>
    </div>
  );
}
