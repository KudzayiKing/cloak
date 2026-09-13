"use client";

/*
 * NotificationsCentre (groups & circles spec §62) — the in-app surface for
 * structural events: membership, roles, policy, join requests. Message
 * content NEVER appears here by construction (the server stores none).
 * Bell entry points: desktop rail (bottom group) + mobile header.
 */

import { useEffect, useState } from "react";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { cn } from "@/lib/utils";
import {
  BellIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  ShieldCheckIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  WaypointsIcon,
} from "@animateicons/react/lucide";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";

function iconFor(type: string) {
  switch (type) {
    case "circle.added":
    case "circle.join_approved":
      return <CircleCheckIcon size={15} />;
    case "circle.removed":
    case "group.removed":
    case "circle.join_denied":
      return <UserMinusIcon size={15} />;
    case "circle.role_changed":
      return <ShieldCheckIcon size={15} />;
    case "circle.policy_changed":
      return <ShieldCheckIcon size={15} />;
    case "circle.join_requested":
      return <UserPlusIcon size={15} />;
    case "group.added":
    case "group.join_approved":
      return <UsersIcon size={15} />;
    default:
      return <WaypointsIcon size={15} />;
  }
}

function relative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

/**
 * Bell button with unread badge. The desktop rail carries the visible
 * "Notifications" label when expanded (the collapsed rail is icon-only
 * like its Cloak/Settings siblings). The mobile header is ICON-ONLY
 * (owner de-clutter round: header = bell + three-dot menu, no text) —
 * the unread badge sits on the bell's corner.
 */
export function NotificationsBell({ variant, collapsed }: { variant: "rail" | "header"; collapsed?: boolean }) {
  const unread = useCloakStore((s) => s.unreadInbox);
  const [open, setOpen] = useState(false);

  const openPanel = () => {
    setOpen(true);
    void useCloakStore.getState().fetchInbox();
  };

  const showLabel = variant === "rail" && !collapsed;

  return (
    <>
      <button
        onClick={openPanel}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title={showLabel ? undefined : "Notifications"}
        className={cn(
          "relative transition-colors",
          variant === "rail"
            ? collapsed
              ? "mx-auto grid h-10 w-10 place-items-center rounded-lg text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
              : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
            : "flex h-9 items-center gap-1.5 rounded-full px-2.5 text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
        )}
      >
        <BellIcon size={17} />
        {showLabel && (
          <span className="flex-1 whitespace-nowrap text-left">Notifications</span>
        )}
        {unread > 0 && (
          <span
            className={cn(
              "grid place-items-center rounded-full bg-cloak-gold text-[9px] font-bold leading-none text-black",
              variant === "rail"
                ? collapsed
                  ? "absolute right-1 top-1 h-4 min-w-4 px-1"
                  : "absolute left-7 top-1.5 h-4 min-w-4 px-1"
                : "absolute right-0.5 top-0.5 h-4 min-w-4 px-1"
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <NotificationsPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

function NotificationsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const inbox = useCloakStore((s) => s.inbox);
  const unreadInbox = useCloakStore((s) => s.unreadInbox);
  const inboxLoading = useCloakStore((s) => s.inboxLoading);
  const markInboxRead = useCloakStore((s) => s.markInboxRead);
  const fetchInbox = useCloakStore((s) => s.fetchInbox);

  /* Refresh when the panel opens. */
  useEffect(() => {
    if (open) void fetchInbox();
  }, [open, fetchInbox]);

  const openTarget = (n: { circleId?: string; groupId?: string }) => {
    if (n.circleId) {
      navigate(`/app/circles/${n.circleId}`);
      onOpenChange(false);
    } else if (n.groupId) {
      useCloakStore.getState().setActiveConversation(n.groupId);
      navigate("/app/messages");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="cloak-display text-lg">Notifications</DialogTitle>
          <DialogDescription className="text-cloak-text-secondary">
            Membership, role and policy events — never message content (§62).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between px-1">
          <p className="text-[11.5px] text-cloak-text-muted">
            {unreadInbox > 0 ? `${unreadInbox} unread` : "All caught up"}
          </p>
          {unreadInbox > 0 && (
            <button
              onClick={() => void markInboxRead(undefined, true)}
              className="inline-flex items-center gap-1 text-[11.5px] text-cloak-gold hover:underline"
            >
              <CheckCheckIcon size={13} />
              Mark all read
            </button>
          )}
        </div>

        <div className="cloak-scroll max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
          {inboxLoading && inbox.length === 0 ? (
            <p className="px-1 py-6 text-center text-[13px] text-cloak-text-muted">Loading…</p>
          ) : inbox.length === 0 ? (
            <p className="px-1 py-6 text-center text-[13px] text-cloak-text-muted">
              No notifications yet. Events arrive when people add you, change
              your roles, or update Circle security.
            </p>
          ) : (
            inbox.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) void markInboxRead(n.id);
                  openTarget(n);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  n.read
                    ? "border-cloak-border bg-cloak-surface/40"
                    : "border-cloak-gold/25 bg-cloak-gold-soft/20"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border",
                    n.read
                      ? "border-cloak-border bg-cloak-bg text-cloak-text-muted"
                      : "border-cloak-gold/30 bg-cloak-bg text-cloak-gold"
                  )}
                >
                  {iconFor(n.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-cloak-text">{n.title}</span>
                  {n.body && (
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-cloak-text-secondary">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[10.5px] text-cloak-text-muted">
                    {relative(n.createdAt)}
                  </span>
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cloak-gold" />}
              </button>
            ))
          )}
        </div>
      </RiseDialogContent>
    </Dialog>
  );
}
