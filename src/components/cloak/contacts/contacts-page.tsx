"use client";

/*
 * ContactsPage (spec §25) — Cloaq IDs first, phone numbers never primary.
 * Add by Cloaq ID, QR entry, invite concept, verification, blocking.
 */

import { useEffect, useState } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { useCloakStore } from "@/stores/cloak-store";
import { Surface } from "@/components/cloak/shared/primitives";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import {
  SearchIcon,
  UserPlusIcon,
  ShieldCheckIcon,
  QrCodeIcon,
  MessageCircleIcon,
  TriangleAlertIcon,
  UserRoundXIcon,
  CirclePlusIcon,
  LinkIcon,
} from "@animateicons/react/lucide";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ContactsPage() {
  const contacts = useCloakStore((s) => s.contacts);
  const setActiveConversation = useCloakStore((s) => s.setActiveConversation);
  const conversations = useCloakStore((s) => s.conversations);
  const blockedUsers = useCloakStore((s) => s.blockedUsers);
  const fetchBlockedUsers = useCloakStore((s) => s.fetchBlockedUsers);
  const blockUserByHandle = useCloakStore((s) => s.blockUserByHandle);
  const unblockUserById = useCloakStore((s) => s.unblockUserById);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addHandle, setAddHandle] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    void fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.cloakId.toLowerCase().includes(query.toLowerCase())
  );

  const openChat = async (contactId: string) => {
    const conv = conversations.find((c) => c.contactId === contactId);
    if (conv) {
      setActiveConversation(conv.id);
      navigate("/app/messages");
      return;
    }
    /* No local conversation — ask the server to open (or create) one. */
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    const openServerConversation = useCloakStore.getState().openServerConversation;
    const id = await openServerConversation(contact.cloakId);
    if (id) {
      setActiveConversation(id);
      navigate("/app/messages");
    }
  };

  const addContact = async () => {
    const handle = addHandle.trim();
    if (!handle) {
      setAddError("Enter a Cloaq ID.");
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const id = await useCloakStore.getState().openServerConversation(handle);
      if (!id) {
        setAddError("No account with that Cloaq ID was found.");
        return;
      }
      setActiveConversation(id);
      setAddHandle("");
      setAddOpen(false);
      navigate("/app/messages");
    } finally {
      setAddBusy(false);
    }
  };

  const detail = contacts.find((c) => c.id === detailId);
  const detailBlocked = !!detail && blockedUsers.some((b) => b.userId === detail.id);

  return (
    <AppShell active="/app/contacts">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-3xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="cloak-display text-2xl font-medium text-cloak-text">Contacts</h1>
              <p className="mt-1 text-[13px] text-cloak-text-muted">
                People reach you by Cloaq ID — never by phone number.
              </p>
            </div>
            <button
              onClick={() => setAddOpen(true)}
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-cloak-gold/30 px-4 text-[13px] font-medium text-cloak-gold"
            >
              <UserPlusIcon size={15} />
              Add contact
            </button>
          </div>

          <label className="mb-5 flex items-center gap-2.5 rounded-full border border-cloak-border bg-cloak-surface px-4 py-2.5">
            <SearchIcon size={15} className="shrink-0 text-cloak-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or Cloaq ID"
              className="w-full bg-transparent text-[13.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted"
            />
          </label>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-12 text-center">
              <UserRoundXIcon size={22} className="mx-auto text-cloak-text-muted" />
              <p className="mt-3 text-sm text-cloak-text-secondary">No matching contacts.</p>
              <p className="mt-1 text-xs text-cloak-text-muted">
                Add someone by their Cloaq ID or scan their QR code.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {filtered.map((c) => {
                const conv = conversations.find((x) => x.contactId === c.id);
                return (
                  <li key={c.id}>
                    <Surface hover className="flex items-center gap-4 p-4">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[12px] font-semibold text-cloak-text-secondary">
                        {c.avatarInitials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-medium text-cloak-text">{c.name}</p>
                          {c.verification === "verified" && (
                            <ShieldCheckIcon size={13} className="text-cloak-gold" />
                          )}
                          {c.verification === "pending" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cloak-warning/30 px-2 py-0.5 text-[10px] text-cloak-warning">
                              <TriangleAlertIcon size={9} />
                              Verification pending
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-cloak-text-muted">{c.cloakId}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          aria-label={`Open conversation with ${c.name}`}
                          title="Open conversation"
                          onClick={() => void openChat(c.id)}
                          className="grid h-9 w-9 place-items-center rounded-full border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/30 hover:text-cloak-gold"
                        >
                          <MessageCircleIcon size={15} />
                        </button>
                        <button
                          aria-label={`View ${c.name} security details`}
                          title="Security details"
                          onClick={() => setDetailId(c.id)}
                          className="grid h-9 w-9 place-items-center rounded-full border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/30 hover:text-cloak-gold"
                        >
                          <ShieldCheckIcon size={15} />
                        </button>
                      </div>
                    </Surface>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Membership invites (pricing & membership update spec §11-§12) */}
          <ReserveInvitePanel />

          {/* Blocked users (spec §75) — private management surface */}
          {blockedUsers.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-sm font-semibold text-cloak-text">Blocked users</h2>
              <ul className="space-y-2">
                {blockedUsers.map((b) => (
                  <li key={b.userId}>
                    <Surface className="flex items-center gap-3 p-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[11px] font-semibold text-cloak-text-secondary">
                        {b.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-cloak-text">{b.name}</p>
                        <p className="text-[12px] text-cloak-text-muted">{b.cloakId}</p>
                      </div>
                      <button
                        onClick={() => void unblockUserById(b.userId)}
                        className="shrink-0 rounded-full border border-cloak-border px-3 py-1.5 text-[12px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                      >
                        Unblock
                      </button>
                    </Surface>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-cloak-text-muted">
                Blocked people cannot add you to groups or Circles and cannot
                redeem your invite links. They are not told (spec §75).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add contact dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-xl">Add a contact</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Enter a Cloaq ID or scan a verification QR code in person.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-bg text-cloak-gold">
                <QrCodeIcon size={19} />
              </span>
              <Button
                variant="outline"
                className="flex-1 border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              >
                Scan QR code
              </Button>
            </div>
            <div className="relative text-center">
              <span className="text-[11px] uppercase tracking-widest text-cloak-text-muted">or</span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Cloaq ID
              </span>
              <Input
                value={addHandle}
                onChange={(e) => {
                  setAddHandle(e.target.value);
                  if (addError) setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addContact();
                }}
                placeholder="@name.XXXX"
                className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
              />
            </label>
            {addError && (
              <p className="text-center text-[11.5px] text-cloak-danger">{addError}</p>
            )}
            <Button
              disabled={addBusy}
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 w-full border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
              onClick={() => void addContact()}
            >
              <CirclePlusIcon size={15} className="mr-1.5" />
              {addBusy ? "Opening..." : "Add contact"}
            </Button>
            <p className="text-center text-[11px] text-cloak-text-muted">
              Requests reveal only your Cloaq ID — never your phone number.
            </p>
          </div>
        </RiseDialogContent>
      </Dialog>

      {/* Contact security detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-xl">{detail?.name}</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              {detail?.cloakId} · {detail?.about}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between rounded-xl border border-cloak-border bg-cloak-bg/50 px-4 py-3">
              <span className="text-cloak-text-secondary">Identity</span>
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  detail?.verification === "verified" ? "text-cloak-success" : "text-cloak-warning"
                )}
              >
                {detail?.verification === "verified" ? (
                  <>
                    <ShieldCheckIcon size={13} />
                    Verified {detail?.verifiedAt ? `· ${detail.verifiedAt}` : ""}
                  </>
                ) : (
                  <>
                    <TriangleAlertIcon size={13} />
                    Verification pending
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-cloak-border bg-cloak-bg/50 px-4 py-3">
              <span className="text-cloak-text-secondary">Safety number</span>
              <span className="font-mono text-[12px] text-cloak-text-secondary">
                81X4 · K2R7 · 99QM · 4TL0
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <Button
                variant="outline"
                className="border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              >
                <QrCodeIcon size={14} className="mr-1.5" />
                Verify in person
              </Button>
              <Button
                variant="outline"
                disabled={blockBusy}
                className={cn(
                  detailBlocked
                    ? "border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
                    : "border-cloak-danger/30 text-cloak-danger hover:bg-cloak-danger/10 hover:text-cloak-danger"
                )}
                onClick={async () => {
                  if (!detail) return;
                  setBlockBusy(true);
                  setBlockNote(null);
                  if (detailBlocked) {
                    await unblockUserById(detail.id);
                    setBlockNote("Unblocked.");
                  } else {
                    const r = await blockUserByHandle(detail.cloakId);
                    setBlockNote(r.ok ? "Blocked — they can no longer add you anywhere." : r.error === "unknown_handle" ? "Contact not found." : "Could not block. Try again.");
                  }
                  setBlockBusy(false);
                }}
              >
                <UserRoundXIcon size={14} className="mr-1.5" />
                {detailBlocked ? "Unblock" : "Block"}
              </Button>
            </div>
            {blockNote && <p className="text-center text-[11.5px] text-cloak-text-secondary">{blockNote}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/* ---------- Reserve invite panel (pricing & membership update spec §11) ----------
 * Reserve members manage Cloaq Private passes from Membership settings.
 * Other tiers see the concept honestly — no fake invite creation. */

function ReserveInvitePanel() {
  const isReserve = useCloakStore((s) => s.membership.membership === "reserve");
  const guestPasses = useCloakStore((s) => s.guestPasses);
  const available = guestPasses.filter(
    (p) => p.status === "available" || p.status === "expired" || p.status === "revoked_before_redemption"
  ).length;

  return (
    <div className="mt-8 rounded-2xl border border-dashed border-cloak-border-strong bg-cloak-bg-elevated/50 p-5">
      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft text-cloak-gold">
          <LinkIcon size={17} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-cloak-text">
            {isReserve ? "Private passes" : "Inviting people to Cloaq"}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-secondary">
            {isReserve
              ? `Your Reserve membership includes passes that grant full Cloaq Private membership. ${available} available.`
              : "Cloaq Reserve includes passes that grant full Cloaq Private membership to the people you trust."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
          onClick={() => navigate("/app/settings/membership")}
        >
          {isReserve ? "Manage passes" : "About Reserve"}
        </Button>
      </div>
    </div>
  );
}
