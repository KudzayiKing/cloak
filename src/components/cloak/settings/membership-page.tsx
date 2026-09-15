"use client";

/*
 * Settings > Membership (pricing & membership update spec §11-§14, §37-§38,
 * §62-§63).
 *
 * Shows the current entitlement and, for Cloaq Reserve members, the Private
 * pass management area: 10 included passes, invite flow (secure link or QR
 * — a pre-payment guest cannot have a Cloaq ID), pending/redeemed lists,
 * revocation before redemption only. All state is a mirror of the server
 * registry (/api/membership/*); nothing here is authoritative. Membership
 * is private — nothing in this surface leaks to chats, contacts, or
 * profiles (spec §15).
 */

import { useEffect, useState } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { Surface } from "@/components/cloak/shared/primitives";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import {
  ShieldCheckIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
  TicketIcon,
  ClockIcon,
  KeyRoundIcon,
  InfoIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "@animateicons/react/lucide";
import type { CloakMembership } from "@/lib/cloak/types";
import { BRAND, CLOAK_PRICING, formatUSD } from "@/lib/cloak/config";
import { UsdcCheckoutDialog } from "@/components/cloak/membership/usdc-checkout-dialog";

const MEMBERSHIP_LABELS: Record<CloakMembership, string> = {
  none: "No membership",
  private: BRAND.cloakPrivate,
  reserve: BRAND.cloakReserve,
  private_circle: "Cloaq Private Circle",
  office: "Cloaq Office",
  sovereign: "Cloaq Sovereign",
};

const ORIGIN_LABELS: Record<string, string> = {
  direct_usdc: "USDC settlement",
  reserve_guest_pass: `${BRAND.cloakReserve} invitation`,
  founding_adviser: "Founding Adviser",
  bank_transfer: "Bank transfer",
  invoice: "Invoice",
  contract: "Contract",
  admin_grant: `Granted by ${BRAND.name}`,
  purchase: "Purchased",
};

export function MembershipSection() {
  const membership = useCloakStore((s) => s.membership);
  const fetchGuestPasses = useCloakStore((s) => s.fetchGuestPasses);

  /* Keep the pass registry fresh while the surface is open. */
  useEffect(() => {
    if (membership.membership !== "reserve") return;
    void fetchGuestPasses();
    const id = window.setInterval(() => void fetchGuestPasses(), 30000);
    return () => window.clearInterval(id);
  }, [membership.membership, fetchGuestPasses]);

  return (
    <div className="space-y-6">
      <EntitlementCard />

      {membership.membership === "reserve" && <ReservePassManager />}

      {membership.membership === "private" && membership.origin === "reserve_guest_pass" && (
        <GuestGrantedCard />
      )}

      {membership.membership === "private" && membership.origin === "founding_adviser" && (
        <FoundingAdviserCard />
      )}

      {membership.membership === "private" && (
        <UpgradeCard />
      )}

      {(membership.membership === "private_circle" ||
        membership.membership === "office" ||
        membership.membership === "sovereign") && (
        <Surface className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-cloak-text">Your environment</h2>
          <p className="text-[12.5px] leading-relaxed text-cloak-text-secondary">
            {membership.membership === "office"
              ? "Your organization's membership renews annually and is managed under your organization agreement."
              : "This environment is arranged directly with Cloaq under your agreement."}
          </p>
        </Surface>
      )}
    </div>
  );
}

/* ---------- Entitlement card (spec §14, §37) ---------- */

function EntitlementCard() {
  const membership = useCloakStore((s) => s.membership);
  const passAllocation = useCloakStore((s) => s.passAllocation);
  const isReserve = membership.membership === "reserve";

  return (
    <Surface
      className={cn(
        "relative overflow-hidden p-5",
        isReserve && "border-cloak-gold/25 bg-cloak-bg-elevated"
      )}
    >
      {isReserve && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cloak-gold/60 to-transparent"
        />
      )}
      <h2
        className={cn(
          "relative cloak-display text-xl font-medium text-cloak-text",
          isReserve && "tracking-wide"
        )}
      >
        {MEMBERSHIP_LABELS[membership.membership]}
      </h2>
      <div className="relative mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-cloak-success">
        <ShieldCheckIcon size={13} />
        {membership.active ? "Active" : "Inactive"}
      </div>

      <dl className="relative mt-5 space-y-2.5 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-cloak-text-secondary">Renewal</dt>
          <dd className="text-cloak-text">
            {membership.renewal === "annual"
              ? "Annual"
              : membership.renewal === "custom"
                ? "Per agreement"
                : "Never"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-cloak-text-secondary">
            {membership.origin === "reserve_guest_pass" || membership.origin === "founding_adviser" ? "Access" : "Membership origin"}
          </dt>
          <dd className="text-cloak-text">{ORIGIN_LABELS[membership.origin] ?? membership.origin}</dd>
        </div>
        {isReserve && passAllocation && (
          <>
            <div className="flex items-center justify-between">
              <dt className="text-cloak-text-secondary">Private passes</dt>
              <dd className="text-cloak-text">
                {passAllocation.available} of {passAllocation.total} available
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-cloak-text-secondary">Support</dt>
              <dd className="text-cloak-text">Priority</dd>
            </div>
          </>
        )}
      </dl>

      {membership.membership === "none" && (
        <div className="relative mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Button
            className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-10 flex-1 border border-cloak-gold/30 text-[13px] font-medium text-cloak-gold hover:text-cloak-gold"
            onClick={() => navigate("/pricing")}
          >
            Get Cloaq Private — {formatUSD(CLOAK_PRICING.private.amount)}
          </Button>
        </div>
      )}
    </Surface>
  );
}

/* ---------- Guest-granted Private (spec §63) ---------- */

function GuestGrantedCard() {
  return (
    <Surface className="p-5">
      <h2 className="mb-2 text-sm font-semibold text-cloak-text">About your membership</h2>
      <p className="text-[13px] leading-relaxed text-cloak-text-secondary">
        Your membership was granted through a Cloaq Reserve invitation.
      </p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-cloak-text-muted">
        Your account remains private and independent. The person who invited
        you cannot access your messages, memory, devices, or unrelated
        contacts.
      </p>
    </Surface>
  );
}

function FoundingAdviserCard() {
  return (
    <Surface className="p-5">
      <h2 className="mb-2 text-sm font-semibold text-cloak-text">Founding Adviser access</h2>
      <dl className="space-y-2 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-cloak-text-secondary">Access</dt>
          <dd className="text-cloak-text">Founding Adviser</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-cloak-text-secondary">Payment</dt>
          <dd className="text-cloak-text">Not required</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-cloak-text-secondary">Renewal</dt>
          <dd className="text-cloak-text">Never</dd>
        </div>
      </dl>
      <p className="mt-3 text-[12.5px] leading-relaxed text-cloak-text-muted">
        Your adviser access is private. It is not shown on your profile,
        contacts, messages, groups, Circles, or Cloaq ID lookup.
      </p>
    </Surface>
  );
}

/* ---------- Private → Reserve upgrade (spec §38) ---------- */

function UpgradeCard() {
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  return (
    <>
      <Surface className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-cloak-text">{BRAND.cloakReserve}</h2>
        <p className="text-[12.5px] leading-relaxed text-cloak-text-secondary">
          Higher assurance, advanced device controls, priority security
          support — and 10 Cloaq Private memberships to grant to the people
          you trust.
        </p>
        <Button
          variant="outline"
          className="mt-4 h-9 border-cloak-border-strong text-[12.5px] text-cloak-text hover:bg-cloak-surface"
          onClick={() => setCheckoutOpen(true)}
        >
          Upgrade to {BRAND.cloakReserve} — {formatUSD(CLOAK_PRICING.reserve.amount)}
          <ChevronRightIcon size={13} className="ml-1" />
        </Button>
      </Surface>
      <UsdcCheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        plan="reserve"
      />
    </>
  );
}

/* ---------- Reserve pass manager (spec §11-§13, §62) ---------- */

function ReservePassManager() {
  const guestPasses = useCloakStore((s) => s.guestPasses);
  const passAllocation = useCloakStore((s) => s.passAllocation);
  const passesLoading = useCloakStore((s) => s.passesLoading);

  const pending = guestPasses.filter((p) => p.status === "issued");
  const redeemed = guestPasses.filter((p) => p.status === "redeemed");
  const availableCount = passAllocation?.available ?? 0;
  const total = passAllocation?.total ?? CLOAK_PRICING.reserve.includedPrivatePasses;

  return (
    <Surface className="p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-cloak-text">Private passes</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-gold/25 bg-cloak-gold-soft px-2.5 py-0.5 text-[10.5px] font-medium text-cloak-gold-bright">
          <TicketIcon size={11} />
          {total} included
        </span>
      </div>
      <p className="text-[12px] text-cloak-text-muted">
        Each pass grants one person full Cloaq Private lifetime core access.
        Redeemed passes cannot be reused.
      </p>

      {/* Allocation summary (spec §11: 7 available / 3 redeemed / 10 total) */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <PassStat label="Available" value={availableCount} />
        <PassStat label="Pending" value={pending.length} />
        <PassStat label="Redeemed" value={redeemed.length} />
      </div>

      <InviteDialog />

      {passesLoading && guestPasses.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-cloak-text-secondary">
          <LoaderCircleIcon size={13} className="animate-spin" />
          Loading your passes…
        </p>
      )}

      {/* Pending invites — revocable until redeemed (spec §12) */}
      {pending.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cloak-text-muted">
            Invite pending
          </p>
          <ul className="space-y-2">
            {pending.map((pass) => (
              <PassRow key={pass.id} pass={pass} />
            ))}
          </ul>
        </div>
      )}

      {/* Redeemed — permanent (spec §7: redeemed = permanently consumed) */}
      {redeemed.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cloak-text-muted">
            Redeemed
          </p>
          <ul className="space-y-2">
            {redeemed.map((pass) => (
              <PassRow key={pass.id} pass={pass} />
            ))}
          </ul>
        </div>
      )}
    </Surface>
  );
}

function PassStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-cloak-border bg-cloak-bg/60 px-3 py-2.5 text-center">
      <p className="cloak-display text-xl font-medium text-cloak-text">{value}</p>
      <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-cloak-text-muted">{label}</p>
    </div>
  );
}

function PassRow({ pass }: { pass: { id: string; status: string; expiresAt?: string; note?: string; redeemedByName?: string } }) {
  const revokeGuestPass = useCloakStore((s) => s.revokeGuestPass);
  const [confirming, setConfirming] = useState(false);
  const status = pass.status;

  const expiryLine = () => {
    if (!pass.expiresAt) return null;
    const days = Math.max(
      0,
      Math.ceil((new Date(pass.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000))
    );
    return days > 0 ? `Expires in ${days} day${days === 1 ? "" : "s"}` : "Expired";
  };

  /* The secure link exists only at issue time (spec §43: only a token hash
     is stored — the raw link is never persisted or re-derivable). Pending
     rows therefore offer revocation, not re-sharing. */
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-cloak-border bg-cloak-bg/60 px-3.5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-cloak-text">
          {pass.redeemedByName ?? "Available pass"}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cloak-text-muted">
          {status === "redeemed" ? (
            <>
              <CheckIcon size={10} className="text-cloak-success" />
              Redeemed — Cloaq Private
            </>
          ) : status === "issued" ? (
            <>
              <ClockIcon size={10} />
              Invite pending
              {expiryLine() ? ` · ${expiryLine()}` : ""}
            </>
          ) : (
            "Ready to assign"
          )}
        </div>
      </div>

      {status === "issued" && (
        <div className="flex shrink-0 items-center gap-1.5">
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  void revokeGuestPass(pass.id);
                  setConfirming(false);
                }}
                className="rounded-full border border-cloak-danger/40 px-2.5 py-1 text-[11px] text-cloak-danger transition-colors hover:bg-cloak-danger/10"
              >
                Revoke invite
              </button>
              <button
                aria-label="Cancel revocation"
                onClick={() => setConfirming(false)}
                className="rounded-full px-2 py-1 text-[11px] text-cloak-text-muted hover:text-cloak-text"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              aria-label="Revoke the pending invite for this pass"
              title="Revoke while pending"
              onClick={() => setConfirming(true)}
              className="grid h-8 w-8 place-items-center rounded-full border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-danger/40 hover:text-cloak-danger"
            >
              <XIcon size={13} />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/* ---------- Invite flow (spec §12 — secure link + QR only) ---------- */

function InviteDialog() {
  const issueGuestPass = useCloakStore((s) => s.issueGuestPass);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"secure_link" | "qr">("secure_link");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ link: string; qrDataUrl: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await issueGuestPass({ ownerUserId: "you", method });
      if (!result.ok) {
        setError(
          result.error === "allocation_exhausted"
            ? "No available passes — redeemed passes cannot be reused."
            : result.error === "forbidden"
              ? "Only Reserve members can issue passes."
              : "The invitation could not be created."
        );
      } else {
        setIssued({ link: result.link, qrDataUrl: result.qrDataUrl });
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setOpen(false);
    setError(null);
    setIssued(null);
    setCopied(false);
  };

  return (
    <>
      <Button
        className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-4 h-10 w-full border border-cloak-gold/30 text-[13px] font-medium text-cloak-gold hover:text-cloak-gold"
        onClick={() => setOpen(true)}
      >
        Invite someone
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : reset())}>
        <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          {!issued ? (
            <>
              <DialogHeader>
                <DialogTitle className="cloak-display text-xl">Invite someone</DialogTitle>
                <DialogDescription className="text-cloak-text-secondary">
                  Grant Cloaq Private to one person — no purchase, wallet, or
                  card required for them, ever.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-cloak-text-secondary">
                    Invitation method
                  </p>
                  <Select value={method} onValueChange={(v) => setMethod(v as "secure_link" | "qr")}>
                    <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
                      <SelectItem value="secure_link">Secure invite link</SelectItem>
                      <SelectItem value="qr">QR code</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-cloak-text-muted">
                    The recipient redeems the link themselves — the invitation
                    is the only connection between your accounts.
                  </p>
                </div>

                {/* Pre-issue confirmation (spec §12) */}
                <div className="rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/20 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-cloak-text">
                    <KeyRoundIcon size={14} className="text-cloak-gold" />
                    Grant Cloaq Private?
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-cloak-text-secondary">
                    This will reserve one of your {CLOAK_PRICING.reserve.includedPrivatePasses}{" "}
                    included Cloaq Private passes. Once the recipient accepts,
                    the pass is permanently used.
                  </p>
                </div>

                {error && (
                  <p className="flex items-center gap-1.5 text-[12px] text-cloak-warning">
                    <InfoIcon size={12} />
                    {error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    className="h-9 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
                    onClick={reset}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-9 border border-cloak-gold/30 px-5 text-[12.5px] font-medium text-cloak-gold hover:text-cloak-gold"
                    onClick={create}
                    disabled={busy}
                  >
                    {busy && <LoaderCircleIcon size={13} className="mr-1.5 animate-spin" />}
                    Create invitation
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="cloak-display text-xl">Invitation created</DialogTitle>
                <DialogDescription className="text-cloak-text-secondary">
                  {method === "qr"
                    ? "Show this QR code, or share the link below."
                    : "Share this link with the person you are granting Cloaq Private to."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {method === "qr" && (
                  <div className="flex justify-center">
                    {issued.qrDataUrl ? (
                      <div className="rounded-xl bg-white p-2.5">
                        { }
                        <img
                          src={issued.qrDataUrl}
                          alt="Invitation QR code — grants one Cloaq Private membership when redeemed"
                          width={168}
                          height={168}
                          className="h-[168px] w-[168px]"
                        />
                      </div>
                    ) : (
                      <p className="text-[12px] text-cloak-text-muted">
                        QR rendering unavailable — use the link below.
                      </p>
                    )}
                  </div>
                )}
                <div className="break-all rounded-lg border border-cloak-border bg-cloak-bg/70 p-3 font-mono text-[11px] leading-relaxed text-cloak-text-secondary">
                  {issued.link}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-9 flex-1 border-cloak-border-strong text-[12.5px] text-cloak-text hover:bg-cloak-surface"
                    onClick={() => {
                      navigator.clipboard?.writeText(issued.link).then(
                        () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        },
                        () => undefined
                      );
                    }}
                  >
                    {copied ? <CheckIcon size={13} className="mr-1.5 text-cloak-success" /> : <CopyIcon size={13} className="mr-1.5" />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-9 flex-1 border border-cloak-gold/30 text-[12.5px] font-medium text-cloak-gold hover:text-cloak-gold"
                    onClick={reset}
                  >
                    Done
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-cloak-text-muted">
                  The invitation expires in 7 days. You can revoke it while it
                  is still pending. Only a hash of this link is stored — Cloak
                  cannot reconstruct it after this screen.
                </p>
              </div>
            </>
          )}
        </RiseDialogContent>
      </Dialog>
    </>
  );
}
