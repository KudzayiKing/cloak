"use client";

/*
 * ChatSidebar + ChatListItem (spec §17, user feedback round 2).
 * Search, filter tabs (All / Unread / Groups / user-created + add button),
 * new-chat modal, mobile FAB, unread/pinned/muted/verified/ghost states,
 * and a Cloak Mode redacted preview state.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatListTime } from "@/lib/cloak/utils";
import { useCloakStore } from "@/stores/cloak-store";
import type { Conversation } from "@/lib/cloak/types";
import {
  SearchIcon,
  CirclePlusIcon,
  ShieldCheckIcon,
  PinIcon,
  VolumeXIcon,
  CheckCheckIcon,
  PlusIcon,
  FolderPlusIcon,
  UserPlusIcon,
  XIcon,
  UsersRoundIcon,
} from "@animateicons/react/lucide";
import { navigate } from "@/hooks/use-hash-route";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GhostGlyph } from "@/components/cloak/shared/ghost-icon";
import { NewChatModal, CreateFilterDialog, CreateGroupDialog } from "./chat-dialogs";
import { E2eeRestoreBanner } from "./e2ee-restore-banner";
import { initialsOf } from "@/lib/cloak/utils";

export function ChatSidebar({
  activeId,
  onSelect,
  className,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const conversations = useCloakStore((s) => s.conversations);
  const contacts = useCloakStore((s) => s.contacts);
  const cloakMode = useCloakStore((s) => s.cloakMode);
  const chatFilters = useCloakStore((s) => s.chatFilters);
  const removeChatFilter = useCloakStore((s) => s.removeChatFilter);
  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState("all");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  const sorted = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const la = a.messages[a.messages.length - 1]?.createdAt ?? 0;
      const lb = b.messages[b.messages.length - 1]?.createdAt ?? 0;
      return lb - la;
    });
  }, [conversations]);

  const filtered = useMemo(() => {
    let list = sorted;
    if (filterId === "unread") {
      list = list.filter((c) => !!c.unreadCount);
    } else if (filterId === "groups") {
      list = list.filter((c) => c.isGroup);
    } else if (filterId === "circles") {
      /* Circles filter (groups & circles spec §50): only groups that are
         linked to a Circle I belong to. */
      list = list.filter((c) => !!c.circleId);
    } else if (filterId !== "all") {
      const f = chatFilters.find((x) => x.id === filterId);
      if (f) list = list.filter((c) => f.conversationIds.includes(c.id));
    }
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c) => {
      const contact = contacts.find((x) => x.id === c.contactId);
      const name = c.isGroup ? c.groupName ?? "Group" : contact?.name ?? "";
      const last = c.messages[c.messages.length - 1]?.body ?? "";
      return name.toLowerCase().includes(q) || last.toLowerCase().includes(q);
    });
  }, [sorted, contacts, query, filterId, chatFilters]);

  const startChatWith = async (
    contactId: string,
    opts?: { ghost?: boolean }
  ) => {
    const store = useCloakStore.getState();
    const contact = store.contacts.find((c) => c.id === contactId);
    if (!contact) return;
    /* Server round-trip so "New ghost chat" also flips existing DMs into
       ghost mode (server truth), instead of a local-only placeholder. */
    const id = await store.openServerConversation(
      contact.cloakId.replace(/^@/, ""),
      opts?.ghost ? 86400 : undefined
    );
    if (id) {
      onSelect(id);
      setNewChatOpen(false);
    }
  };

  return (
    <aside
      className={cn(
        "relative flex min-h-0 flex-col border-r border-cloak-border bg-cloak-bg-elevated pt-14 md:pt-0",
        className
      )}
      aria-label="Conversations"
    >
      {/* Desktop header — hidden on mobile (title removed per feedback) */}
      <div className="hidden items-center justify-between px-4 pb-3 pt-4 md:flex">
        <h1 className="text-base font-semibold text-cloak-text">Chats</h1>
        <button
          aria-label="New conversation"
          onClick={() => setNewChatOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-cloak-border bg-cloak-surface text-cloak-text-secondary transition-colors hover:border-cloak-gold/30 hover:text-cloak-gold"
        >
          <CirclePlusIcon size={17} />
        </button>
      </div>

      {/* Mobile: 15px top padding above the search field (user feedback) */}
      <div className="px-3.5 pb-2.5 pt-[15px] md:pt-4">
        <label className="flex items-center gap-2.5 rounded-full border border-cloak-border bg-cloak-surface px-4 py-2">
          <SearchIcon size={14} className="shrink-0 text-cloak-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-[13px] text-cloak-text outline-none placeholder:text-cloak-text-muted"
          />
        </label>
      </div>

      {/* E2EE: this device lacks the identity key — offer the passphrase
          restore (only renders when the store marks keys-pending) */}
      <E2eeRestoreBanner className="mx-3.5" />

      {/* Filter tabs under the search input */}
      <div className="cloak-scroll flex items-center gap-1.5 overflow-x-auto px-3.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterChip
          label="All"
          active={filterId === "all"}
          onClick={() => setFilterId("all")}
        />
        <FilterChip
          label="Unread"
          active={filterId === "unread"}
          onClick={() => setFilterId("unread")}
        />
        <FilterChip
          label="Groups"
          active={filterId === "groups"}
          onClick={() => setFilterId("groups")}
        />
        <FilterChip
          label="Circles"
          active={filterId === "circles"}
          onClick={() => setFilterId("circles")}
        />
        {chatFilters.map((f) => (
          <FilterChip
            key={f.id}
            label={f.label}
            active={filterId === f.id}
            onClick={() => setFilterId(f.id)}
            removable
            onRemove={() => {
              removeChatFilter(f.id);
              if (filterId === f.id) setFilterId("all");
            }}
          />
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Add filter or contact"
              title="Add filter or contact"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-cloak-border-strong text-cloak-text-muted transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold"
            >
              <PlusIcon size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="border-cloak-border bg-cloak-bg-elevated text-cloak-text"
          >
            <DropdownMenuItem
              onClick={() => setGroupDialogOpen(true)}
              className="gap-2 text-[13px] focus:bg-cloak-surface focus:text-cloak-text"
            >
              <UsersRoundIcon size={14} className="text-cloak-text-muted" />
              New group
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setFilterDialogOpen(true)}
              className="gap-2 text-[13px] focus:bg-cloak-surface focus:text-cloak-text"
            >
              <FolderPlusIcon size={14} className="text-cloak-text-muted" />
              New filter
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate("/app/contacts")}
              className="gap-2 text-[13px] focus:bg-cloak-surface focus:text-cloak-text"
            >
              <UserPlusIcon size={14} className="text-cloak-text-muted" />
              Add contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="cloak-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-3">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <SearchIcon size={22} className="text-cloak-text-muted" />
            <p className="mt-3 text-sm text-cloak-text-secondary">
              {filterId === "all"
                ? "No matching conversations."
                : "Nothing in this filter yet."}
            </p>
            <p className="mt-1 text-xs text-cloak-text-muted">
              {filterId === "all"
                ? "Try a different name or phrase."
                : "Switch filters or start a new chat."}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <ChatListItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                cloakMode={cloakMode}
                onSelect={() => onSelect(c.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Mobile FAB — new chat (user feedback: bottom-right) */}
      <button
        aria-label="New chat"
        onClick={() => setNewChatOpen(true)}
        className="cloak-light-shadowless bg-cloak-gold/20 hover:bg-cloak-gold/25 fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full border border-cloak-gold/30 text-cloak-gold shadow-lg shadow-black/50 transition-transform active:scale-95 md:hidden"
      >
        <PlusIcon size={22} />
      </button>

      <NewChatModal
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onPick={startChatWith}
      />
      <CreateGroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
      />
      <CreateFilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        onCreated={(id) => setFilterId(id)}
      />
    </aside>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  removable,
  onRemove,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  removable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-cloak-gold/40 bg-cloak-gold-soft text-cloak-gold"
          : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:border-cloak-border-strong hover:text-cloak-text"
      )}
    >
      <button onClick={onClick} className="whitespace-nowrap">
        {label}
      </button>
      {removable && (
        <button
          aria-label={`Remove ${label} filter`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="grid h-3.5 w-3.5 place-items-center rounded-full text-cloak-text-muted transition-colors hover:text-cloak-danger"
        >
          <XIcon size={10} />
        </button>
      )}
    </span>
  );
}

function ChatListItem({
  conversation,
  active,
  cloakMode,
  onSelect,
}: {
  conversation: Conversation;
  active: boolean;
  cloakMode: boolean;
  onSelect: () => void;
}) {
  const contact = useCloakStore((s) =>
    s.contacts.find((x) => x.id === conversation.contactId)
  );
  const last = conversation.messages[conversation.messages.length - 1];
  const name = conversation.isGroup ? conversation.groupName ?? "Group" : contact?.name ?? "Unknown";

  const lastLine = () => {
    if (!last) return "No messages yet";
    switch (last.kind) {
      case "system":
        return last.body;
      case "ai":
        return "Cloak Intelligence · answer";
      case "view-once":
        return "View-once media";
      case "voice":
        return "Voice note";
      default:
        return last.body;
    }
  };

  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
          active ? "bg-cloak-gold-soft/50" : "hover:bg-cloak-surface"
        )}
      >
        {/* Avatar */}
        <span
          className={cn(
            // Spec (user images): 48×48 avatar on web & mobile (WhatsApp Web 49px maps to 48), border-radius 50%
            "relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
            active
              ? "bg-cloak-gold/20 text-cloak-gold ring-1 ring-inset ring-cloak-gold/40"
              : "bg-cloak-surface text-cloak-text-secondary border border-cloak-border"
          )}
        >
          {conversation.isGroup
            ? initialsOf(conversation.groupName ?? "Group")
            : contact?.avatarInitials}
          {conversation.ghost && (
            <span className="absolute -bottom-1 -right-1 grid h-4.5 w-4.5 place-items-center rounded-full bg-cloak-bg p-0.5">
              <GhostGlyph size={11} />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* Spec: mobile 17px semibold (iOS default) · web 16px regular (WhatsApp Web) */}
              <span className="truncate text-[17px] font-semibold leading-tight text-cloak-text md:text-base md:font-normal">{name}</span>
              {contact?.verification === "verified" && (
                <ShieldCheckIcon size={12} className="shrink-0 text-cloak-gold" />
              )}
              {conversation.pinned && <PinIcon size={11} className="shrink-0 text-cloak-text-muted" />}
              {conversation.muted && <VolumeXIcon size={11} className="shrink-0 text-cloak-text-muted" />}
            </span>
            <span className="shrink-0 text-[11px] text-cloak-text-muted md:text-xs">
              {last ? formatListTime(last.createdAt) : ""}
            </span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            {/* Spec: 14px regular preview both breakpoints; gray = theme muted token (dark-theme equivalent of #667781) */}
            <span
              className={cn(
                "truncate text-[14px]",
                conversation.unreadCount
                  ? "text-cloak-text-secondary"
                  : "text-cloak-text-muted"
              )}
            >
              {/* Cloak Mode: only the redacted bar — no preview text at all */}
              {cloakMode ? (
                <span
                  aria-hidden="true"
                  className="cloak-redacted inline-block h-3 w-24 max-w-full align-middle"
                />
              ) : (
                lastLine()
              )}
            </span>
            {conversation.unreadCount ? (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-cloak-gold/20 px-1.5 text-[10px] font-semibold text-cloak-gold">
                {conversation.unreadCount}
              </span>
            ) : last?.authorId === "me" && last.status === "read" ? (
              <CheckCheckIcon size={12} className="shrink-0 text-cloak-text-muted" />
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
