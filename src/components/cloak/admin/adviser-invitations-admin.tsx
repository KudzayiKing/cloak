"use client";

/*
 * Founding Adviser Invitations — admin dashboard (adviser invitation spec
 * §5, §6, §8, §9, §11, §32, §33, §34).
 *
 * Two facts shape this screen and both are deliberate:
 *
 *   1. The raw invitation token exists exactly once — in the POST response
 *      that created it. Only its SHA-256 hash is stored (§12), so a link
 *      cannot be re-derived on a later page load. That is why "Copy Link" and
 *      "Copy Email" are only offered for the invitation created in THIS
 *      session, and why the table says so instead of offering a button that
 *      would have nothing to copy. Losing the link means revoking and
 *      reissuing, not recovering it.
 *
 *   2. Nothing here sends email. The founder copies the personalised message
 *      and sends it personally (§40).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/cloak/config";
import {
  CopyIcon,
  LoaderCircleIcon,
  MailIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  XIcon,
} from "@animateicons/react/lucide";

interface Invitation {
  id: string;
  recipientName: string;
  recipientEmail: string;
  maskedRecipientEmail: string;
  membershipName: string;
  emailBindingRequired: boolean;
  status: "pending" | "redeemed" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedByUserId?: string;
  revokedAt?: string;
  internalNote?: string;
  link?: string;
  emailSubject?: string;
  emailBody?: string;
}

interface InvitationEvent {
  id: string;
  event: string;
  actorUserId?: string;
  detail?: string;
  createdAt: string;
}

interface CreatedCopy {
  id: string;
  recipientName: string;
  recipientEmail: string;
  membershipName: string;
  expiresAt: string;
  link: string;
  emailSubject: string;
  emailBody: string;
}

const EXPIRY_OPTIONS = [3, 7, 14, 30] as const;

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  extended: "Extended",
  revoked: "Revoked",
  redeemed: "Redeemed",
};

export function AdviserInvitationsAdmin({
  initialInvitations,
  openFormInitially = false,
}: {
  initialInvitations: Invitation[];
  openFormInitially?: boolean;
}) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [createdCopy, setCreatedCopy] = useState<CreatedCopy | null>(null);
  const [formOpen, setFormOpen] = useState(openFormInitially);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /* Create form */
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | "custom">(7);
  const [customExpiry, setCustomExpiry] = useState("");
  const [emailBindingRequired, setEmailBindingRequired] = useState(true);
  const [internalNote, setInternalNote] = useState("");

  /* Extend dialog */
  const [extendTarget, setExtendTarget] = useState<Invitation | null>(null);
  const [extendDays, setExtendDays] = useState<number | "custom">(14);
  const [extendCustom, setExtendCustom] = useState("");

  /* Details dialog */
  const [detailsTarget, setDetailsTarget] = useState<Invitation | null>(null);
  const [detailsEvents, setDetailsEvents] = useState<InvitationEvent[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [trustedCapacity, setTrustedCapacity] = useState<{ total: number; pending: number; redeemed: number; available: number } | null>(null);
  const [trustedGrantAmount, setTrustedGrantAmount] = useState("1");
  const [customTrustedGrantAmount, setCustomTrustedGrantAmount] = useState("");
  const [trustedGrantBusy, setTrustedGrantBusy] = useState(false);

  useEffect(() => {
    setInvitations(initialInvitations);
  }, [initialInvitations]);

  const pendingCount = useMemo(
    () => invitations.filter((inv) => inv.status === "pending").length,
    [invitations]
  );

  async function refresh() {
    const res = await fetch("/api/admin/adviser-invitations", { cache: "no-store" });
    const json = (await res.json()) as { ok: boolean; invitations?: Invitation[] };
    if (json.ok && json.invitations) setInvitations(json.invitations);
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 2000);
    } catch {
      setError("Copying to the clipboard was blocked by the browser.");
    }
  }

  async function createInvitation(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/adviser-invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientName,
        recipientEmail,
        expiryDays: expiryDays === "custom" ? undefined : expiryDays,
        customExpiresAt: expiryDays === "custom" ? customExpiry : undefined,
        emailBindingRequired,
        internalNote,
      }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      invitation?: Invitation;
      link?: string;
      emailSubject?: string;
      emailBody?: string;
    };
    setBusy(false);
    if (!json.ok || !json.invitation || !json.link || !json.emailSubject || !json.emailBody) {
      setError(json.error ?? "Invitation could not be created.");
      return;
    }
    setInvitations((current) => [json.invitation!, ...current]);
    setCreatedCopy({
      id: json.invitation.id,
      recipientName: json.invitation.recipientName,
      recipientEmail: json.invitation.recipientEmail,
      membershipName: json.invitation.membershipName,
      expiresAt: json.invitation.expiresAt,
      link: json.link,
      emailSubject: json.emailSubject,
      emailBody: json.emailBody,
    });
    setRecipientName("");
    setRecipientEmail("");
    setInternalNote("");
    setExpiryDays(7);
    setCustomExpiry("");
    setEmailBindingRequired(true);
    setFormOpen(false);
  }

  async function revoke(invitation: Invitation) {
    if (
      !window.confirm(
        `Revoke invitation?\n\n${invitation.recipientName} will no longer be able to redeem this invitation.`
      )
    )
      return;
    const res = await fetch(`/api/admin/adviser-invitations/${invitation.id}/revoke`, { method: "POST" });
    const json = (await res.json()) as { ok: boolean; invitation?: Invitation; error?: string };
    if (!json.ok || !json.invitation) {
      setError(json.error ?? "Invitation could not be revoked.");
      return;
    }
    setInvitations((current) => current.map((item) => (item.id === invitation.id ? json.invitation! : item)));
  }

  async function submitExtend() {
    if (!extendTarget) return;
    const res = await fetch(`/api/admin/adviser-invitations/${extendTarget.id}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        extendDays === "custom"
          ? { expiresAt: extendCustom }
          : { expiryDays: extendDays }
      ),
    });
    const json = (await res.json()) as { ok: boolean; invitation?: Invitation; error?: string };
    if (!json.ok || !json.invitation) {
      setError(json.error ?? "Invitation could not be extended.");
      return;
    }
    setInvitations((current) => current.map((item) => (item.id === extendTarget.id ? json.invitation! : item)));
    setExtendTarget(null);
  }

  async function openDetails(invitation: Invitation) {
    setDetailsTarget(invitation);
    setDetailsEvents(null);
    setDetailsLoading(true);
    const res = await fetch(`/api/admin/adviser-invitations/${invitation.id}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      invitation?: Invitation & { events?: InvitationEvent[] };
    };
    setDetailsLoading(false);
    setDetailsEvents(json.invitation?.events ?? []);
    setTrustedCapacity(null);
    if (invitation.status === "redeemed" && invitation.redeemedByUserId) {
      const capacityRes = await fetch(`/api/admin/founding-advisers/${invitation.redeemedByUserId}/trusted-invites`, { cache: "no-store" });
      const capacityJson = (await capacityRes.json().catch(() => ({}))) as { ok?: boolean; allocation?: typeof trustedCapacity };
      if (capacityJson.ok && capacityJson.allocation) setTrustedCapacity(capacityJson.allocation);
    }
  }

  async function grantMoreTrustedInvites() {
    if (!detailsTarget?.redeemedByUserId || trustedGrantBusy) return;
    setTrustedGrantBusy(true);
    try {
      const res = await fetch(`/api/admin/founding-advisers/${detailsTarget.redeemedByUserId}/trusted-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(trustedGrantAmount === "custom" ? customTrustedGrantAmount : trustedGrantAmount) }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; allocation?: typeof trustedCapacity };
      if (json.ok && json.allocation) setTrustedCapacity(json.allocation);
      else setError("Additional Trusted Invites could not be granted.");
    } finally {
      setTrustedGrantBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-cloak-bg text-cloak-text">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <header className="flex flex-col gap-4 border-b border-cloak-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cloak-gold">
              {BRAND.uppercaseName}
            </p>
            <h1 className="cloak-display mt-2 text-3xl font-medium">Founding Adviser Invitations</h1>
            <p className="mt-2 max-w-2xl text-sm text-cloak-text-secondary">
              Single-use links granting complimentary {BRAND.cloakPrivate}. Each link is shown once, when it is
              created — only a hash is stored, so it cannot be recovered later.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-lg border border-cloak-border px-3 py-2 text-xs text-cloak-text-secondary hover:bg-cloak-surface"
            >
              Overview
            </Link>
            <Button
              variant="outline"
              className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              onClick={() => void refresh()}
            >
              <RefreshCwIcon size={15} className="mr-1.5" />
              Refresh
            </Button>
            <Button
              className="bg-cloak-gold text-black hover:bg-cloak-gold-bright"
              onClick={() => setFormOpen((open) => !open)}
            >
              <PlusIcon size={15} className="mr-1.5" />
              New Invitation
            </Button>
          </div>
        </header>

        {error && (
          <div className="mt-4 rounded-lg border border-cloak-danger/25 bg-cloak-danger/10 px-4 py-3 text-sm text-cloak-danger">
            {error}
          </div>
        )}

        {createdCopy && <InvitationReadyPanel copy={createdCopy} onDismiss={() => setCreatedCopy(null)} onCopy={copy} copied={copied} />}

        {formOpen && (
          <CreateForm
            recipientName={recipientName}
            setRecipientName={setRecipientName}
            recipientEmail={recipientEmail}
            setRecipientEmail={setRecipientEmail}
            expiryDays={expiryDays}
            setExpiryDays={setExpiryDays}
            customExpiry={customExpiry}
            setCustomExpiry={setCustomExpiry}
            emailBindingRequired={emailBindingRequired}
            setEmailBindingRequired={setEmailBindingRequired}
            internalNote={internalNote}
            setInternalNote={setInternalNote}
            busy={busy}
            onSubmit={createInvitation}
          />
        )}

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-cloak-text-secondary">{pendingCount} pending</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-cloak-border">
            <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
              <thead className="bg-cloak-surface text-xs uppercase tracking-[0.12em] text-cloak-text-muted">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Membership</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Redeemed</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-cloak-border bg-cloak-bg-elevated/50">
                    <td className="px-4 py-3 font-medium text-cloak-text">{invitation.recipientName}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{invitation.recipientEmail}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">Founding Adviser</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{invitation.membershipName}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={invitation.status} />
                    </td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{formatDate(invitation.createdAt)}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{formatDate(invitation.expiresAt)}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">
                      {invitation.redeemedAt ? formatDate(invitation.redeemedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        {invitation.status === "pending" && createdCopy?.id === invitation.id && (
                          <>
                            <RowAction onClick={() => void copy("link", createdCopy.link)}>Copy Link</RowAction>
                            <RowAction
                              onClick={() =>
                                void copy("email", `Subject: ${createdCopy.emailSubject}\n\n${createdCopy.emailBody}`)
                              }
                            >
                              Copy Email
                            </RowAction>
                          </>
                        )}
                        {invitation.status === "pending" && (
                          <>
                            <RowAction onClick={() => { setExtendTarget(invitation); setExtendDays(14); setExtendCustom(""); }}>
                              Extend
                            </RowAction>
                            <button
                              className="text-xs text-cloak-danger hover:text-cloak-text"
                              onClick={() => void revoke(invitation)}
                            >
                              Revoke
                            </button>
                          </>
                        )}
                        {invitation.status !== "pending" && (
                          <RowAction onClick={() => void openDetails(invitation)}>View Details</RowAction>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {invitations.length === 0 && (
                  <tr>
                    <td colSpan={9} className="bg-cloak-bg-elevated px-4 py-8 text-center text-sm text-cloak-text-muted">
                      No adviser invitations yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-cloak-text-muted">
            A link can only be copied in the session that created it. To reissue, revoke the invitation and create a
            new one — the original token is unrecoverable by design.
          </p>
        </section>
      </div>

      {/* Extend (spec §33) */}
      <Dialog open={extendTarget !== null} onOpenChange={(open) => { if (!open) setExtendTarget(null); }}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-xl font-medium">Extend invitation</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              {extendTarget?.recipientName} keeps the same link; only its expiry moves.
            </DialogDescription>
          </DialogHeader>
          {extendTarget && (
            <div className="space-y-4 text-sm">
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-cloak-text-secondary">Current expiry</dt>
                  <dd className="text-cloak-text">{formatLongDate(extendTarget.expiresAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-cloak-text-secondary">New expiry</dt>
                  <dd className="text-cloak-text">{previewExtend(extendDays, extendCustom)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setExtendDays(days)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      extendDays === days
                        ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold"
                        : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
                    )}
                  >
                    +{days} days
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setExtendDays("custom")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    extendDays === "custom"
                      ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold"
                      : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
                  )}
                >
                  Custom
                </button>
              </div>
              {extendDays === "custom" && (
                <Input
                  type="datetime-local"
                  value={extendCustom}
                  onChange={(e) => setExtendCustom(e.target.value)}
                  className="border-cloak-border bg-cloak-bg text-cloak-text"
                />
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              onClick={() => setExtendTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-cloak-gold text-black hover:bg-cloak-gold-bright"
              disabled={extendDays === "custom" && !extendCustom}
              onClick={() => void submitExtend()}
            >
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details (spec §32) */}
      <Dialog open={detailsTarget !== null} onOpenChange={(open) => { if (!open) setDetailsTarget(null); }}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="cloak-display text-xl font-medium">{detailsTarget?.recipientName}</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              {detailsTarget?.membershipName} · {detailsTarget?.status}
            </DialogDescription>
          </DialogHeader>
          {detailsTarget && (
            <div className="space-y-5 text-sm">
              <dl className="space-y-2">
                <DetailRow label="Email" value={detailsTarget.recipientEmail} />
                <DetailRow label="Type" value="Founding Adviser" />
                <DetailRow
                  label="Recipient binding"
                  value={detailsTarget.emailBindingRequired ? "Intended email required" : "Any holder may redeem"}
                />
                <DetailRow label="Created" value={formatLongDate(detailsTarget.createdAt)} />
                <DetailRow label="Expires" value={formatLongDate(detailsTarget.expiresAt)} />
                {detailsTarget.redeemedAt && <DetailRow label="Redeemed" value={formatLongDate(detailsTarget.redeemedAt)} />}
                {detailsTarget.revokedAt && <DetailRow label="Revoked" value={formatLongDate(detailsTarget.revokedAt)} />}
                {detailsTarget.internalNote && <DetailRow label="Internal note" value={detailsTarget.internalNote} />}
              </dl>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cloak-text-muted">
                  History
                </h3>
                {detailsLoading && (
                  <p className="flex items-center gap-2 text-xs text-cloak-text-muted">
                    <LoaderCircleIcon size={13} className="animate-spin" />
                    Loading history...
                  </p>
                )}
                {!detailsLoading && detailsEvents && detailsEvents.length === 0 && (
                  <p className="text-xs text-cloak-text-muted">No recorded events.</p>
                )}
                {!detailsLoading && detailsEvents && detailsEvents.length > 0 && (
                  <ul className="space-y-1.5 text-xs text-cloak-text-secondary">
                    {detailsEvents.map((event) => (
                      <li key={event.id} className="flex items-center justify-between gap-4">
                        <span>{EVENT_LABELS[event.event] ?? event.event}</span>
                        <span className="text-cloak-text-muted">{formatLongDate(event.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {detailsTarget.status === "redeemed" && (
                <div className="space-y-3 rounded-lg border border-cloak-border bg-cloak-bg/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-cloak-text-muted">Trusted Invites</h3>
                  {trustedCapacity ? (
                    <p className="text-sm text-cloak-text-secondary">
                      {trustedCapacity.total} total · {trustedCapacity.pending} pending · {trustedCapacity.redeemed} redeemed · {trustedCapacity.available} available
                    </p>
                  ) : (
                    <p className="text-xs text-cloak-text-muted">Loading invite capacity…</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Additional Trusted Invite amount"
                      value={trustedGrantAmount}
                      onChange={(event) => setTrustedGrantAmount(event.target.value)}
                      className="h-9 rounded-md border border-cloak-border bg-cloak-bg px-2 text-sm text-cloak-text"
                    >
                      <option value="1">+1</option>
                      <option value="3">+3</option>
                      <option value="5">+5</option>
                      <option value="custom">Custom</option>
                    </select>
                    {trustedGrantAmount === "custom" && (
                      <Input aria-label="Custom Trusted Invite amount" type="number" min={1} max={100} value={customTrustedGrantAmount} onChange={(event) => setCustomTrustedGrantAmount(event.target.value)} className="h-9 w-24 border-cloak-border bg-cloak-bg text-cloak-text" />
                    )}
                    <Button disabled={trustedGrantBusy || !trustedCapacity || !detailsTarget.redeemedByUserId || (trustedGrantAmount === "custom" && (!Number.isInteger(Number(customTrustedGrantAmount)) || Number(customTrustedGrantAmount) < 1 || Number(customTrustedGrantAmount) > 100))} onClick={() => void grantMoreTrustedInvites()} className="h-9 bg-cloak-gold text-black hover:bg-cloak-gold-bright">
                      {trustedGrantBusy ? "Granting…" : "Grant More Invites"}
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-cloak-text-muted">Capacity changes are recorded in the admin audit log. Redeemed memberships remain independent.</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

/* ---------- Create form (spec §6, §8, §9, §10) ---------- */

function CreateForm(props: {
  recipientName: string;
  setRecipientName: (value: string) => void;
  recipientEmail: string;
  setRecipientEmail: (value: string) => void;
  expiryDays: number | "custom";
  setExpiryDays: (value: number | "custom") => void;
  customExpiry: string;
  setCustomExpiry: (value: string) => void;
  emailBindingRequired: boolean;
  setEmailBindingRequired: (value: boolean) => void;
  internalNote: string;
  setInternalNote: (value: string) => void;
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="mt-5 grid gap-4 rounded-lg border border-cloak-border bg-cloak-bg-elevated p-4 md:grid-cols-2"
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Recipient name</span>
        <Input
          value={props.recipientName}
          onChange={(e) => props.setRecipientName(e.target.value)}
          required
          placeholder="Jennifer Beckage"
          className="border-cloak-border bg-cloak-bg text-cloak-text"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Recipient email</span>
        <Input
          type="email"
          value={props.recipientEmail}
          onChange={(e) => props.setRecipientEmail(e.target.value)}
          required
          placeholder="name@example.com"
          className="border-cloak-border bg-cloak-bg text-cloak-text"
        />
      </label>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Expiry</span>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => props.setExpiryDays(days)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                props.expiryDays === days
                  ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold"
                  : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
              )}
            >
              {days} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => props.setExpiryDays("custom")}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              props.expiryDays === "custom"
                ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold"
                : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
            )}
          >
            Custom
          </button>
        </div>
        {props.expiryDays === "custom" && (
          <Input
            type="datetime-local"
            value={props.customExpiry}
            onChange={(e) => props.setCustomExpiry(e.target.value)}
            className="mt-2 border-cloak-border bg-cloak-bg text-cloak-text"
          />
        )}
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Membership</span>
        <div className="rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-sm text-cloak-text">
          {BRAND.cloakPrivate}
        </div>
        <span className="mt-3 block text-xs font-medium text-cloak-text-secondary">Recipient binding</span>
        <div className="mt-1.5 space-y-1.5">
          <BindingOption
            active={props.emailBindingRequired}
            onClick={() => props.setEmailBindingRequired(true)}
            title="Require intended email verification"
            detail="Only the named recipient can redeem this invitation."
          />
          <BindingOption
            active={!props.emailBindingRequired}
            onClick={() => props.setEmailBindingRequired(false)}
            title="Anyone holding the invitation can redeem it"
            detail="Use only when the link is delivered over a channel you trust."
          />
        </div>
      </div>
      <label className="block md:col-span-2">
        <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">
          Internal note <span className="text-cloak-text-muted">(admin only — never shown to the recipient)</span>
        </span>
        <textarea
          value={props.internalNote}
          onChange={(e) => props.setInternalNote(e.target.value)}
          placeholder="Family office security adviser — Priority A"
          className="min-h-20 w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-sm text-cloak-text outline-none focus:border-cloak-gold"
        />
      </label>
      <div className="md:col-span-2">
        <Button disabled={props.busy} className="bg-cloak-gold text-black hover:bg-cloak-gold-bright">
          {props.busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
          Generate Invitation
        </Button>
      </div>
    </form>
  );
}

function BindingOption({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full rounded-lg border px-3 py-2 text-left",
        active ? "border-cloak-gold bg-cloak-gold-soft" : "border-cloak-border hover:bg-cloak-surface"
      )}
    >
      <span className={cn("block text-xs font-medium", active ? "text-cloak-gold" : "text-cloak-text")}>{title}</span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-cloak-text-muted">{detail}</span>
    </button>
  );
}

/* ---------- Invitation ready (spec §11) ---------- */

function InvitationReadyPanel({
  copy,
  onDismiss,
  onCopy,
  copied,
}: {
  copy: CreatedCopy;
  onDismiss: () => void;
  onCopy: (label: string, value: string) => void;
  copied: string | null;
}) {
  const emailText = `Subject: ${copy.emailSubject}\n\n${copy.emailBody}`;
  return (
    <section className="mt-5 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-cloak-text">Invitation ready</h2>
          <p className="mt-1 text-xs text-cloak-text-secondary">
            Copy the link and the email now — the link cannot be shown again after this session.
          </p>
        </div>
        <button className="text-cloak-text-muted hover:text-cloak-text" onClick={onDismiss} aria-label="Done">
          <XIcon size={16} />
        </button>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <DetailRow label="Type" value="Founding Adviser" />
        <DetailRow label="Recipient" value={copy.recipientName} />
        <DetailRow label="Membership" value={copy.membershipName} />
        <DetailRow label="Expires" value={formatLongDate(copy.expiresAt)} />
      </dl>

      <p className="mt-4 break-all rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-cloak-text-secondary">
        {copy.link}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
          onClick={() => onCopy("link", copy.link)}
        >
          <CopyIcon size={14} className="mr-1.5" />
          {copied === "link" ? "Copied" : "Copy Link"}
        </Button>
        <Button
          variant="outline"
          className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
          onClick={() => onCopy("email", emailText)}
        >
          <MailIcon size={14} className="mr-1.5" />
          {copied === "email" ? "Copied" : "Copy Email"}
        </Button>
        <Button
          variant="outline"
          className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
          onClick={() => window.open(copy.link, "_blank", "noopener,noreferrer")}
        >
          Open Invitation
        </Button>
        <Button className="bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </section>
  );
}

/* ---------- Small parts ---------- */

function StatusPill({ status }: { status: Invitation["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        status === "pending" && "border-cloak-gold/30 bg-cloak-gold-soft text-cloak-gold",
        status === "redeemed" && "border-cloak-success/30 bg-cloak-success/10 text-cloak-success",
        status === "expired" && "border-cloak-warning/30 bg-cloak-warning/10 text-cloak-warning",
        status === "revoked" && "border-cloak-danger/30 bg-cloak-danger/10 text-cloak-danger"
      )}
    >
      {status}
    </span>
  );
}

function RowAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="text-xs text-cloak-gold hover:text-cloak-text" onClick={onClick}>
      {children}
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-cloak-text-secondary">{label}</dt>
      <dd className="text-right text-cloak-text">{value}</dd>
    </div>
  );
}

/** "8 October 2026" — the spec's date shape for invitations. */
function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

/** The new expiry the current selection would produce, for the dialog. */
function previewExtend(days: number | "custom", custom: string): string {
  if (days === "custom") {
    return custom ? formatLongDate(new Date(custom).toISOString()) : "Pick a date";
  }
  return formatLongDate(new Date(Date.now() + days * 24 * 3600 * 1000).toISOString());
}
