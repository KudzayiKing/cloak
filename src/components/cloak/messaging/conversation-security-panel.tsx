"use client";

/*
 * ConversationSecurityPanel (spec §15, §18) — collapsible right context
 * panel: security details, group members/roles, AI permissions, retention,
 * identity.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCloakStore, type GroupMember } from "@/stores/cloak-store";
import { currentKeyVersion, myIdentityInfo } from "@/lib/crypto/e2ee-orchestrator";
import { Switch } from "@/components/ui/switch";
import { PanelCloseButton } from "@/components/cloak/shared/panel-close";
import {
  ShieldCheckIcon,
  LockIcon,
  SparklesIcon,
  UserRoundCheckIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
  UserPlusIcon,
  UserRoundMinusIcon,
  ShieldXIcon,
  LoaderCircleIcon,
  WaypointsIcon,
} from "@animateicons/react/lucide";
import { GhostGlyph } from "@/components/cloak/shared/ghost-icon";
import { navigate } from "@/hooks/use-hash-route";

const GHOST_OPTIONS = [
  { value: "30s", label: "30 seconds" },
  { value: "5m", label: "5 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
] as const;

export function ConversationSecurityPanel({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  const conversation = useCloakStore((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId) ?? null
  );
  const contact = useCloakStore((s) =>
    s.contacts.find((c) => c.id === conversation?.contactId)
  );
  const setConversationAiAccess = useCloakStore((s) => s.setConversationAiAccess);
  const setConversationGhostTimer = useCloakStore((s) => s.setConversationGhostTimer);
  const unlockConversation = useCloakStore((s) => s.unlockConversation);

  if (!conversation) return null;
  const verified = contact?.verification === "verified";
  const isGroup = !!conversation.isGroup;

  return (
    <aside
      className={cn(
        "cloak-scroll flex h-full flex-col overflow-y-auto border-l border-cloak-border bg-cloak-bg-elevated",
        className
      )}
      aria-label="Conversation security details"
    >
      <div className="flex items-center justify-between border-b border-cloak-border px-5 py-4">
        <h2 className="text-sm font-semibold text-cloak-text">Conversation</h2>
        <PanelCloseButton onClose={onClose} />
      </div>

      <div className="space-y-6 p-5">
        {/* Group members — server-authoritative membership */}
        {isGroup && <GroupMembersSection conversationId={conversation.id} />}
        {/* Security state */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
            <ShieldCheckIcon size={13} className="text-cloak-success" />
            Security
          </h3>
          <div className="space-y-2.5 text-[13px]">
            <E2eeRows conversationId={conversation.id} />
            <Row
              label="Identity"
              value={verified ? "Verified" : "Unverified"}
              state={verified ? "protected" : "attention"}
              action={
                !verified && contact
                  ? { label: "Verify", onClick: () => navigate("/app/contacts") }
                  : undefined
              }
            />
          </div>
          <E2eeKeyCard conversationId={conversation.id} />
        </section>

        {/* Ghost chat — server-enforced disappearing messages (user request:
            a real switch here, not a read-only status row) */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
            <GhostGlyph size={13} className="text-cloak-warning" />
            Ghost chat
          </h3>
          <div className="rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-cloak-text">
                  {conversation.ghost ? "Ghost chat on" : "Ghost chat off"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-cloak-text-muted">
                  {conversation.ghost
                    ? `Messages sent from now on vanish ${timerLabel(conversation.ghostTimer)} after sending — for everyone, server included.`
                    : "Turn on and every message sent here disappears automatically. Works in direct chats and groups."}
                </p>
              </div>
              <Switch
                checked={conversation.ghost}
                onCheckedChange={(v) =>
                  void setConversationGhostTimer(conversation.id, v ? "1d" : "off")
                }
                aria-label="Turn Ghost chat on or off"
              />
            </div>
            {conversation.ghost && (
              <div className="mt-3 border-t border-cloak-border pt-3">
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium text-cloak-warning">
                  <GhostGlyph size={12} />
                  Disappear after sending
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {GHOST_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => void setConversationGhostTimer(conversation.id, opt.value)}
                      className={cn(
                        "rounded-md border px-1.5 py-1.5 text-[10.5px] transition-colors",
                        conversation.ghostTimer === opt.value
                          ? "border-cloak-gold/40 bg-cloak-gold-soft text-cloak-gold-bright"
                          : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-[10.5px] leading-relaxed text-cloak-text-muted">
                  Already-sent messages keep their own timer. Turning Ghost off
                  stops new messages from disappearing.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* AI permissions */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
            <SparklesIcon size={13} className="text-cloak-gold" />
            Cloak Intelligence access
          </h3>
          <div className="space-y-3 rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] text-cloak-text">This conversation</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-cloak-text-muted">
                  Allow Cloak Intelligence to use this chat for retrieval.
                  {isGroup ? " Groups: the owner decides." : ""}
                </p>
              </div>
              <Switch
                checked={(conversation.aiEffective ?? (conversation.aiAccess === "allowed" ? "allowed" : "blocked")) !== "blocked"}
                disabled={isGroup && conversation.aiEffective === "blocked" && conversation.aiCircleDefault === "disabled" && conversation.aiAccess === "allowed"}
                onCheckedChange={(v) => void setConversationAiAccess(conversation.id, v)}
                aria-label="Allow AI access for this conversation"
              />
            </div>
            {/* §39 clamp display: the Circle policy overrides the group. */}
            {conversation.aiEffective === "blocked" && conversation.aiCircleDefault === "disabled" && (
              <div className="flex items-start gap-2 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/20 px-3 py-2 text-[11.5px] leading-relaxed text-cloak-gold-bright">
                <ShieldCheckIcon size={13} className="mt-0.5 shrink-0" />
                Clamped by {conversation.circleName ?? "the Circle"}: the Circle
                security policy disables AI here — a group can never weaken a
                Circle restriction (§39).
              </div>
            )}
            {conversation.aiEffective === "limited" && (
              <p className="text-[11px] leading-relaxed text-cloak-text-muted">
                {conversation.circleName ?? "The Circle"} limits AI to the current request only.
              </p>
            )}
            <div className="flex items-center justify-between gap-4 border-t border-cloak-border pt-3">
              <div>
                <p className="text-[13px] text-cloak-text">Persistent memory</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-cloak-text-muted">
                  Store new facts from this conversation locally.
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  conversation.persistentMemory
                    ? "bg-cloak-gold-soft text-cloak-gold-bright"
                    : "border border-cloak-border text-cloak-text-muted"
                )}
              >
                {conversation.persistentMemory ? "On" : "Off"}
              </span>
            </div>
          </div>
        </section>

        {/* Identity */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
            <UserRoundCheckIcon size={13} className="text-cloak-gold" />
            {conversation.isGroup ? "Group" : "Identity"}
          </h3>
          {conversation.isGroup ? (
            <div className="rounded-xl border border-cloak-border bg-cloak-bg/50 p-4 text-[13px]">
              <p className="font-medium text-cloak-text">{conversation.groupName}</p>
              {conversation.groupDescription && (
                <p className="mt-0.5 text-cloak-text-secondary">{conversation.groupDescription}</p>
              )}
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-cloak-text-secondary">
                <UsersRoundIcon size={12} className="text-cloak-text-muted" />
                {conversation.memberCount ?? 0} members · your role: {conversation.myRole ?? "member"}
              </p>
              {conversation.circleId && (
                <button
                  onClick={() => navigate(`/app/circles/${conversation.circleId}`)}
                  className="mt-2 flex items-center gap-1.5 text-[12px] text-cloak-gold hover:underline"
                >
                  <WaypointsIcon size={12} />
                  Circle: {conversation.circleName ?? "Open"}
                </button>
              )}
            </div>
          ) : (
          <div className="rounded-xl border border-cloak-border bg-cloak-bg/50 p-4 text-[13px]">
            <p className="font-medium text-cloak-text">{contact?.name}</p>
            <p className="mt-0.5 text-cloak-text-muted">{contact?.cloakId}</p>
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-cloak-text-secondary">
              {verified ? (
                <>
                  <ShieldCheckIcon size={12} className="text-cloak-gold" />
                  Safety number verified {contact?.verifiedAt ? `· ${contact.verifiedAt}` : ""}
                </>
              ) : (
                <>
                  <TriangleAlertIcon size={12} className="text-cloak-warning" />
                  Verification pending — compare QR codes in person
                </>
              )}
            </div>
          </div>
          )}
        </section>

        {/* Lock control */}
        <section>
          <button
            onClick={() => unlockConversation(conversation.id)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-cloak-border bg-cloak-bg/50 p-4 text-left text-[13px] text-cloak-text-secondary transition-colors hover:bg-cloak-surface"
          >
            <LockIcon size={15} className="text-cloak-warning" />
            <span>
              Lock this conversation
              <span className="mt-0.5 block text-[11px] text-cloak-text-muted">
                Requires unlock before history is visible.
              </span>
            </span>
          </button>
        </section>
      </div>
    </aside>
  );
}

function Row({
  label,
  value,
  state,
  action,
}: {
  label: string;
  value: string;
  state: "protected" | "attention";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-cloak-border bg-cloak-bg/50 px-3.5 py-2.5">
      <span className="text-cloak-text-secondary">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "text-[12px]",
            state === "protected" ? "text-cloak-text" : "text-cloak-warning"
          )}
        >
          {value}
        </span>
        {action && (
          <button
            onClick={action.onClick}
            className="rounded-md border border-cloak-gold/30 bg-cloak-gold-soft px-2 py-0.5 text-[10.5px] font-medium text-cloak-gold-bright"
          >
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
}

/* E2EE rows — reflect the REAL crypto state: the conversation key version
   this device holds, not a UI-level "verified" flag. */
function E2eeRows({ conversationId }: { conversationId: string }) {
  const [version, setVersion] = useState(currentKeyVersion(conversationId));
  useEffect(() => {
    /* First sample scheduled out of the effect body (react-hooks rule) */
    const raf = requestAnimationFrame(() =>
      setVersion(currentKeyVersion(conversationId))
    );
    const t = window.setInterval(
      () => setVersion(currentKeyVersion(conversationId)),
      1500
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(t);
    };
  }, [conversationId]);

  return (
    <Row
      label="Encryption"
      value={version > 0 ? `End-to-end · key v${version}` : "Setting up…"}
      state={version > 0 ? "protected" : "attention"}
    />
  );
}

/* This device's E2EE identity: fingerprint + (when missing) the restore
   prompt. The fingerprint is the SHA-256 of the public key — comparable
   out-of-band between conversation partners. */
function E2eeKeyCard({ conversationId }: { conversationId: string }) {
  const user = useCloakStore((s) => s.auth.user);
  const identityStatus = useCloakStore((s) => s.identityStatus);
  const restoreIdentityKeys = useCloakStore((s) => s.restoreIdentityKeys);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (user) {
      void myIdentityInfo(user.id).then((info) => {
        if (!cancelled) setFingerprint(info?.fingerprint ?? null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [user, identityStatus]);

  const restore = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    const ok = await restoreIdentityKeys(passphrase);
    setBusy(false);
    if (ok) {
      setPassphrase("");
      void syncKeysAfterRestore(conversationId);
    } else {
      setError("That passphrase didn't unlock the backup.");
    }
  };

  return (
    <div className="mt-2.5 rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-cloak-text">
        <LockIcon size={12} className="text-cloak-gold" />
        This device&apos;s encryption identity
      </p>
      {fingerprint ? (
        <p className="mt-1.5 font-mono text-[12.5px] tracking-wider text-cloak-text-secondary">
          {fingerprint}
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-cloak-warning">
          No identity key on this device yet.
        </p>
      )}
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-cloak-text-muted">
        Compare this code with your contact in person to be certain who you
        are talking to. Message bodies never touch the server unencrypted.
      </p>
      {identityStatus === "needs-passphrase" && (
        <div className="mt-3 space-y-1.5 border-t border-cloak-border pt-3">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void restore();
              }
            }}
            placeholder="Your passphrase"
            autoComplete="current-password"
            aria-label="Passphrase to restore encryption keys"
            className="h-9 w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 text-[12.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted focus:border-cloak-gold/40"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void restore()}
              disabled={busy || !passphrase}
              className="rounded-md border border-cloak-gold/30 bg-cloak-gold-soft px-2.5 py-1 text-[11px] font-medium text-cloak-gold-bright disabled:opacity-40"
            >
              {busy ? "Unlocking…" : "Restore keys"}
            </button>
            {error && (
              <span className="text-[10.5px] text-cloak-danger">{error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function syncKeysAfterRestore(conversationId: string) {
  const { useCloakStore: store } = await import("@/stores/cloak-store");
  const user = store.getState().auth.user;
  if (!user) return;
  const { syncConversationKeys } = await import("@/lib/crypto/e2ee-orchestrator");
  await syncConversationKeys(conversationId, user.id);
}

/* ------------------------------------------------------------------ */
/* Group members (server-authoritative)                                */
/* ------------------------------------------------------------------ */

function GroupMembersSection({ conversationId }: { conversationId: string }) {
  const fetchGroupMembers = useCloakStore((s) => s.fetchGroupMembers);
  const addServerMembers = useCloakStore((s) => s.addServerMembers);
  const removeServerMember = useCloakStore((s) => s.removeServerMember);
  const setServerMemberRole = useCloakStore((s) => s.setServerMemberRole);
  const leaveServerConversation = useCloakStore((s) => s.leaveServerConversation);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<"owner" | "admin" | "member">("member");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = myRole === "owner" || myRole === "admin";

  const load = useCallback(async () => {
    const res = await fetchGroupMembers(conversationId);
    return res.ok ? res : null;
  }, [conversationId, fetchGroupMembers]);

  const apply = useCallback(
    (res: { ok: true; members: GroupMember[]; myRole: string; pendingRequests: unknown[] } | null) => {
      if (res) {
        setMembers(res.members);
        setMyRole(res.myRole as "owner" | "admin" | "member");
      }
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void load().then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [load, apply]);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [load, apply]);

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okNote?: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      if (okNote) setNotice(okNote);
      await refresh();
    } else if (res.error === "transfer_ownership_first") {
      setNotice("Transfer ownership before leaving this group.");
    } else if (res.error === "forbidden") {
      setNotice("Only the owner can do that.");
    } else {
      setNotice("That didn't work. Try again.");
    }
  };

  const addMember = () => {
    const handle = draft.trim().replace(/^@+/, "");
    if (!handle) return;
    setDraft("");
    void run(async () => {
      const res = await addServerMembers(conversationId, [handle]);
      if (res.ok && res.unknownHandles.length > 0) {
        setNotice(`@${res.unknownHandles[0]} isn't on Cloak yet.`);
      }
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
    }, undefined);
  };

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
        <UsersRoundIcon size={13} className="text-cloak-gold" />
        Members
        {loading && <LoaderCircleIcon size={12} className="animate-spin text-cloak-text-muted" />}
      </h3>

      <ul className="space-y-1 rounded-xl border border-cloak-border bg-cloak-bg/50 p-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-cloak-surface"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[10.5px] font-semibold text-cloak-text-secondary">
              {m.avatarInitials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-cloak-text">
                {m.name}
                {m.isYou && <span className="text-cloak-text-muted"> (you)</span>}
              </span>
              <span className="block truncate text-[10.5px] text-cloak-text-muted">{m.cloakId}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                m.role === "owner"
                  ? "bg-cloak-gold-soft text-cloak-gold-bright"
                  : "border border-cloak-border text-cloak-text-muted"
              )}
            >
              {m.role === "owner" ? "Owner" : m.role === "admin" ? "Admin" : "Member"}
            </span>
            {canManage && m.role !== "owner" && !m.isYou && (
              <button
                aria-label={`Remove ${m.name}`}
                title={`Remove ${m.name}`}
                disabled={busy}
                onClick={() => void run(() => removeServerMember(conversationId, m.userId))}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-cloak-text-muted transition-colors hover:text-cloak-danger disabled:opacity-40"
              >
                <UserRoundMinusIcon size={13} />
              </button>
            )}
          </li>
        ))}
        {members.length === 0 && !loading && (
          <li className="px-2 py-3 text-center text-[12px] text-cloak-text-muted">
            Couldn't load members.
          </li>
        )}
      </ul>

      {/* Owner controls: promote / transfer */}
      {myRole === "owner" && (
        <div className="mt-2 space-y-1 rounded-xl border border-cloak-border bg-cloak-bg/50 p-2">
          <p className="px-1 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-cloak-text-muted">
            Owner controls
          </p>
          {members
            .filter((m) => !m.isYou && m.role !== "owner")
            .map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-2 rounded-lg px-1 py-1 text-[12px] text-cloak-text-secondary"
              >
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        setServerMemberRole(
                          conversationId,
                          m.userId,
                          m.role === "admin" ? "member" : "admin"
                        ),
                      m.role === "admin" ? `${m.name} is now a member.` : `${m.name} is now an admin.`
                    )
                  }
                  className="rounded-md border border-cloak-border px-2 py-0.5 text-[10.5px] text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold disabled:opacity-40"
                >
                  {m.role === "admin" ? "Make member" : "Make admin"}
                </button>
                <button
                  disabled={busy}
                  title="Transfer ownership"
                  onClick={() =>
                    void run(
                      () => setServerMemberRole(conversationId, m.userId, "owner"),
                      `${m.name} is now the owner.`
                    )
                  }
                  className="grid h-6 w-6 place-items-center rounded-full text-cloak-text-muted transition-colors hover:text-cloak-gold disabled:opacity-40"
                >
                  <ShieldXIcon size={13} />
                </button>
              </div>
            ))}
        </div>
      )}

      {canManage && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMember();
              }
            }}
            placeholder="@handle to add"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Add member by Cloak ID"
            className="h-9 w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 text-[12.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted focus:border-cloak-gold/40"
          />
          <button
            onClick={addMember}
            disabled={busy}
            aria-label="Add member"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cloak-border text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-gold disabled:opacity-40"
          >
            <UserPlusIcon size={15} />
          </button>
        </div>
      )}

      {notice && (
        <p role="status" className="mt-2 text-[11.5px] leading-relaxed text-cloak-text-secondary">
          {notice}
        </p>
      )}

      <button
        onClick={() => void run(() => leaveServerConversation(conversationId))}
        disabled={busy}
        className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-cloak-danger/25 bg-cloak-danger/5 p-3.5 text-left text-[12.5px] text-cloak-danger transition-colors hover:bg-cloak-danger/10 disabled:opacity-50"
      >
        <TriangleAlertIcon size={14} className="shrink-0" />
        Leave this group
        <span className="ml-auto text-[10.5px] text-cloak-text-muted">
          Members are notified
        </span>
      </button>
    </section>
  );
}

function timerLabel(t?: string): string {
  switch (t) {
    case "30s": return "30 seconds";
    case "5m": return "5 minutes";
    case "1h": return "1 hour";
    case "1d": return "1 day";
    case "7d": return "7 days";
    default: return "Custom";
  }
}
