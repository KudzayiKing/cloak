"use client";

/*
 * ConversationView (spec §18) — header, message area, composer.
 * Handles locked conversations, Ghost Chat surface treatment,
 * Cloak Mode, and the @Cloak orchestration pipeline.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useCloakStore } from "@/stores/cloak-store";
import { cloakOrchestrator, ensureSeededMemories } from "@/ai/orchestrator/CloakOrchestrator";
import { SEED_MEMORIES } from "@/lib/cloak/demo-data";
import type { Message } from "@/lib/cloak/types";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  PhoneIcon,
  VideoIcon,
  EllipsisIcon,
  LockIcon,
  KeyRoundIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
} from "@animateicons/react/lucide";
import { GhostGlyph } from "@/components/cloak/shared/ghost-icon";
import { CloakMark } from "@/components/cloak/brand/CloakLogo";
import { navigate } from "@/hooks/use-hash-route";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/cloak/utils";

export function ConversationView({
  onOpenSecurityPanel,
  onBack,
  securityPanelOpen,
}: {
  onOpenSecurityPanel: () => void;
  onBack: () => void;
  securityPanelOpen?: boolean;
}) {
  const conversation = useCloakStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId) ?? null
  );
  const contact = useCloakStore((s) =>
    s.contacts.find((c) => c.id === conversation?.contactId)
  );
  const cloakMode = useCloakStore((s) => s.cloakMode);
  const chatFontSize = useCloakStore((s) => s.chatFontSize);
  const aiSettings = useCloakStore((s) => s.ai);
  const sendMessage = useCloakStore((s) => s.sendMessage);
  const sendAttachment = useCloakStore((s) => s.sendAttachment);
  const appendAIMessage = useCloakStore((s) => s.appendAIMessage);
  const markConversationRead = useCloakStore((s) => s.markConversationRead);
  const markViewOnceViewed = useCloakStore((s) => s.markViewOnceViewed);
  const unlockConversation = useCloakStore((s) => s.unlockConversation);
  const loadOlderMessages = useCloakStore((s) => s.loadOlderMessages);
  const historyHasMore = useCloakStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId)?.historyHasMore
  );
  const historyLoading = useCloakStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId)?.historyLoading
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /* Callback-ref state: the scroll effects must re-run when the scroller
     actually mounts (the early-return "no conversation" branch renders a
     different tree, so a plain [] effect would capture null forever). */
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [cloakPending, setCloakPending] = useState(false);

  /* Scroll anchoring (history pagination): auto-scroll to the bottom ONLY
     when the conversation switches or a NEW message arrives (last id
     changes) — never when older pages are prepended. For prepends we
     restore the viewport by the scroll-height delta instead. */
  const lastMsgIdRef = useRef<string | null>(null);
  const lastConvIdRef = useRef<string | null>(null);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  /* Mobile: this column renders hidden (display:none) until the user enters
     a conversation. scrollTop writes on a hidden element are no-ops, so a
     jump computed while hidden parks here and flushes when the element
     gains real layout (ResizeObserver below). */
  const pendingBottomRef = useRef(false);

  const conversationId = conversation?.id ?? null;
  const unreadCount = conversation?.unreadCount ?? 0;

  const lastMessageId = conversation?.messages.length
    ? conversation.messages[conversation.messages.length - 1]!.id
    : null;

  useEffect(() => {
    const convSwitched = conversationId !== lastConvIdRef.current;
    if (!convSwitched && lastMessageId === lastMsgIdRef.current) return;
    lastConvIdRef.current = conversationId;
    lastMsgIdRef.current = lastMessageId;
    anchorRef.current = null; // a jump cancels any pending restore
    const el = scrollRef.current;
    if (!el) return;
    pendingBottomRef.current = true;
    /* Hidden (mobile list view) or not laid out yet -> the ResizeObserver
       flushes the parked jump when real layout arrives. */
    if (el.offsetParent === null || el.scrollHeight === 0) return;
    const raf = requestAnimationFrame(() => {
      pendingBottomRef.current = false;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [conversationId, lastMessageId, conversation?.messages.length]);

  /* Flush a parked jump when the scroller gains real layout. The
     hidden->visible transition IS "the user entered this chat" on mobile
     (the column is display:none until then — even when the conversation
     was already active), so it always lands on the newest message.
     Later size changes only flush an explicitly parked jump. */
  useEffect(() => {
    const el = scrollerEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    let hidden = el.offsetParent === null || el.scrollHeight === 0;
    const ro = new ResizeObserver(() => {
      const nowHidden = el.offsetParent === null || el.scrollHeight === 0;
      const wasHidden = hidden;
      hidden = nowHidden;
      if (nowHidden) return;
      if (wasHidden) {
        pendingBottomRef.current = false;
        el.scrollTop = el.scrollHeight;
        return;
      }
      if (pendingBottomRef.current && el.scrollHeight > 0) {
        pendingBottomRef.current = false;
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollerEl]);

  /* Restore the viewport after an older page prepends above the fold. */
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = scrollRef.current;
    if (!el || el.offsetParent === null) return; // hidden: drop the restore
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
    });
    return () => cancelAnimationFrame(raf);
  }, [conversation?.messages.length]);

  const handleLoadOlder = () => {
    const el = scrollRef.current;
    if (!el || !conversationId || historyLoading) return;
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    void loadOlderMessages(conversationId).then((loaded) => {
      if (!loaded) anchorRef.current = null;
    });
  };

  /* Near the top with more history? Pull the next page automatically. */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !conversation) return;
    if (el.scrollTop > 90 || historyLoading || historyHasMore === false) return;
    if (!conversationId || conversation.messages.length === 0) return;
    if (anchorRef.current) return; // a page is already in flight
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    void loadOlderMessages(conversationId).then((loaded) => {
      if (!loaded) anchorRef.current = null;
    });
  };

  if (!conversation) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col md:p-3">
        <div className="flex flex-1 flex-col items-center justify-center border-0 bg-cloak-bg px-8 text-center md:rounded-3xl md:border md:border-cloak-border md:shadow-xl md:shadow-black/25">
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-cloak-border bg-cloak-surface text-cloak-gold">
          <KeyRoundIcon size={22} />
        </span>
        <p className="mt-5 text-base font-medium text-cloak-text">
          Your conversations will appear here.
        </p>
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-cloak-text-muted">
          Start a private conversation from Contacts, or pick an existing chat.
        </p>
        <Button
          variant="outline"
          className="mt-6 border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
          onClick={() => navigate("/app/contacts")}
        >
          Open Contacts
        </Button>
        </div>
      </div>
    );
  }

  const name = conversation.isGroup ? conversation.groupName : contact?.name ?? "Conversation";
  const verified = contact?.verification === "verified";
  const isLocked = conversation.locked && !unlocked[conversation.id];
  /* §39 effective AI access (server truth) gates @Cloak here. */
  const aiEffective = conversation.aiEffective ?? conversation.aiAccess;
  const aiBlocked = aiEffective === "blocked" || !aiSettings.enabled;

  /* Chat text size (Settings > Appearance): CSS var the bubbles read. */
  const bubbleTextSize =
    chatFontSize === "small" ? "12.5px" : chatFontSize === "large" ? "15.5px" : "13.5px";

  const handleSend = async (body: string) => {
    sendMessage(conversation.id, body);

    /* @Cloak works in every chat — mention it anywhere, any case. */
    const isCloakAsk = /@cloak\b/i.test(body);
    if (!isCloakAsk || aiBlocked) return;

    ensureSeededMemories(SEED_MEMORIES);
    setCloakPending(true);

    try {
      const query = body.replace(/@cloak\b/gi, "").trim() || body;

      const result = await cloakOrchestrator.run({
        query,
        retrieval: {
          scope: aiSettings.memoryScope,
          currentConversationId: conversation.id,
        },
        allowLocalLLM: true,
      });

      appendAIMessage(conversation.id, {
        id: `m-ai-${Date.now()}`,
        conversationId: conversation.id,
        authorId: "cloak",
        kind: "ai",
        body: result.answer,
        createdAt: Date.now(),
        status: "read",
        ai: result.ai,
      });
    } finally {
      setCloakPending(false);
    }
  };

  const handleAttach = async (files: File[]) => {
    if (!conversation || isLocked) return;
    for (const file of files) {
      await sendAttachment(conversation.id, file);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-cloak-bg md:p-3">
      {/* Fullscreen chat on mobile — no outer border, square header top and
          composer bottom edges (user feedback round 4). Desktop keeps the
          floating rounded card. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-cloak-bg md:rounded-3xl md:border md:border-cloak-border md:shadow-xl md:shadow-black/25">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-cloak-border bg-cloak-bg-elevated/60 px-3 py-2.5 md:px-4">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="flex h-9 w-9 items-center justify-center rounded-full text-cloak-text-secondary transition-colors hover:bg-cloak-surface md:hidden"
        >
          <ArrowLeftIcon size={18} />
        </button>

        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cloak-surface text-[11px] font-semibold text-cloak-text-secondary border border-cloak-border">
          {conversation.isGroup
            ? initialsOf(conversation.groupName ?? "Group")
            : contact?.avatarInitials}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[14px] font-medium text-cloak-text">{name}</h2>
            {verified && <ShieldCheckIcon size={13} className="shrink-0 text-cloak-gold" />}
            {conversation.ghost && <GhostGlyph size={14} className="shrink-0" />}
            {conversation.locked && <LockIcon size={12} className="shrink-0 text-cloak-warning" />}
          </div>
          <p className="truncate text-[11px] text-cloak-text-muted">
            {conversation.isGroup
              ? `${conversation.circleName ? `${conversation.circleName} · ` : ""}${conversation.memberCount ?? ""} member${conversation.memberCount === 1 ? "" : "s"} · protected`
              : verified
                ? `${contact?.cloakId} · verified`
                : contact?.cloakId}
          </p>
        </div>

        <div className="flex items-center gap-0.5">
          <HeaderAction label="Audio call" icon={PhoneIcon} />
          <HeaderAction label="Video call" icon={VideoIcon} />
          <HeaderAction
            label="Conversation details"
            icon={EllipsisIcon}
            onClick={onOpenSecurityPanel}
            active={securityPanelOpen}
          />
        </div>
      </header>

      {/* Locked overlay */}
      {isLocked ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-cloak-border bg-cloak-surface text-cloak-warning">
            <LockIcon size={22} />
          </span>
          <p className="mt-5 text-base font-medium text-cloak-text">This conversation is locked</p>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-cloak-text-muted">
            Unlock to read the message history. Locked chats stay hidden in
            Cloak Mode and app switchers where the platform allows.
          </p>
          <Button
            className="bg-cloak-gold/20 hover:bg-cloak-gold/25 mt-6 border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
            onClick={() => {
              unlockConversation(conversation.id);
              setUnlocked((u) => ({ ...u, [conversation.id]: true }));
            }}
          >
            Unlock conversation
          </Button>
        </div>
      ) : (
        <>
          {/* Message area */}
          <div
            ref={(node) => {
              scrollRef.current = node;
              setScrollerEl(node);
            }}
            onScroll={handleScroll}
            style={{ "--chat-bubble-text": bubbleTextSize } as CSSProperties}
            className={cn(
              "cloak-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 md:px-6",
              conversation.ghost && "border-x-0"
            )}
          >
            {/* History pagination header row: loading state, a manual
               trigger (the reliable path on touch devices), or the honest
               end-of-history divider. */}
            {conversation.messages.length > 0 &&
              (historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-1 text-[11.5px] text-cloak-text-muted">
                  <LoaderCircleIcon size={13} className="animate-spin" />
                  Decrypting earlier messages…
                </div>
              ) : historyHasMore !== false ? (
                <div className="flex justify-center py-1">
                  <button
                    onClick={handleLoadOlder}
                    className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-bg-elevated/70 px-3.5 py-1.5 text-[11.5px] font-medium text-cloak-text-secondary transition-colors hover:border-cloak-border-strong hover:text-cloak-text"
                  >
                    <ChevronUpIcon size={13} />
                    Load earlier messages
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-1 text-cloak-text-muted">
                  <span className="h-px flex-1 bg-cloak-border" />
                  <span className="text-[10.5px] uppercase tracking-[0.16em]">
                    Beginning of conversation
                  </span>
                  <span className="h-px flex-1 bg-cloak-border" />
                </div>
              ))}
            {conversation.ghost && (
              <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl border border-dashed border-cloak-warning/30 bg-cloak-warning/5 px-4 py-2.5 text-center text-[11px] leading-relaxed text-cloak-warning">
                <GhostGlyph size={13} className="shrink-0" />
                <span>
                  Ghost Chat — messages disappear {timerLabel(conversation.ghostTimer)} after sending.
                  AI access is {aiBlocked ? "off" : "on"} for this conversation.
                </span>
              </div>
            )}
            {conversation.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                showAuthor={
                  conversation.isGroup &&
                  m.authorId !== "me" &&
                  m.kind !== "system" &&
                  m.authorId !== "cloak"
                    ? m.authorName ?? "Member"
                    : undefined
                }
                cloakMode={cloakMode}
                onDownloadModel={() => navigate("/app/settings/ai")}
              />
            ))}
            {/* Cloak is answering inline (user feedback: AI lives in every chat) */}
            {cloakPending && (
              <div className="cloak-message-in flex justify-start">
                <div className="inline-flex items-center gap-2.5 rounded-3xl rounded-bl-lg border border-cloak-gold/25 bg-cloak-gold-soft/30 px-4 py-2.5">
                  <span className="text-cloak-gold">
                    <CloakMark size={14} />
                  </span>
                  <span className="text-[12px] text-cloak-text-secondary">
                    Cloak is thinking
                  </span>
                  <span className="flex items-end gap-0.5 pb-0.5">
                    <span className="cloak-typing-dot h-1 w-1 rounded-full bg-cloak-gold-bright" />
                    <span className="cloak-typing-dot h-1 w-1 rounded-full bg-cloak-gold-bright" />
                    <span className="cloak-typing-dot h-1 w-1 rounded-full bg-cloak-gold-bright" />
                  </span>
                </div>
              </div>
            )}
            {/* View-once tap target */}
            {conversation.messages.some((m) => m.kind === "view-once" && !m.viewed) && (
              <p className="pt-1 text-center text-[10px] text-cloak-text-muted">
                Tap a view-once file to open it. It will not open twice.
              </p>
            )}
          </div>

          {/* Composer — keyed per conversation so drafts never leak across chats */}
          <MessageComposer
            key={conversation.id}
            onSend={handleSend}
            onAttach={handleAttach}
            ghost={conversation.ghost}
            disabled={isLocked}
          />
        </>
      )}
      </div>
    </div>
  );
}

function timerLabel(t?: string): string {
  switch (t) {
    case "30s": return "30 seconds";
    case "5m": return "5 minutes";
    case "1h": return "1 hour";
    case "1d": return "1 day";
    case "7d": return "7 days";
    default: return "a custom window";
  }
}

function HeaderAction({
  label,
  icon: Icon,
  onClick,
  active,
}: {
  label: string;
  icon: typeof PhoneIcon;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full transition-colors",
        active
          ? "bg-cloak-gold-soft text-cloak-gold"
          : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
      )}
    >
      <Icon size={16} />
    </button>
  );
}
