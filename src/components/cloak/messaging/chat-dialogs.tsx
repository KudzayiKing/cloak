"use client";

/*
 * Chat sidebar dialogs (user feedback round 2):
 * - NewChatModal: pick a contact to open or start a conversation.
 * - CreateFilterDialog: build a named filter tab from existing conversations.
 */

import { useMemo, useState } from "react";
import { useCloakStore } from "@/stores/cloak-store";
import { cn } from "@/lib/utils";
import { initialsOf as initialsOfName } from "@/lib/cloak/utils";
import { navigate } from "@/hooks/use-hash-route";
import { SheetDialogContent } from "@/components/cloak/shared/sheet-dialog-content";
import { GhostGlyph } from "@/components/cloak/shared/ghost-icon";
import { Switch } from "@/components/ui/switch";
import {
  SearchIcon,
  UserPlusIcon,
  CheckIcon,
  MessageCircleIcon,
  UsersRoundIcon,
  LoaderCircleIcon,
  XIcon,
} from "@animateicons/react/lucide";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

/* ------------------------------------------------------------------ */
/* Group creation (shared by NewChatModal tab + standalone dialog)     */
/* ------------------------------------------------------------------ */

function GroupCreateForm({
  onDone,
}: {
  onDone: (conversationId: string) => void;
}) {
  const contacts = useCloakStore((s) => s.contacts);
  const createServerGroup = useCloakStore((s) => s.createServerGroup);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ghost, setGhost] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chips, setChips] = useState<string[]>([]);
  const [handleDraft, setHandleDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addChip = () => {
    const handle = handleDraft.trim().replace(/^@+/, "").toLowerCase();
    if (!handle) return;
    if (contacts.some((c) => c.cloakId.replace(/^@/, "") === handle)) {
      setError("That person is already picked from your contacts below.");
      return;
    }
    setError(null);
    setChips((prev) => (prev.includes(handle) ? prev : [...prev, handle]));
    setHandleDraft("");
  };

  const memberCount = selected.size + chips.length;

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError("Give the group a name.");
      return;
    }
    if (memberCount === 0) {
      setError("Add at least one member from your contacts, or by Cloak ID.");
      return;
    }
    setBusy(true);
    setError(null);
    const handles = [
      ...chips,
      ...contacts
        .filter((c) => selected.has(c.id))
        .map((c) => c.cloakId.replace(/^@/, "")),
    ];
    const res = await createServerGroup(
      title.trim(),
      handles,
      description.trim() || undefined,
      ghost ? 86400 : undefined
    );
    setBusy(false);
    if (res.ok) {
      onDone(res.conversationId);
    } else if (res.error === "member_limit_reached") {
      setError("That group would exceed the member limit for your membership.");
    } else if (res.error === "group_limit_reached") {
      setError("You've reached the number of groups your membership allows.");
    } else {
      setError("Cloak could not create the group. Try again.");
    }
  };

  /* Column that fills the sheet: the fields scroll, the create row
     stays pinned above the keyboard (SheetDialogContent caps the
     sheet at the visual viewport). */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          placeholder="Group name"
          aria-label="Group name"
          maxLength={80}
          className="border-cloak-border bg-cloak-surface text-[13.5px] text-cloak-text placeholder:text-cloak-text-muted"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Purpose (optional)"
          aria-label="Group purpose"
          maxLength={200}
          className="border-cloak-border bg-cloak-surface text-[13.5px] text-cloak-text placeholder:text-cloak-text-muted"
        />

        {/* Ghost group (user request): create the group as a ghost chat */}
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-cloak-border bg-cloak-bg/50 px-3.5 py-2.5">
          <span className="flex items-start gap-2.5">
            <GhostGlyph size={14} color="currentColor" className="mt-0.5 shrink-0 text-cloak-text" />
            <span>
              <span className="block text-[12.5px] font-medium text-cloak-text">Ghost group</span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-cloak-text-muted">
                Messages disappear 1 day after sending — for everyone.
              </span>
            </span>
          </span>
          <Switch checked={ghost} onCheckedChange={setGhost} aria-label="Create as ghost group" />
        </label>

        {/* Add by Cloak ID — for people not in contacts yet */}
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-cloak-text-muted">
            Add by Cloak ID
          </p>
          <div className="flex gap-2">
            <Input
              value={handleDraft}
              onChange={(e) => {
                setHandleDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChip();
                }
              }}
              placeholder="@handle"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Cloak ID to add"
              className="border-cloak-border bg-cloak-surface text-[13.5px] text-cloak-text placeholder:text-cloak-text-muted"
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 border-cloak-border-strong px-3 text-[12.5px] text-cloak-text hover:bg-cloak-surface"
              onClick={addChip}
            >
              Add
            </Button>
          </div>
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((h) => (
                <span
                  key={h}
                  className="flex items-center gap-1 rounded-full border border-cloak-gold/30 bg-cloak-gold-soft/50 py-0.5 pl-2.5 pr-1 text-[11.5px] text-cloak-gold"
                >
                  @{h}
                  <button
                    aria-label={`Remove @${h}`}
                    onClick={() => setChips((prev) => prev.filter((x) => x !== h))}
                    className="grid h-4 w-4 place-items-center rounded-full hover:text-cloak-danger"
                  >
                    <XIcon size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Pick from contacts */}
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-cloak-text-muted">
            From contacts ({selected.size})
          </p>
          {contacts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-cloak-border px-3.5 py-3 text-[12px] text-cloak-text-muted">
              No contacts yet — add members by their Cloak ID above.
            </p>
          ) : (
            <div className="rounded-xl border border-cloak-border bg-cloak-surface/40">
              <ul className="space-y-0.5 p-1.5">
                {contacts.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                          checked ? "bg-cloak-gold-soft/40" : "hover:bg-cloak-surface"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(c.id)}
                          className="border-cloak-border-strong data-[state=checked]:border-cloak-gold/50 data-[state=checked]:bg-cloak-gold/20 data-[state=checked]:text-cloak-gold"
                        />
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[10.5px] font-semibold text-cloak-text-secondary">
                          {c.avatarInitials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-cloak-text">
                            {c.name}
                          </span>
                          <span className="block truncate text-[11px] text-cloak-text-muted">
                            {c.cloakId}
                          </span>
                        </span>
                        {checked && <CheckIcon size={13} className="shrink-0 text-cloak-gold" />}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-[12px] leading-relaxed text-cloak-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 border-t border-cloak-border px-5 py-3.5">
        <p className="mr-auto text-[11px] text-cloak-text-muted">
          Members see the group from now — no history.
        </p>
        <Button
          onClick={submit}
          disabled={busy}
          className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-8 border border-cloak-gold/30 px-4 text-[12.5px] font-medium text-cloak-gold hover:text-cloak-gold"
        >
          {busy && <LoaderCircleIcon size={13} className="mr-1.5 animate-spin" />}
          Create group
        </Button>
      </div>
    </div>
  );
}

/** Standalone group creation dialog (chat list “+” menu). */
export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetDialogContent className="max-w-md border-cloak-border bg-cloak-bg-elevated p-0 text-cloak-text sm:max-w-md">
        <DialogHeader className="shrink-0 px-5 pb-1 pt-5">
          <DialogTitle className="cloak-display text-lg font-medium">
            New group
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-cloak-text-muted">
            Only members know the group exists. You become its owner.
          </DialogDescription>
        </DialogHeader>
        <GroupCreateForm onDone={() => onOpenChange(false)} />
      </SheetDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* New chat                                                            */
/* ------------------------------------------------------------------ */

export function NewChatModal({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (contactId: string, opts?: { ghost?: boolean }) => void;
}) {
  const contacts = useCloakStore((s) => s.contacts);
  const conversations = useCloakStore((s) => s.conversations);
  const [tab, setTab] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [ghostDirect, setGhostDirect] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.cloakId.toLowerCase().includes(q)
    );
  }, [contacts, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTab("direct");
      }}
    >
      <SheetDialogContent className="max-w-md border-cloak-border bg-cloak-bg-elevated p-0 text-cloak-text sm:max-w-md">
        <DialogHeader className="shrink-0 px-5 pb-1 pt-5">
          <DialogTitle className="cloak-display text-lg font-medium">
            New chat
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-cloak-text-muted">
            Direct chats and groups — people reach you by Cloak ID, never by
            phone number.
          </DialogDescription>
        </DialogHeader>

        {/* Direct / Group segmented control — pinned under the header,
            i.e. just under the status bar on phones (user request) */}
        <div className="shrink-0 px-5 pb-3">
          <div className="grid grid-cols-2 gap-1 rounded-full border border-cloak-border bg-cloak-surface p-1">
            {([
              { id: "direct", label: "Direct chat", icon: MessageCircleIcon },
              { id: "group", label: "New group", icon: UsersRoundIcon },
            ] as const).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12.5px] font-medium transition-colors",
                  tab === t.id
                    ? "bg-cloak-gold-soft text-cloak-gold"
                    : "text-cloak-text-secondary hover:text-cloak-text"
                )}
              >
                <t.icon size={13} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "group" ? (
          <GroupCreateForm onDone={() => onOpenChange(false)} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
        {/* Ghost chat toggle (user request: create ghost chats from here) */}
        <div className="shrink-0 px-5 pb-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-cloak-border bg-cloak-bg/50 px-3.5 py-2.5">
            <span className="flex items-start gap-2.5">
              <GhostGlyph size={14} color="currentColor" className="mt-0.5 shrink-0 text-cloak-text" />
              <span>
                <span className="block text-[12.5px] font-medium text-cloak-text">Ghost chat</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-cloak-text-muted">
                  {ghostDirect
                    ? "Messages vanish 1 day after sending — change it in chat settings."
                    : "Off — messages are kept. Turn on to make them disappear."}
                </span>
              </span>
            </span>
            <Switch checked={ghostDirect} onCheckedChange={setGhostDirect} aria-label="Create as ghost chat" />
          </label>
        </div>
        <div className="shrink-0 px-5 pb-3">
          <label className="flex items-center gap-2.5 rounded-full border border-cloak-border bg-cloak-surface px-4 py-2">
            <SearchIcon size={14} className="shrink-0 text-cloak-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              className="w-full bg-transparent text-[13px] text-cloak-text outline-none placeholder:text-cloak-text-muted"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-cloak-text-secondary">
                No matching contacts.
              </p>
              <p className="mt-1 text-xs text-cloak-text-muted">
                Add someone by their Cloak ID to start chatting.
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5 pb-2">
              {filtered.map((c) => {
                const existing = conversations.find(
                  (x) => x.contactId === c.id && !x.isGroup
                );
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => onPick(c.id, { ghost: ghostDirect })}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-cloak-surface"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-surface text-[12px] font-semibold text-cloak-text-secondary">
                        {c.avatarInitials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-cloak-text">
                          {c.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-cloak-text-muted">
                          {c.cloakId}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                          existing
                            ? "border-cloak-border text-cloak-text-muted"
                            : "border-cloak-gold/30 bg-cloak-gold-soft/50 text-cloak-gold"
                        )}
                      >
                        {existing ? "Chat" : "Start"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-cloak-border px-5 py-3.5">
          <p className="text-[11px] text-cloak-text-muted">
            Can&apos;t find them? Send an invite.
          </p>
          <Button
            variant="outline"
            className="h-8 border-cloak-border-strong text-[12.5px] text-cloak-text hover:bg-cloak-surface"
            onClick={() => {
              onOpenChange(false);
              navigate("/app/contacts");
            }}
          >
            <UserPlusIcon size={13} className="mr-1.5" />
            Add contact
          </Button>
        </div>
          </div>
        )}
      </SheetDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Create filter                                                       */
/* ------------------------------------------------------------------ */

export function CreateFilterDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (filterId: string) => void;
}) {
  const conversations = useCloakStore((s) => s.conversations);
  const contacts = useCloakStore((s) => s.contacts);
  const addChatFilter = useCloakStore((s) => s.addChatFilter);

  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const la = a.messages[a.messages.length - 1]?.createdAt ?? 0;
      const lb = b.messages[b.messages.length - 1]?.createdAt ?? 0;
      return lb - la;
    });
  }, [conversations]);

  const nameOf = (conversationId: string) => {
    const c = conversations.find((x) => x.id === conversationId);
    if (!c) return "Conversation";
    if (c.isGroup) return c.groupName ?? "Group";
    return contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";
  };

  const initialsOf = (conversationId: string) => {
    const c = conversations.find((x) => x.id === conversationId);
    if (!c) return "··";
    if (c.isGroup) return initialsOfName(c.groupName ?? "Group");
    return contacts.find((x) => x.id === c.contactId)?.avatarInitials ?? "··";
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = () => {
    const trimmed = label.trim();
    if (!trimmed || selected.size === 0) return;
    const id = addChatFilter(trimmed, [...selected]);
    setLabel("");
    setSelected(new Set());
    onOpenChange(false);
    onCreated?.(id);
  };

  const valid = label.trim().length > 0 && selected.size > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setLabel("");
          setSelected(new Set());
        }
      }}
    >
      <SheetDialogContent className="max-w-md border-cloak-border bg-cloak-bg-elevated p-0 text-cloak-text sm:max-w-md">
        <DialogHeader className="shrink-0 px-5 pb-1 pt-5">
          <DialogTitle className="cloak-display text-lg font-medium">
            New filter
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-cloak-text-muted">
            Name the filter and choose which chats belong to it. It appears as
            a tab under search.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Filter name — e.g. Family, Work"
            aria-label="Filter name"
            className="border-cloak-border bg-cloak-surface text-[13.5px] text-cloak-text placeholder:text-cloak-text-muted"
          />

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-cloak-text-muted">
              <MessageCircleIcon size={11} />
              Include chats ({selected.size})
            </div>
            <div className="rounded-xl border border-cloak-border bg-cloak-surface/40">
              <ul className="space-y-0.5 p-1.5">
                {sorted.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                          checked ? "bg-cloak-gold-soft/40" : "hover:bg-cloak-surface"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(c.id)}
                          className="border-cloak-border-strong data-[state=checked]:border-cloak-gold/50 data-[state=checked]:bg-cloak-gold/20 data-[state=checked]:text-cloak-gold"
                        />
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[10.5px] font-semibold text-cloak-text-secondary">
                          {initialsOf(c.id)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-cloak-text">
                          {nameOf(c.id)}
                        </span>
                        {checked && (
                          <CheckIcon size={13} className="shrink-0 text-cloak-gold" />
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-cloak-border px-5 py-3.5">
          <Button
            variant="ghost"
            className="h-8 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <button
            onClick={create}
            disabled={!valid}
            className={cn(
              "bg-cloak-gold/20 hover:bg-cloak-gold/25 h-8 rounded-full border border-cloak-gold/30 px-4 text-[12.5px] font-medium text-cloak-gold transition-opacity",
              !valid && "cursor-not-allowed opacity-40"
            )}
          >
            Create filter
          </button>
        </div>
      </SheetDialogContent>
    </Dialog>
  );
}
