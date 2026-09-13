"use client";

/*
 * Direct-settlement checkout (USDC direct-settlement spec §10-§11, §14-§20,
 * §42-§43, §45, §69, §71, §78).
 *
 * Premium, restrained checkout for individual memberships:
 *   request -> QR + address + exact amount + Open Wallet + Copy + verify.
 *
 * Everything payable comes from POST /api/payments/request: the amount
 * (server SKU map, §53 — never client arithmetic), a unique reference key
 * (§16 Option B, embedded in the Solana Pay URI), and the expiry (§15).
 * The QR encodes the full Solana Pay URI so a scanning wallet pre-fills
 * amount + token + reference. Wallet connection is never required (§18);
 * the paying wallet never becomes a Cloak identity (§6). Verification
 * posts the tx signature with the request id to /api/payments/verify,
 * which settles the claim + entitlement server-side.
 *
 * Design rules (§71): near-black surfaces, restrained gold, no crypto
 * clichés, no emoji, AnimateIcons Lucide only, QR fallback text, copyable
 * details, visible expiry, honest states — never a fake success.
 *
 * All transient state lives in CheckoutBody, which Radix unmounts whenever
 * the dialog closes — every open starts from a clean slate with no reset
 * effects.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstallPWAButton } from "@/components/cloak/pwa/install-pwa-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { useCloakStore } from "@/stores/cloak-store";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  TimerIcon,
  TriangleAlertIcon,
  WalletIcon,
} from "@animateicons/react/lucide";
import type { MembershipEntitlement } from "@/lib/cloak/types";
import {
  TREASURY_ADDRESS,
  isValidTxSignature,
  solscanTxUrl,
  type IndividualMembershipSku,
} from "@/lib/cloak/payments";

const PLAN_TITLES: Record<IndividualMembershipSku, string> = {
  private: "Cloak Private",
  reserve: "Cloak Reserve",
};

interface PaymentRequestPayload {
  id: string;
  sku: IndividualMembershipSku;
  reference: string;
  amountAtomic: string;
  amountDisplay: string;
  address: string;
  payUri: string;
  payQrDataUrl: string | null;
  expiresAt: number; // epoch ms
}

export function UsdcCheckoutDialog({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: IndividualMembershipSku;
}) {
  const title = PLAN_TITLES[plan];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RiseDialogContent className="max-h-[88dvh] overflow-y-auto border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="cloak-display text-xl">{title}</DialogTitle>
          <DialogDescription className="text-cloak-text-secondary">
            One-time settlement in USDC. Solana.
          </DialogDescription>
        </DialogHeader>
        {open && <CheckoutBody key={plan} plan={plan} onClose={() => onOpenChange(false)} />}
      </RiseDialogContent>
    </Dialog>
  );
}

type Phase = "loading" | "details" | "verifying" | "account" | "confirmed" | "problem";

interface VerifyOutcome {
  status: string;
  message: string;
  solscanUrl?: string;
  claimToken?: string;
  membership?: IndividualMembershipSku;
  setupExpiresAt?: number;
}

function CheckoutBody({
  plan,
  onClose,
}: {
  plan: IndividualMembershipSku;
  onClose: () => void;
}) {
  const authUser = useCloakStore((s) => s.auth.user);
  const register = useCloakStore((s) => s.register);
  const setMembershipEntitlement = useCloakStore((s) => s.setMembershipEntitlement);

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState<PaymentRequestPayload | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const [signature, setSignature] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copiedField, setCopiedField] = useState<
    "address" | "amount" | "reference" | "payUri" | "details" | null
  >(null);
  const copiedTimer = useRef<number | null>(null);

  const title = PLAN_TITLES[plan];

  /* Open the server-side payment request on mount (every dialog open). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku: plan }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          request?: PaymentRequestPayload;
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.request) {
          setLoadError(json.message ?? "Cloak could not open a payment request. Try again.");
          setPhase("problem");
          return;
        }
        setRequest(json.request);
        setSecondsLeft(Math.max(0, Math.floor((json.request.expiresAt - Date.now()) / 1000)));
        setPhase("details");
      } catch {
        if (!cancelled) {
          setLoadError("Cloak could not reach the payment service. Try again.");
          setPhase("problem");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  /* Expiry countdown from the server's expiresAt (spec §15). */
  useEffect(() => {
    if (phase === "confirmed" || phase === "loading") return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    []
  );

  const expired = phase === "details" && secondsLeft === 0;
  const amountDisplay = request?.amountDisplay ?? "—";

  const copy = async (
    text: string,
    field: "address" | "amount" | "reference" | "payUri" | "details"
  ) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* Clipboard unavailable (permissions/insecure context) — the visible
       * selectable text remains the accessible fallback (spec §78). */
      return;
    }
    setCopiedField(field);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedField(null), 2000);
  };

  const copyPaymentDetails = () =>
    copy(
      [
        `Membership: ${title}`,
        `Amount: ${amountDisplay} USDC`,
        "Network: Solana (native USDC)",
        `Address: ${TREASURY_ADDRESS}`,
        `Reference: ${request?.reference ?? ""}`,
        `Solana Pay URI: ${request?.payUri ?? ""}`,
      ].join("\n"),
      "details"
    );

  const verify = async () => {
    const sig = signature.trim();
    if (!sig || !request || expired || phase === "verifying") return;
    setPhase("verifying");
    setOutcome(null);
    try {
      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, signature: sig }),
      });
      const data = (await res.json()) as VerifyOutcome & { entitlement?: MembershipEntitlement };
      setOutcome(data);
      if (data.status === "confirmed" && data.entitlement) {
        /* The server settled the claim + entitlement; mirror its response. */
        setMembershipEntitlement(data.entitlement);
        setPhase("confirmed");
      } else if (data.status === "confirmed" && data.claimToken) {
        setClaimToken(data.claimToken);
        setPhase("account");
      } else if (data.status === "confirming" || data.status === "not_found") {
        setPhase("details"); // still awaiting the network — allow retry
      } else {
        setPhase("problem");
      }
    } catch {
      setOutcome({
        status: "network_error",
        message:
          "Cloak could not reach the verification service. Your payment may still confirm — try again.",
      });
      setPhase("problem");
    }
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!claimToken || accountBusy) return;
    if (!handle.trim() || password.length < 8) {
      setAccountError("Choose a Cloak ID and a passphrase of at least 8 characters.");
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    const result = await register(handle.trim(), password, displayName.trim() || undefined, undefined, claimToken);
    setAccountBusy(false);
    if (result.ok) {
      setAccountCreated(true);
      setPhase("confirmed");
      return;
    }
    const copy: Record<string, string> = {
      bad_handle: "Cloak IDs are 3-24 characters using letters, numbers, and underscores.",
      bad_password: "Passphrases are 8-256 characters.",
      handle_taken: "That Cloak ID is already taken. Choose another, or sign in.",
      payment_claim_invalid: "That payment setup link is invalid, expired, or already used.",
      membership_required: "Payment verification is required before account creation.",
      rate_limited: "Too many attempts. Wait a few minutes and try again.",
      server_error: "Something went wrong on our side. Try again.",
    };
    setAccountError(copy[result.error] ?? copy.server_error);
    setPassword("");
  };

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-cloak-text-secondary">
        <LoaderCircleIcon size={15} className="animate-spin" />
        Opening your payment request…
      </div>
    );
  }

  if (phase === "confirmed") {
    /* Receipt (spec §45) */
    return (
      <div className="space-y-4" role="status">
        <div className="rounded-lg border border-cloak-success/30 bg-cloak-success/10 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-cloak-success">
            <CircleCheckIcon size={16} className="shrink-0" />
            Payment confirmed
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-cloak-text-secondary">
            {accountCreated ? "Your Cloak ID is ready." : `${title} is ready.`}
          </p>
        </div>
        <dl className="space-y-2.5 rounded-lg border border-cloak-border bg-cloak-surface px-4 py-4 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-cloak-text-muted">Amount</dt>
            <dd className="font-medium text-cloak-text">{amountDisplay} USDC</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-cloak-text-muted">Network</dt>
            <dd className="font-medium text-cloak-text">Solana</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-cloak-text-muted">Membership</dt>
            <dd className="font-medium text-cloak-text">One-time</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-cloak-text-muted">Renewal</dt>
            <dd className="font-medium text-cloak-text">Never</dd>
          </div>
          {plan === "reserve" && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-cloak-text-muted">Private grants</dt>
              <dd className="font-medium text-cloak-text">10 included</dd>
            </div>
          )}
        </dl>
        {outcome?.solscanUrl && (
          <a
            href={outcome.solscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-cloak-text-secondary transition-colors hover:text-cloak-gold"
          >
            <ExternalLinkIcon size={12} />
            Transaction — view details on Solscan
          </a>
        )}
        <p className="text-[11.5px] leading-relaxed text-cloak-text-muted">
          Your payment wallet is not your Cloak identity. Use your Cloak ID and
          passphrase whenever you sign in on a trusted device.
        </p>
        {accountCreated && (
          <div className="rounded-lg border border-cloak-border bg-cloak-surface p-3.5">
            <p className="text-[12.5px] font-medium text-cloak-text">Install Cloak</p>
            <p className="mt-1 text-[12px] leading-relaxed text-cloak-text-secondary">
              Add Cloak to your device before opening the chat app.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <InstallPWAButton
                size="sm"
                variant="gold"
                className="h-10 w-full justify-center"
                label="Install PWA"
              />
              <Button
                variant="outline"
                className="h-10 border-cloak-border-strong text-[13px] text-cloak-text hover:bg-cloak-surface"
                onClick={() => {
                  onClose();
                  window.location.hash = "#/app/messages";
                }}
              >
                Open Cloak
              </Button>
            </div>
          </div>
        )}
        <Button
          className="cloak-cta-gold h-11 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310]"
          onClick={() => {
            onClose();
            if (authUser) window.location.hash = "#/app/messages";
          }}
        >
          {accountCreated ? "Done" : authUser ? "Open Cloak" : "Done"}
        </Button>
      </div>
    );
  }

  if (phase === "account") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-cloak-success/30 bg-cloak-success/10 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-cloak-success">
            <CircleCheckIcon size={16} className="shrink-0" />
            Payment confirmed
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-cloak-text-secondary">
            Create your Cloak ID and passphrase to activate {title}.
          </p>
        </div>

        <form onSubmit={createAccount} className="space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
              Cloak ID
            </span>
            <Input
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setAccountError(null);
              }}
              placeholder="your-name"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
              Display name
            </span>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How you appear to others"
              autoComplete="nickname"
              className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
              Passphrase
            </span>
            <Input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAccountError(null);
              }}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
            />
          </label>

          {accountError && (
            <div
              role="alert"
              className="flex items-start gap-1.5 rounded-lg border border-cloak-danger/25 bg-cloak-danger/5 px-3 py-2.5 text-[12.5px] leading-relaxed text-cloak-danger"
            >
              <TriangleAlertIcon size={13} className="mt-0.5 shrink-0" />
              {accountError}
            </div>
          )}

          <Button
            type="submit"
            disabled={accountBusy}
            className="cloak-cta-gold h-11 w-full border border-black/20 text-sm font-medium text-[#141310] hover:text-[#141310]"
          >
            {accountBusy ? (
              <LoaderCircleIcon size={15} className="mr-1.5 animate-spin" />
            ) : (
              <KeyRoundIcon size={15} className="mr-1.5" />
            )}
            Create Cloak ID
          </Button>
        </form>
      </div>
    );
  }

  if (phase === "problem" && !request) {
    /* The payment request itself failed to open — honest retry, or the
       honest retry. */
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-lg border border-cloak-warning/30 bg-cloak-warning/10 p-3.5">
          <p className="text-[12.5px] font-medium text-cloak-warning">Request unavailable</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-secondary">{loadError}</p>
        </div>
        <Button
          variant="outline"
          className="h-10 w-full border-cloak-border-strong text-[13px] text-cloak-text hover:bg-cloak-surface"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Settlement summary (spec §19) */}
      <div className="flex items-center justify-between rounded-lg border border-cloak-border bg-cloak-surface px-4 py-3">
        <div>
          <p className="text-sm font-medium text-cloak-text">USDC · Solana</p>
          <p className="mt-0.5 text-[11.5px] text-cloak-text-muted">
            Recommended · Fast settlement · Low network fees
          </p>
        </div>
        <ShieldCheckIcon size={18} className="shrink-0 text-cloak-gold" />
      </div>

      {/* QR + address — the dynamic QR encodes THIS request's Solana Pay
          URI (amount + token + reference). */}
      <div className="flex flex-col items-center gap-3 rounded-lg border border-cloak-border bg-cloak-bg px-4 py-5">
        <div className="rounded-xl bg-white p-2.5">
          {request?.payQrDataUrl ? (
            <img
              src={request.payQrDataUrl}
              alt={`Payment QR for ${amountDisplay} USDC to the Cloak treasury on Solana`}
              width={168}
              height={168}
              className="h-[168px] w-[168px]"
            />
          ) : (
            <div className="grid h-[168px] w-[168px] place-items-center bg-cloak-bg px-4 text-center text-[11px] leading-relaxed text-cloak-text-secondary">
              QR unavailable. Use Open wallet or copy the Solana Pay URI.
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-cloak-text-muted">
          <QrCodeIcon size={13} className="shrink-0" />
          Scan with a Solana wallet — amount, token, recipient and reference pre-filled
        </div>

        <div className="w-full space-y-2">
          <CopyRow
            label="Address"
            value={TREASURY_ADDRESS}
            mono
            copied={copiedField === "address"}
            onCopy={() => copy(TREASURY_ADDRESS, "address")}
          />
          <CopyRow
            label="Exact amount"
            value={`${amountDisplay} USDC`}
            copied={copiedField === "amount"}
            onCopy={() => copy(amountDisplay, "amount")}
          />
          <CopyRow
            label="Reference"
            value={request?.reference ?? "—"}
            mono
            copied={copiedField === "reference"}
            onCopy={() => request?.reference && copy(request.reference, "reference")}
          />
          <CopyRow
            label="Solana Pay URI"
            value={request?.payUri ?? "—"}
            mono
            copied={copiedField === "payUri"}
            onCopy={() => request?.payUri && copy(request.payUri, "payUri")}
          />
        </div>
      </div>

      {/* Actions (spec §17: QR / Open Wallet / Copy) */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          asChild
          disabled={!request}
          className="cloak-cta-gold h-10 border border-black/20 text-[13px] font-medium text-[#141310] hover:text-[#141310]"
        >
          <a href={request?.payUri ?? "#"}>
            <WalletIcon size={15} className="mr-1.5" />
            Open wallet
          </a>
        </Button>
        <Button
          variant="outline"
          className="h-10 border-cloak-border-strong text-[13px] text-cloak-text hover:bg-cloak-surface"
          onClick={copyPaymentDetails}
        >
          {copiedField === "details" ? (
            <CheckIcon size={15} className="mr-1.5 text-cloak-success" />
          ) : (
            <CopyIcon size={15} className="mr-1.5" />
          )}
          {copiedField === "details" ? "Copied" : "Copy payment details"}
        </Button>
      </div>

      {/* Warning + network fee (spec §42, §43) */}
      <div className="rounded-lg border border-cloak-warning/30 bg-cloak-warning/10 p-3.5">
        <div className="flex items-start gap-2 text-[12.5px] font-medium leading-relaxed text-cloak-warning">
          <TriangleAlertIcon size={14} className="mt-0.5 shrink-0" />
          Send native USDC on Solana only. Sending another asset or using the wrong
          network may result in loss of funds. Automated activation requires this
          payment request&apos;s reference.
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-cloak-text-muted">
        <InfoIcon size={12} className="shrink-0" />
        Network fee is paid in SOL by your wallet. A small amount of SOL may be required.
      </div>

      {/* Expiry (spec §15) */}
      <div
        className={cn(
          "flex items-center gap-1.5 text-[12px]",
          expired ? "text-cloak-warning" : "text-cloak-text-muted"
        )}
        aria-live="polite"
      >
        {expired ? <TimerIcon size={13} className="shrink-0" /> : <ClockIcon size={13} className="shrink-0" />}
        {expired
          ? "This payment request has expired. Restart it to refresh the details, then pay again."
          : `Payment request expires in ${mm}:${ss}`}
      </div>

      {/* Verify (spec §20) */}
      {expired ? (
        <Button
          variant="outline"
          className="h-10 w-full border-cloak-border-strong text-[13px] text-cloak-text hover:bg-cloak-surface"
          onClick={() => window.location.reload()}
        >
          Restart payment request
        </Button>
      ) : (
        <div className="space-y-2 border-t border-cloak-border pt-4">
          <p className="text-[12.5px] font-medium text-cloak-text">Already paid? Verify your transaction</p>
          <div className="flex gap-2">
            <Input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="Paste transaction signature"
              aria-label="Transaction signature"
              spellCheck={false}
              className="h-10 border-cloak-border bg-cloak-bg font-mono text-[12px] text-cloak-text placeholder:font-sans placeholder:text-cloak-text-muted"
            />
            <Button
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-10 shrink-0 border border-cloak-gold/30 px-4 text-[13px] font-medium text-cloak-gold hover:text-cloak-gold"
              onClick={verify}
              disabled={!signature.trim() || phase === "verifying"}
            >
              {phase === "verifying" ? (
                <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />
              ) : (
                <ShieldCheckIcon size={14} className="mr-1.5" />
              )}
              Verify
            </Button>
          </div>
          {isValidTxSignature(signature) && (
            <a
              href={solscanTxUrl(signature.trim())}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] text-cloak-text-muted transition-colors hover:text-cloak-gold"
            >
              <ExternalLinkIcon size={11} />
              Inspect this transaction on Solscan
            </a>
          )}
          {phase === "problem" && outcome && (
            <div role="status" className="rounded-lg border border-cloak-warning/30 bg-cloak-warning/10 p-3.5">
              <p className="text-[12.5px] font-medium text-cloak-warning">
                {outcome.status.replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-secondary">
                {outcome.message}
              </p>
              {outcome.solscanUrl && (
                <a
                  href={outcome.solscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[12px] text-cloak-text-secondary underline-offset-2 transition-colors hover:text-cloak-gold hover:underline"
                >
                  <ExternalLinkIcon size={11} />
                  View on Solscan
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Copyable detail row ---------- */

function CopyRow({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-cloak-border bg-cloak-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10.5px] uppercase tracking-wide text-cloak-text-muted">{label}</p>
        <p
          className={cn("truncate text-[12.5px] text-cloak-text", mono && "font-mono text-[11.5px]")}
          title={value}
        >
          {value}
        </p>
      </div>
      <button
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold"
      >
        {copied ? <CheckIcon size={13} className="text-cloak-success" /> : <CopyIcon size={13} />}
      </button>
    </div>
  );
}
