"use client";

import { useEffect, useState } from "react";
import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRAND } from "@/lib/cloak/config";
import { useCloakStore } from "@/stores/cloak-store";
import { InfoIcon, KeyRoundIcon, LoaderCircleIcon, MailIcon, ShieldCheckIcon } from "@animateicons/react/lucide";

type InviteState =
  | { kind: "checking" }
  | {
      kind: "valid";
      recipientName: string;
      maskedRecipientEmail: string;
      membershipName: string;
      emailBindingRequired: boolean;
      expiresAt: string;
    }
  | { kind: "invalid"; status: "invalid" | "expired" | "redeemed" | "revoked" }
  | { kind: "redeeming" }
  | { kind: "success" }
  | { kind: "blocked"; error: string };

const INVALID_COPY: Record<string, string> = {
  invalid: "This invitation link is not valid. Check the link you were sent, or ask for a fresh invitation.",
  expired: "This invitation has expired. Ask Kudzayi for a new link.",
  redeemed: "This invitation has already been accepted. Adviser invitations are single-use.",
  revoked: "This invitation is no longer available.",
};

const REDEEM_ERROR_COPY: Record<string, string> = {
  email_binding_required: "Enter the email address this invitation was sent to.",
  email_already_used: "That email is already attached to another account. Sign in to that account and try again.",
  recipient_already_private: `Your account already has ${BRAND.cloakPrivate} access. The invitation was not consumed.`,
  recipient_already_reserve: `Your account already has ${BRAND.cloakReserve}. The invitation was not consumed.`,
  already_redeemed: "This invitation has already been accepted.",
  already_expired: "This invitation has expired.",
  already_revoked: "This invitation is no longer available.",
};

export function AdviserInvitePage({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteState>({ kind: "checking" });
  const [mode, setMode] = useState<"register" | "signin">("register");
  const authChecked = useCloakStore((s) => s.auth.checked);
  const authUser = useCloakStore((s) => s.auth.user);
  const bootstrapAuth = useCloakStore((s) => s.bootstrapAuth);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/adviser-invitations/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        invitation?: {
          found: boolean;
          status?: string;
          recipientName?: string;
          maskedRecipientEmail?: string;
          membershipName?: string;
          emailBindingRequired?: boolean;
          expiresAt?: string;
        };
      };
      if (cancelled) return;
      const found = json.invitation;
      if (!json.ok || !found?.found) {
        setInvite({ kind: "invalid", status: "invalid" });
      } else if (found.status === "pending" && found.recipientName && found.maskedRecipientEmail && found.expiresAt) {
        setInvite({
          kind: "valid",
          recipientName: found.recipientName,
          maskedRecipientEmail: found.maskedRecipientEmail,
          membershipName: found.membershipName ?? BRAND.cloakPrivate,
          emailBindingRequired: found.emailBindingRequired !== false,
          expiresAt: found.expiresAt,
        });
      } else {
        setInvite({
          kind: "invalid",
          status:
            found.status === "expired" ? "expired" :
            found.status === "redeemed" ? "redeemed" :
            found.status === "revoked" ? "revoked" : "invalid",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cloak-bg px-5 py-12 text-cloak-text">
      <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-md">
        <div className="mb-9 flex items-center justify-center gap-3">
          <CloakLogoImage size={34} />
          <span className="cloak-wordmark text-3xl">{BRAND.name}</span>
        </div>

        {invite.kind === "checking" && <LoadingCopy text="Checking your private invitation..." />}
        {invite.kind === "redeeming" && <LoadingCopy text="Activating your membership..." />}

        {invite.kind === "invalid" && (
          <Panel icon={<InfoIcon size={20} />} title="Invitation unavailable">
            <p className="text-sm leading-relaxed text-cloak-text-secondary">{INVALID_COPY[invite.status]}</p>
            <Button className="mt-7 h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={() => { window.location.href = "/"; }}>
              Open {BRAND.name}
            </Button>
          </Panel>
        )}

        {invite.kind === "blocked" && (
          <Panel icon={<InfoIcon size={20} />} title="Invitation not applied">
            <p className="text-sm leading-relaxed text-cloak-text-secondary">{REDEEM_ERROR_COPY[invite.error] ?? "This invitation could not be redeemed."}</p>
            <Button className="mt-7 h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={() => { window.location.href = "/messages"; }}>
              Open {BRAND.name}
            </Button>
          </Panel>
        )}

        {invite.kind === "success" && (
          <Panel icon={<ShieldCheckIcon size={20} />} title={`Welcome to ${BRAND.name}`}>
            <p className="text-sm leading-relaxed text-cloak-text-secondary">
              Your complimentary {BRAND.cloakPrivate} membership is active.
            </p>
            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Access" value="Founding Adviser" />
              <Row label="Payment" value="Not required" />
              <Row label="Renewal" value="Never" />
            </dl>
            <Button className="mt-7 h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={() => { window.location.href = "/messages"; }}>
              Open {BRAND.name}
            </Button>
          </Panel>
        )}

        {invite.kind === "valid" && authChecked && (
          <Panel icon={<MailIcon size={20} />} title="Private invitation">
            <p className="text-sm leading-relaxed text-cloak-text-secondary">
              You&apos;ve been invited to evaluate {BRAND.name} as a Founding Adviser.
            </p>
            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Membership" value={`${invite.membershipName} already provided`} />
              <Row label="Recipient" value={`${invite.recipientName} (${invite.maskedRecipientEmail})`} />
              <Row label="Expires" value={formatDate(invite.expiresAt)} />
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-cloak-text-muted">
              No payment is required. This link is single-use and can only grant the membership chosen by the server.
            </p>

            {authUser ? (
              <SignedInRedeem
                token={token}
                emailBindingRequired={invite.emailBindingRequired}
                onRedeeming={() => setInvite({ kind: "redeeming" })}
                onSuccess={() => setInvite({ kind: "success" })}
                onBlocked={(error) => setInvite({ kind: "blocked", error })}
              />
            ) : (
              <>
                <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-cloak-border bg-cloak-bg p-1">
                  <button className={tabClass(mode === "register")} onClick={() => setMode("register")}>New account</button>
                  <button className={tabClass(mode === "signin")} onClick={() => setMode("signin")}>Sign in</button>
                </div>
                {mode === "register" ? (
                  <RegisterRedeem
                    token={token}
                    emailBindingRequired={invite.emailBindingRequired}
                    onSuccess={() => setInvite({ kind: "success" })}
                    onBlocked={(error) => setInvite({ kind: "blocked", error })}
                  />
                ) : (
                  <SignInRedeem
                    token={token}
                    emailBindingRequired={invite.emailBindingRequired}
                    onRedeeming={() => setInvite({ kind: "redeeming" })}
                    onSuccess={() => setInvite({ kind: "success" })}
                    onBlocked={(error) => setInvite({ kind: "blocked", error })}
                  />
                )}
              </>
            )}
          </Panel>
        )}
      </div>
    </main>
  );
}

function SignedInRedeem({
  token,
  emailBindingRequired,
  onRedeeming,
  onSuccess,
  onBlocked,
}: {
  token: string;
  emailBindingRequired: boolean;
  onRedeeming: () => void;
  onSuccess: () => void;
  onBlocked: (error: string) => void;
}) {
  const [email, setEmail] = useState("");
  async function redeem() {
    onRedeeming();
    const res = await fetch(`/api/adviser-invitations/${encodeURIComponent(token)}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || undefined }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (json.ok) onSuccess();
    else onBlocked(json.error ?? "unknown_token");
  }
  return (
    <div className="mt-6 space-y-3">
      {emailBindingRequired && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Confirm invited email</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="border-cloak-border bg-cloak-bg text-cloak-text" />
        </label>
      )}
      <Button className="h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={() => void redeem()}>
        Accept Invitation
      </Button>
    </div>
  );
}

function RegisterRedeem({
  token,
  emailBindingRequired,
  onSuccess,
  onBlocked,
}: {
  token: string;
  emailBindingRequired: boolean;
  onSuccess: () => void;
  onBlocked: (error: string) => void;
}) {
  const register = useCloakStore((s) => s.register);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await register(handle, password, displayName || undefined, undefined, undefined, token, email);
    setBusy(false);
    if (result.ok) onSuccess();
    else {
      setError(REDEEM_ERROR_COPY[result.error] ?? result.error);
      if (result.error.startsWith("already_") || result.error.startsWith("recipient_")) onBlocked(result.error);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      {emailBindingRequired && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Invited email</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="border-cloak-border bg-cloak-bg text-cloak-text" />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">{BRAND.cloakId}</span>
        <Input value={handle} onChange={(e) => setHandle(e.target.value)} required placeholder="your-name" className="border-cloak-border bg-cloak-bg text-cloak-text" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Display name</span>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How you appear to others" className="border-cloak-border bg-cloak-bg text-cloak-text" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Passphrase</span>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="border-cloak-border bg-cloak-bg text-cloak-text" />
      </label>
      {error && <p className="text-xs text-cloak-warning">{error}</p>}
      <Button disabled={busy} className="h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright">
        {busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
        Create Cloaq ID & accept
      </Button>
    </form>
  );
}

function SignInRedeem(props: {
  token: string;
  emailBindingRequired: boolean;
  onRedeeming: () => void;
  onSuccess: () => void;
  onBlocked: (error: string) => void;
}) {
  const signIn = useCloakStore((s) => s.signIn);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(handle, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error === "invalid_credentials" ? "That Cloaq ID and passphrase do not match." : "Sign-in failed. Try again.");
      return;
    }
    setSignedIn(true);
  }

  if (signedIn) {
    return <SignedInRedeem {...props} />;
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">{BRAND.cloakId}</span>
        <Input value={handle} onChange={(e) => setHandle(e.target.value)} required className="border-cloak-border bg-cloak-bg text-cloak-text" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Passphrase</span>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="border-cloak-border bg-cloak-bg text-cloak-text" />
      </label>
      {error && <p className="text-xs text-cloak-warning">{error}</p>}
      <Button disabled={busy} className="h-11 w-full border border-cloak-border bg-cloak-bg text-cloak-text hover:bg-cloak-surface">
        {busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-cloak-border bg-cloak-bg-elevated p-6 shadow-none">
      <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
        {icon}
      </span>
      <h1 className="cloak-display text-2xl font-medium">{title}</h1>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function LoadingCopy({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-2 text-sm text-cloak-text-secondary">
      <LoaderCircleIcon size={15} className="animate-spin" />
      {text}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-cloak-text-secondary">{label}</dt>
      <dd className="text-right text-cloak-text">{value}</dd>
    </div>
  );
}

function tabClass(active: boolean) {
  return active
    ? "rounded-md bg-cloak-gold-soft px-3 py-2 text-xs font-medium text-cloak-gold"
    : "rounded-md px-3 py-2 text-xs font-medium text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}
