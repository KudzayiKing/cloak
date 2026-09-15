"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  internalNote?: string;
  link?: string;
  emailSubject?: string;
  emailBody?: string;
}

interface CreatedCopy {
  id: string;
  link: string;
  emailSubject: string;
  emailBody: string;
}

const EXPIRY_OPTIONS = [3, 7, 14, 30] as const;

export function AdviserInvitationsAdmin({ initialInvitations }: { initialInvitations: Invitation[] }) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [createdCopy, setCreatedCopy] = useState<CreatedCopy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | "custom">(7);
  const [customExpiry, setCustomExpiry] = useState("");
  const [emailBindingRequired, setEmailBindingRequired] = useState(true);
  const [internalNote, setInternalNote] = useState("");

  useEffect(() => {
    setInvitations(initialInvitations);
  }, [initialInvitations]);

  const pendingCount = useMemo(() => invitations.filter((inv) => inv.status === "pending").length, [invitations]);

  async function refresh() {
    const res = await fetch("/api/admin/adviser-invitations", { cache: "no-store" });
    const json = (await res.json()) as { ok: boolean; invitations?: Invitation[] };
    if (json.ok && json.invitations) setInvitations(json.invitations);
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
    if (!window.confirm(`Revoke invitation?\n\n${invitation.recipientName} will no longer be able to redeem this link.`)) return;
    const res = await fetch(`/api/admin/adviser-invitations/${invitation.id}/revoke`, { method: "POST" });
    const json = (await res.json()) as { ok: boolean; invitation?: Invitation; error?: string };
    if (!json.ok || !json.invitation) {
      setError(json.error ?? "Invitation could not be revoked.");
      return;
    }
    setInvitations((current) => current.map((item) => item.id === invitation.id ? json.invitation! : item));
  }

  async function extend(invitation: Invitation, days: number) {
    const res = await fetch(`/api/admin/adviser-invitations/${invitation.id}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryDays: days }),
    });
    const json = (await res.json()) as { ok: boolean; invitation?: Invitation; error?: string };
    if (!json.ok || !json.invitation) {
      setError(json.error ?? "Invitation could not be extended.");
      return;
    }
    setInvitations((current) => current.map((item) => item.id === invitation.id ? json.invitation! : item));
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <main className="min-h-dvh bg-cloak-bg text-cloak-text">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <header className="flex flex-col gap-4 border-b border-cloak-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cloak-gold">{BRAND.uppercaseName}</p>
            <h1 className="cloak-display mt-2 text-3xl font-medium">Founding Adviser Invitations</h1>
            <p className="mt-2 max-w-2xl text-sm text-cloak-text-secondary">
              Generate single-use adviser links for complimentary {BRAND.cloakPrivate}. Raw links are shown once and are never stored server-side.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface" onClick={() => void refresh()}>
              <RefreshCwIcon size={15} className="mr-1.5" />
              Refresh
            </Button>
            <Button className="bg-cloak-gold text-black hover:bg-cloak-gold-bright" onClick={() => setFormOpen((open) => !open)}>
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

        {createdCopy && (
          <section className="mt-5 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-cloak-text">Invitation ready</h2>
                <p className="mt-1 text-xs text-cloak-text-secondary">
                  Copy the link or the personal email now. It will not be reconstructed after reload.
                </p>
              </div>
              <button className="text-cloak-text-muted hover:text-cloak-text" onClick={() => setCreatedCopy(null)} aria-label="Dismiss">
                <XIcon size={16} />
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface" onClick={() => void copy(createdCopy.link)}>
                <CopyIcon size={14} className="mr-1.5" />
                Copy Link
              </Button>
              <Button variant="outline" className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface" onClick={() => void copy(`Subject: ${createdCopy.emailSubject}\n\n${createdCopy.emailBody}`)}>
                <MailIcon size={14} className="mr-1.5" />
                Copy Email
              </Button>
            </div>
          </section>
        )}

        {formOpen && (
          <form onSubmit={createInvitation} className="mt-5 grid gap-4 rounded-lg border border-cloak-border bg-cloak-bg-elevated p-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Recipient name</span>
              <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required className="border-cloak-border bg-cloak-bg text-cloak-text" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Recipient email</span>
              <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} required className="border-cloak-border bg-cloak-bg text-cloak-text" />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Expiry</span>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setExpiryDays(days)}
                    className={cn("rounded-lg border px-3 py-2 text-xs", expiryDays === days ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold" : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface")}
                  >
                    {days} days
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setExpiryDays("custom")}
                  className={cn("rounded-lg border px-3 py-2 text-xs", expiryDays === "custom" ? "border-cloak-gold bg-cloak-gold-soft text-cloak-gold" : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface")}
                >
                  Custom
                </button>
              </div>
              {expiryDays === "custom" && (
                <Input type="datetime-local" value={customExpiry} onChange={(e) => setCustomExpiry(e.target.value)} className="mt-2 border-cloak-border bg-cloak-bg text-cloak-text" />
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Membership</span>
              <div className="rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-sm text-cloak-text">{BRAND.cloakPrivate}</div>
              <label className="mt-3 flex items-center gap-2 text-xs text-cloak-text-secondary">
                <input type="checkbox" checked={emailBindingRequired} onChange={(e) => setEmailBindingRequired(e.target.checked)} />
                Require intended email confirmation
              </label>
            </div>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">Internal note</span>
              <textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} className="min-h-20 w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-sm text-cloak-text outline-none focus:border-cloak-gold" />
            </label>
            <div className="md:col-span-2">
              <Button disabled={busy} className="bg-cloak-gold text-black hover:bg-cloak-gold-bright">
                {busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
                Create Invitation
              </Button>
            </div>
          </form>
        )}

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-cloak-text-secondary">{pendingCount} pending</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-cloak-border">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-cloak-surface text-xs uppercase tracking-[0.12em] text-cloak-text-muted">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Membership</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">Redeemed</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-cloak-border bg-cloak-bg-elevated/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-cloak-text">{invitation.recipientName}</p>
                      <p className="mt-0.5 text-xs text-cloak-text-muted">{invitation.recipientEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-cloak-text-secondary">Founding Adviser</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{invitation.membershipName}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={invitation.status} />
                    </td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{formatDate(invitation.createdAt)}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{formatDate(invitation.expiresAt)}</td>
                    <td className="px-4 py-3 text-cloak-text-secondary">{invitation.redeemedAt ? formatDate(invitation.redeemedAt) : "—"}</td>
                    <td className="px-4 py-3">
                      {invitation.status === "pending" ? (
                        <div className="flex flex-wrap gap-2">
                          {createdCopy?.id === invitation.id && (
                            <>
                              <button className="text-xs text-cloak-gold hover:text-cloak-text" onClick={() => void copy(createdCopy.link)}>Copy Link</button>
                              <button className="text-xs text-cloak-gold hover:text-cloak-text" onClick={() => void copy(`Subject: ${createdCopy.emailSubject}\n\n${createdCopy.emailBody}`)}>Copy Email</button>
                            </>
                          )}
                          <button className="text-xs text-cloak-text-secondary hover:text-cloak-text" onClick={() => void extend(invitation, 7)}>Extend</button>
                          <button className="text-xs text-cloak-danger hover:text-cloak-text" onClick={() => void revoke(invitation)}>Revoke</button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-cloak-text-muted">
                          <ShieldCheckIcon size={12} />
                          Read-only
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {invitations.length === 0 && (
                  <tr>
                    <td colSpan={8} className="bg-cloak-bg-elevated px-4 py-8 text-center text-sm text-cloak-text-muted">
                      No adviser invitations yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
