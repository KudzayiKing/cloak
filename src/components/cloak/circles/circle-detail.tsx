"use client";

/*
 * CirclePage — #/app/circles/[circleId] (circles spec §29/§42-§44/§55/§68).
 *
 * Layout: circle header (name, people, groups) + five sections as tabs:
 * Groups | Members | Invitations | Security | Activity, plus Settings.
 * Least privilege is visible everywhere: plain members never see group
 * names they have no access to (§26/§42) — only a count; managers see the
 * full structure so they can run it.
 */

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { useCloakStore } from "@/stores/cloak-store";
import { Surface } from "@/components/cloak/shared/primitives";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import type { CircleMemberEntry, CircleDetail } from "@/lib/cloak/types";
import {
  answerCircleMetadata,
  answerCircleReasoning,
  searchCircle,
  type CircleAskResult,
  type CircleScopeGroup,
  type CircleSearchHit,
} from "@/ai/circle/circle-intelligence";
import {
  ArrowLeftIcon,
  FileArchiveIcon,
  CheckIcon,
  CopyIcon,
  LinkIcon,
  MessageCircleIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "@animateicons/react/lucide";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Section = "groups" | "members" | "invitations" | "security" | "activity" | "intelligence";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "groups", label: "Groups" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "security", label: "Security" },
  { id: "activity", label: "Activity" },
  { id: "intelligence", label: "Intelligence" },
];

function roleChip(role: string) {
  return (
    <span className="rounded-full border border-cloak-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-cloak-text-muted">
      {role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member"}
    </span>
  );
}

/* ---------------- New group (§44) ---------------- */

function NewGroupDialog({ circle, open, onOpenChange }: { circle: CircleDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const createCircleGroup = useCloakStore((s) => s.createCircleGroup);
  const members = circle.members.filter((m) => !m.isYou);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setSelected(new Set());
    setError(null);
    setBusy(false);
  };

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const handles = members.filter((m) => selected.has(m.userId)).map((m) => m.cloakId);
    const result = await createCircleGroup(circle.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      handles,
    });
    if (result.ok) {
      onOpenChange(false);
      reset();
      navigate("/app/messages");
    } else {
      setBusy(false);
      setError(
        result.error === "group_limit_reached"
          ? "This Circle is at its group limit."
          : result.error === "circle_archived"
            ? "This Circle is archived — unarchive it to add groups."
            : "Could not create the group. Try again."
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">New group in {circle.name}</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Defaults come from the Circle security policy: new-member
              history &quot;{circle.policy.newMemberHistory === "all" ? "shared" : "hidden"}&quot;,
              cloud AI {circle.policy.cloudAi === "disabled" ? "off" : circle.policy.cloudAi}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group name"
              maxLength={80}
              className="border-cloak-border bg-cloak-surface text-cloak-text"
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Purpose (optional)"
              maxLength={200}
              className="border-cloak-border bg-cloak-surface text-cloak-text"
            />
            {members.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-cloak-text-secondary">Circle members to include</p>
                <div className="cloak-scroll max-h-40 space-y-1 overflow-y-auto pr-1">
                  {members.map((m) => (
                    <button
                      key={m.userId}
                      onClick={() => toggle(m.userId)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                        selected.has(m.userId)
                          ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                          : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:bg-cloak-surface-hover"
                      )}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[10px] text-cloak-text-secondary">
                        {m.avatarInitials}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {selected.has(m.userId) && <CheckIcon size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-[12px] text-cloak-danger">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!title.trim() || busy} className="bg-cloak-gold text-black hover:bg-cloak-gold/90">
              Create group
            </Button>
          </DialogFooter>
        </RiseDialogContent>
    </Dialog>
  );
}

/* ---------------- Add members (§25) ---------------- */

function AddMembersDialog({ circle, open, onOpenChange }: { circle: CircleDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const addCircleMembers = useCloakStore((s) => s.addCircleMembers);
  const [handles, setHandles] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setHandles("");
    setNote(null);
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    const list = handles.split(/[\s,]+/).filter(Boolean);
    if (list.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const result = await addCircleMembers(circle.id, list);
    if (result.ok) {
      setNote(
        `Added ${result.added} member${result.added === 1 ? "" : "s"}.` +
        (result.unknownHandles.length ? ` Unknown Cloaq IDs: ${result.unknownHandles.join(", ")}.` : "") +
        " They see the Circle only — group access is granted separately."
      );
      setHandles("");
    } else {
      setError(
        result.error === "member_limit_reached"
          ? "This Circle is at its member limit."
          : result.error === "forbidden"
            ? "Only the owner and admins can add members."
            : "Could not add members. Try again."
      );
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">Add members to {circle.name}</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Add existing Cloak members by Cloaq ID. Circle membership alone
              grants no group access (spec §26) — that is a separate, explicit
              grant.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={handles}
            onChange={(e) => setHandles(e.target.value)}
            placeholder="@name.XXXX @other.XXXX"
            className="border-cloak-border bg-cloak-surface text-cloak-text"
          />
          {note && <p className="text-[12px] leading-relaxed text-cloak-text-secondary">{note}</p>}
          {error && <p className="text-[12px] text-cloak-danger">{error}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button onClick={submit} disabled={busy || handles.trim().length === 0} className="bg-cloak-gold text-black hover:bg-cloak-gold/90">
              Add members
            </Button>
          </DialogFooter>
        </RiseDialogContent>
    </Dialog>
  );
}

/* ---------------- Invite link (§40/§41) ---------------- */

function InviteDialog({ circle, open, onOpenChange }: { circle: CircleDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const createCircleInvite = useCloakStore((s) => s.createCircleInvite);
  const groups = circle.groups;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(new Set());
    setApprovalRequired(false);
    setLink(null);
    setCopied(false);
    setError(null);
    setBusy(false);
  };

  const toggle = (groupId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await createCircleInvite(circle.id, [...selected], undefined, approvalRequired);
    if (result.ok) {
      setLink(`${window.location.origin}/#${result.url}`);
    } else {
      setError(
        result.error === "circle_archived"
          ? "This Circle is archived — invites are disabled."
          : "Could not create the invite. Try again."
      );
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">Invite to {circle.name}</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Least-privilege is explicit: choose exactly which groups the
              invited person joins. The link is single-use and expires in{" "}
              {circle.policy.inviteExpiryDays} days.
            </DialogDescription>
          </DialogHeader>

          {link ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-cloak-border bg-cloak-surface p-3">
                <code className="min-w-0 flex-1 break-all text-[11.5px] text-cloak-text-secondary">{link}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    setCopied(true);
                  }}
                  className="shrink-0 text-cloak-gold"
                  aria-label="Copy invite link"
                >
                  {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                </button>
              </div>
              <p className="text-[11.5px] leading-relaxed text-cloak-text-muted">
                Shown once — Cloak stores only a hash and cannot reconstruct
                it. Anyone with the link can redeem it once, so share it the
                way you would share a key.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] font-medium text-cloak-text-secondary">Groups the invited person joins</p>
              {groups.length === 0 ? (
                <p className="text-[12.5px] text-cloak-text-muted">
                  This Circle has no groups yet — the invite will grant the Circle shell only.
                </p>
              ) : (
                <div className="cloak-scroll max-h-44 space-y-1 overflow-y-auto pr-1">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => toggle(g.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                        selected.has(g.id)
                          ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                          : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:bg-cloak-surface-hover"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{g.title}</span>
                      {selected.has(g.id) && <CheckIcon size={14} />}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setApprovalRequired((v) => !v)}
                aria-pressed={approvalRequired}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                  approvalRequired
                    ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                    : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:bg-cloak-surface-hover"
                )}
              >
                <ShieldCheckIcon size={14} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  Approval required
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-cloak-text-muted">
                    Redeeming files a join request for you to approve instead of joining directly (§41).
                  </span>
                </span>
                {approvalRequired && <CheckIcon size={14} />}
              </button>
              {error && <p className="text-[12px] text-cloak-danger">{error}</p>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!link && (
              <Button onClick={submit} disabled={busy} className="bg-cloak-gold text-black hover:bg-cloak-gold/90">
                Create invite link
              </Button>
            )}
          </DialogFooter>
        </RiseDialogContent>
    </Dialog>
  );
}

/* ---------------- Delete (§46 — typed confirmation) ---------------- */

function DeleteCircleDialog({ circle, open, onOpenChange }: { circle: CircleDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const deleteCircle = useCloakStore((s) => s.deleteCircle);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteCircle(circle.id);
    if (result.ok) {
      onOpenChange(false);
      reset();
      navigate("/app/circles");
    } else {
      setBusy(false);
      setError("Could not delete the Circle. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <RiseDialogContent className="border-cloak-danger/30 bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">Delete Circle</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              This will remove the Circle structure and may affect access to
              groups. The groups themselves survive as independent groups.
              This action is irreversible.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
              Type &quot;{circle.name}&quot; to continue
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={circle.name}
              className="border-cloak-border bg-cloak-surface text-cloak-text"
            />
          </div>
          {error && <p className="text-[12px] text-cloak-danger">{error}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={name !== circle.name || busy}
              className="bg-cloak-danger text-white hover:bg-cloak-danger/90"
            >
              Delete Circle
            </Button>
          </DialogFooter>
        </RiseDialogContent>
    </Dialog>
  );
}

/* ---------------- Sections ---------------- */

function GroupsSection({ circle, isManager, onCreateGroup }: { circle: CircleDetail; isManager: boolean; onCreateGroup: () => void }) {
  const setActiveConversation = useCloakStore((s) => s.setActiveConversation);
  const assignMemberToCircleGroup = useCloakStore((s) => s.assignMemberToCircleGroup);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignHandle, setAssignHandle] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);

  const openGroup = (groupId: string) => {
    setActiveConversation(groupId);
    navigate("/app/messages");
  };

  return (
    <div className="space-y-2.5">
      {circle.groups.length === 0 ? (
        <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-10 text-center">
          <p className="text-sm text-cloak-text-secondary">
            {isManager ? "No groups yet." : "You are not in any groups of this Circle yet."}
          </p>
          {isManager && (
            <button onClick={onCreateGroup} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-cloak-gold/30 bg-cloak-gold/10 px-4 py-2 text-[12.5px] text-cloak-gold">
              <PlusIcon size={13} />
              New group
            </button>
          )}
        </div>
      ) : (
        circle.groups.map((g) => (
          <Surface key={g.id} hover={g.isMember} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-bg text-cloak-text-secondary">
                <MessageCircleIcon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-cloak-text">{g.title}</p>
                <p className="mt-0.5 text-[12px] text-cloak-text-muted">
                  {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                  {!g.isMember && " · you have no access"}
                </p>
              </div>
              {g.isMember ? (
                <button
                  onClick={() => openGroup(g.id)}
                  className="shrink-0 rounded-full border border-cloak-gold/30 bg-cloak-gold/10 px-3.5 py-1.5 text-[12px] font-medium text-cloak-gold"
                >
                  Open
                </button>
              ) : isManager ? (
                <button
                  onClick={() => { setAssigning(assigning === g.id ? null : g.id); setAssignHandle(""); setAssignError(null); }}
                  className="shrink-0 rounded-full border border-cloak-border px-3.5 py-1.5 text-[12px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                >
                  <UserPlusIcon size={12} className="mr-1 inline" />
                  Assign
                </button>
              ) : null}
            </div>
            {assigning === g.id && (
              <div className="mt-3 rounded-xl border border-cloak-border bg-cloak-surface/60 p-3">
                <p className="mb-2 text-[11.5px] text-cloak-text-muted">
                  Add a Circle member to this group by Cloaq ID (spec §27 — they must already be a Circle member).
                </p>
                <div className="flex gap-2">
                  <Input
                    value={assignHandle}
                    onChange={(e) => setAssignHandle(e.target.value)}
                    placeholder="@name.XXXX"
                    className="h-9 border-cloak-border bg-cloak-surface text-[13px] text-cloak-text"
                  />
                  <Button
                    size="sm"
                    disabled={!assignHandle.trim()}
                    className="h-9 shrink-0 bg-cloak-gold text-black hover:bg-cloak-gold/90"
                    onClick={async () => {
                      const r = await assignMemberToCircleGroup(circle.id, g.id, assignHandle.trim());
                      if (r.ok) {
                        setAssigning(null);
                        setAssignHandle("");
                      } else {
                        setAssignError(
                          r.error === "not_a_member"
                            ? "That Cloaq ID is not a member of this Circle yet."
                            : r.error === "unknown_handle"
                              ? "No such Cloaq ID."
                              : "Could not assign. Try again."
                        );
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
                {assignError && <p className="mt-1.5 text-[11.5px] text-cloak-danger">{assignError}</p>}
              </div>
            )}
          </Surface>
        ))
      )}
      {circle.hiddenGroupCount > 0 && (
        <p className="px-1 pt-1 text-[11.5px] text-cloak-text-muted">
          {circle.hiddenGroupCount} more group{circle.hiddenGroupCount === 1 ? "" : "s"} in this Circle are not shared with you.
        </p>
      )}
    </div>
  );
}

function MembersSection({ circle, isManager }: { circle: CircleDetail; isManager: boolean }) {
  const removeCircleMember = useCloakStore((s) => s.removeCircleMember);
  const setCircleMemberRole = useCloakStore((s) => s.setCircleMemberRole);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = circle.myRole === "owner";

  const act = async (userId: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusyId(userId);
    setError(null);
    const r = await fn();
    if (!r.ok) {
      setError(
        r.error === "circle_member_owns_groups"
          ? "This member owns a group inside the Circle — transfer that group's ownership first."
          : r.error === "cannot_remove_owner"
            ? "The Circle owner cannot be removed."
            : "Action failed. Try again."
      );
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-2.5">
      {error && <p className="rounded-lg border border-cloak-danger/30 bg-cloak-danger/10 px-3 py-2 text-[12px] text-cloak-danger">{error}</p>}
      {circle.members.map((m: CircleMemberEntry) => (
        <Surface key={m.userId} className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[11px] font-semibold text-cloak-text-secondary">
              {m.avatarInitials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-cloak-text">
                  {m.name}
                  {m.isYou && <span className="ml-1.5 text-[11px] text-cloak-text-muted">(you)</span>}
                </p>
                {roleChip(m.role)}
              </div>
              <p className="mt-0.5 text-[12px] text-cloak-text-muted">{m.cloakId}</p>
              {m.groupAccess && m.groupAccess.length > 0 && (
                <p className="mt-1 text-[11.5px] text-cloak-text-muted">
                  Groups: {m.groupAccess.join(", ")}
                </p>
              )}
            </div>
            {isManager && !m.isYou && m.role !== "owner" && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {isOwner && (
                  <>
                    <button
                      disabled={busyId === m.userId}
                      onClick={() => act(m.userId, () => setCircleMemberRole(circle.id, m.userId, m.role === "admin" ? "member" : "admin"))}
                      className="rounded-full border border-cloak-border px-2.5 py-1 text-[11px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                    >
                      {m.role === "admin" ? "Make member" : "Make admin"}
                    </button>
                    <button
                      disabled={busyId === m.userId}
                      onClick={() => act(m.userId, () => setCircleMemberRole(circle.id, m.userId, "owner"))}
                      className="rounded-full border border-cloak-gold/30 px-2.5 py-1 text-[11px] text-cloak-gold hover:bg-cloak-gold/10"
                    >
                      Transfer ownership
                    </button>
                  </>
                )}
                <button
                  disabled={busyId === m.userId}
                  onClick={() => act(m.userId, () => removeCircleMember(circle.id, m.userId))}
                  className="rounded-full border border-cloak-danger/30 px-2.5 py-1 text-[11px] text-cloak-danger hover:bg-cloak-danger/10"
                  aria-label={`Remove ${m.name} from the Circle`}
                >
                  <UserMinusIcon size={12} />
                </button>
              </div>
            )}
          </div>
        </Surface>
      ))}
      <p className="px-1 text-[11.5px] leading-relaxed text-cloak-text-muted">
        Directory shows name, Cloaq ID and Circle role — never membership
        tier, wallet, or contact details (spec §42). Removing someone from
        the Circle revokes its groups, never their Cloaq membership (§61).
      </p>
    </div>
  );
}

function InvitationsSection({ circle, onCreateInvite }: { circle: CircleDetail; onCreateInvite: () => void }) {
  const revokeCircleInvite = useCloakStore((s) => s.revokeCircleInvite);
  const resolveCircleJoinRequest = useCloakStore((s) => s.resolveCircleJoinRequest);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invites = circle.invites ?? [];
  const requests = circle.joinRequests ?? [];

  const decide = async (requestId: string, approve: boolean) => {
    setBusyId(requestId);
    setError(null);
    const r = await resolveCircleJoinRequest(circle.id, requestId, approve);
    if (!r.ok) {
      setError(
        r.error === "member_limit_reached"
          ? "This Circle is full — free up a seat first."
          : r.error === "not_pending"
            ? "That request was already handled."
            : "Could not process the request. Try again."
      );
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-2.5">
      <button
        onClick={onCreateInvite}
        className="bg-cloak-gold/20 hover:bg-cloak-gold/25 inline-flex h-10 items-center gap-1.5 rounded-full border border-cloak-gold/30 px-4 text-[13px] font-medium text-cloak-gold"
      >
        <LinkIcon size={14} />
        New invite link
      </button>

      {/* Approval queue (§41) */}
      {requests.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 pt-1 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">
            Requests ({requests.length})
          </p>
          {requests.map((r) => (
            <Surface key={r.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cloak-border bg-cloak-bg text-[10px] font-semibold text-cloak-text-secondary">
                  {r.avatarInitials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-cloak-text">{r.name}</p>
                  <p className="text-[12px] text-cloak-text-muted">{r.cloakId}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, true)}
                    className="inline-flex items-center gap-1 rounded-full border border-cloak-success/40 bg-cloak-success/10 px-3 py-1.5 text-[12px] font-medium text-cloak-success disabled:opacity-50"
                  >
                    <CheckIcon size={12} />
                    Approve
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, false)}
                    className="inline-flex items-center gap-1 rounded-full border border-cloak-danger/30 px-3 py-1.5 text-[12px] text-cloak-danger hover:bg-cloak-danger/10 disabled:opacity-50"
                  >
                    <XIcon size={12} />
                    Deny
                  </button>
                </div>
              </div>
            </Surface>
          ))}
          {error && <p className="px-1 text-[12px] text-cloak-danger">{error}</p>}
        </div>
      )}

      {invites.length === 0 ? (
        <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-10 text-center text-sm text-cloak-text-muted">
          No invites yet. Links are single-use and expire — least-privilege access, granted explicitly.
        </div>
      ) : (
        invites.map((inv) => (
          <Surface key={inv.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                  inv.status === "active"
                    ? "border-cloak-success/40 text-cloak-success"
                    : inv.status === "redeemed"
                      ? "border-cloak-border text-cloak-text-muted"
                      : "border-cloak-danger/40 text-cloak-danger"
                )}
              >
                {inv.status}
              </span>
              <span className="text-[12px] text-cloak-text-muted">
                {inv.groupNames.length === 0 ? "Circle only" : inv.groupNames.join(", ")}
              </span>
              <span className="ml-auto text-[11px] text-cloak-text-muted">
                expires {new Date(inv.expiresAt).toLocaleDateString()}
              </span>
              {inv.status === "active" && (
                <button
                  onClick={() => void revokeCircleInvite(circle.id, inv.id)}
                  className="rounded-full border border-cloak-danger/30 px-2.5 py-1 text-[11px] text-cloak-danger hover:bg-cloak-danger/10"
                >
                  Revoke
                </button>
              )}
            </div>
          </Surface>
        ))
      )}
    </div>
  );
}

function SecuritySection({ circle }: { circle: CircleDetail }) {
  const setCirclePolicy = useCloakStore((s) => s.setCirclePolicy);
  const isOwner = circle.myRole === "owner";
  const s = circle.security;
  return (
    <div className="space-y-3">
      <Surface className="p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">
          <ShieldCheckIcon size={13} />
          Status
        </p>
        <dl className="space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-4"><dt className="text-cloak-text-secondary">Members</dt><dd className="text-cloak-text">{s.memberCount}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-cloak-text-secondary">Groups</dt><dd className="text-cloak-text">{s.groupCount}</dd></div>
          <div className="flex justify-between gap-4">
            <dt className="text-cloak-text-secondary">Identity keys provisioned</dt>
            <dd className="text-cloak-text">{s.identityKeysProvisioned} of {s.memberCount}</dd>
          </div>
          <div className="flex justify-between gap-4"><dt className="text-cloak-text-secondary">Open invites</dt><dd className="text-cloak-text">{s.openInvites}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-cloak-text-secondary">Cloud AI default</dt><dd className="text-cloak-text">{s.cloudAi === "disabled" ? "Off" : s.cloudAi}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-cloak-text-secondary">New-member history</dt><dd className="text-cloak-text">{s.newMemberHistory === "all" ? "Shared" : "Hidden"}</dd></div>
        </dl>
        <p className="mt-3 text-[11.5px] leading-relaxed text-cloak-text-muted">
          Groups created here inherit these defaults and may only be stricter
          — a group can never weaken a Circle restriction (spec §39).
        </p>
      </Surface>

      {isOwner && (
        <Surface className="p-4">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">Policy (owner)</p>
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-cloak-text-secondary">New-member history</span>
              <div className="flex gap-1.5">
                {(["none", "all"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => void setCirclePolicy(circle.id, { newMemberHistory: v })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      circle.policy.newMemberHistory === v
                        ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                        : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                    )}
                  >
                    {v === "none" ? "Hidden" : "Shared"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-cloak-text-secondary">Cloud AI default</span>
              <div className="flex gap-1.5">
                {(["disabled", "current_request", "allowed"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => void setCirclePolicy(circle.id, { cloudAi: v })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      circle.policy.cloudAi === v
                        ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                        : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                    )}
                  >
                    {v === "disabled" ? "Off" : v === "current_request" ? "On request" : "Allowed"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-cloak-text-secondary">Invite expiry</span>
              <div className="flex gap-1.5">
                {[1, 7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => void setCirclePolicy(circle.id, { inviteExpiryDays: d })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      circle.policy.inviteExpiryDays === d
                        ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                        : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Surface>
      )}
    </div>
  );
}

function ActivitySection({ circle }: { circle: CircleDetail }) {
  const audit = circle.audit ?? [];
  if (audit.length === 0) {
    return (
      <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-10 text-center text-sm text-cloak-text-muted">
        No activity yet. Membership, role, group and policy events appear here — never message content (spec §63).
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {audit.map((a) => (
        <Surface key={a.id} className="px-4 py-3">
          <p className="text-[13px] text-cloak-text">
            {a.actorName ? `${a.actorName} — ` : ""}
            {a.detail ?? a.event}
          </p>
          <p className="mt-0.5 text-[11px] text-cloak-text-muted">
            {new Date(a.createdAt).toLocaleString()}
          </p>
        </Surface>
      ))}
    </div>
  );
}

/* ---------------- Circle Intelligence (§64-§67) ---------------- */

function IntelligenceSection({ circle }: { circle: CircleDetail }) {
  const conversations = useCloakStore((s) => s.conversations);
  const replaceServerMessages = useCloakStore((s) => s.replaceServerMessages);
  const fetchGroupMembers = useCloakStore((s) => s.fetchGroupMembers);
  const setActiveConversation = useCloakStore((s) => s.setActiveConversation);

  const [scopeSelected, setScopeSelected] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [answer, setAnswer] = useState<CircleAskResult | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CircleSearchHit[] | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  /* Scope (§64): ONLY groups the viewer can open. The manager's extra
     visibility does not extend here — AI uses exactly what the user can
     read. */
  const myGroups = useMemo(() => circle.groups.filter((g) => g.isMember), [circle.groups]);
  const defaultScope = useMemo(() => new Set(myGroups.map((g) => g.id)), [myGroups]);

  /* Pull the local message window for every scope group once (the same
     latest-50 window the chat poll uses) so retrieval has real content. */
  const ensureScopeMessages = async (): Promise<CircleScopeGroup[]> => {
    const chosen = scopeSelected.size > 0 ? myGroups.filter((g) => scopeSelected.has(g.id)) : myGroups;
    setScopeLoading(true);
    try {
      for (const g of chosen) {
        const held = conversations.find((c) => c.id === g.id);
        if (held && held.messages.length > 0) continue;
        const res = await fetch(`/api/conversations/${g.id}/messages?limit=50`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; messages?: Parameters<typeof replaceServerMessages>[1]; hasMore?: boolean };
        if (res.ok && json.ok === true && json.messages) {
          await replaceServerMessages(g.id, json.messages, json.hasMore);
        }
      }
    } finally {
      setScopeLoading(false);
    }
    const fresh = useCloakStore.getState().conversations;
    return chosen.map((g) => ({
      id: g.id,
      title: g.title,
      messages: fresh.find((c) => c.id === g.id)?.messages ?? [],
    }));
  };

  const runAsk = async () => {
    const q = ask.trim();
    if (!q || askBusy) return;
    setAskBusy(true);
    setAnswer(null);
    try {
      /* §65 first: deterministic metadata answers never invoke Cloaq AI. */
      const meta = await answerCircleMetadata(q, circle, async (groupId) => {
        const r = await fetchGroupMembers(groupId);
        return r.ok ? r.members.map((m) => ({ name: m.name, role: m.role })) : null;
      });
      if (meta) {
        setAnswer(meta);
      } else {
        const scope = await ensureScopeMessages();
        setAnswer(await answerCircleReasoning(q, scope));
      }
    } finally {
      setAskBusy(false);
    }
  };

  const runSearch = () => {
    const q = search.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const chosen = scopeSelected.size > 0 ? myGroups.filter((g) => scopeSelected.has(g.id)) : myGroups;
    const fresh = useCloakStore.getState().conversations;
    const scope: CircleScopeGroup[] = chosen.map((g) => ({
      id: g.id,
      title: g.title,
      messages: fresh.find((c) => c.id === g.id)?.messages ?? [],
    }));
    setHits(searchCircle(q, scope));
  };

  return (
    <div className="space-y-3">
      <Surface className="p-4">
        <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">
          <SparklesIcon size={13} />
          Scope
        </p>
        <p className="mb-3 text-[11.5px] leading-relaxed text-cloak-text-muted">
          Answers come only from the groups you can open (§64). AI can never
          expand authorization — hidden groups are not read and not named.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {myGroups.length === 0 ? (
            <p className="text-[12.5px] text-cloak-text-muted">You are not in any groups of this Circle yet.</p>
          ) : (
            myGroups.map((g) => (
              <button
                key={g.id}
                onClick={() =>
                  setScopeSelected((prev) => {
                    /* Empty set = all groups; the first explicit click
                       narrows the scope (§64 "selected groups only"). */
                    const base = prev.size === 0 ? new Set(defaultScope) : new Set(prev);
                    if (base.has(g.id)) base.delete(g.id);
                    else base.add(g.id);
                    return base;
                  })
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  scopeSelected.size === 0 || scopeSelected.has(g.id)
                    ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                    : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                )}
              >
                {g.title}
              </button>
            ))
          )}
        </div>
        {scopeLoading && <p className="mt-2 text-[11.5px] text-cloak-text-muted">Loading local messages…</p>}
      </Surface>

      <Surface className="p-4">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">Ask Cloaq</p>
        <div className="flex gap-2">
          <Input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runAsk();
            }}
            placeholder="Which groups am I in? Summarize decisions this week…"
            className="h-10 border-cloak-border bg-cloak-surface text-[13px] text-cloak-text"
          />
          <Button
            onClick={() => void runAsk()}
            disabled={askBusy || !ask.trim()}
            className="h-10 shrink-0 bg-cloak-gold text-black hover:bg-cloak-gold/90"
            aria-label="Ask Cloaq"
          >
            <SendIcon size={15} />
          </Button>
        </div>
        {answer && (
          <div className="mt-3 rounded-xl border border-cloak-border bg-cloak-bg px-4 py-3">
            <span
              className={cn(
                "inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                answer.route === "deterministic"
                  ? "border-cloak-success/40 text-cloak-success"
                  : answer.route === "local-llm"
                    ? "border-cloak-gold/40 text-cloak-gold"
                    : "border-cloak-border text-cloak-text-muted"
              )}
            >
              {answer.route === "deterministic"
                ? "metadata"
                : answer.route === "local-llm"
                  ? "local model"
                  : answer.route === "unavailable"
                    ? "retrieval only"
                    : "no results"}
            </span>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-cloak-text">{answer.answer}</p>
            {answer.sources.length > 0 && (
              <p className="mt-2 text-[11px] text-cloak-text-muted">Sources: {answer.sources.join(", ")}</p>
            )}
          </div>
        )}
      </Surface>

      <Surface className="p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-cloak-text-muted">
          <SearchIcon size={13} />
          Search Circle
        </p>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            runSearch();
          }}
          placeholder="Search the groups you can open (§67)"
          className="h-10 border-cloak-border bg-cloak-surface text-[13px] text-cloak-text"
        />
        {hits && (
          <div className="mt-3 space-y-1.5">
            {hits.length === 0 ? (
              <p className="text-[12.5px] text-cloak-text-muted">No matches in your groups of this Circle.</p>
            ) : (
              hits.map((h, i) => (
                <button
                  key={`${h.groupId}-${h.createdAt}-${i}`}
                  onClick={() => {
                    setActiveConversation(h.groupId);
                    navigate("/app/messages");
                  }}
                  className="block w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-left transition-colors hover:bg-cloak-surface"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-cloak-gold">{h.groupTitle}</span>
                    <span className="shrink-0 text-[10.5px] text-cloak-text-muted">
                      {new Date(h.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-cloak-text-secondary">
                    {h.authorName ? `${h.authorName}: ` : ""}{h.snippet}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </Surface>
    </div>
  );
}

/* ---------------- Page ---------------- */

export function CirclePage({ circleId }: { circleId: string }) {
  const circle = useCloakStore((s) => s.activeCircle);
  const circleLoading = useCloakStore((s) => s.circleLoading);
  const fetchCircleDetail = useCloakStore((s) => s.fetchCircleDetail);
  const renameCircle = useCloakStore((s) => s.renameCircle);
  const setCircleArchived = useCloakStore((s) => s.setCircleArchived);
  const leaveCircle = useCloakStore((s) => s.leaveCircle);
  const [section, setSection] = useState<Section>("groups");
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    void fetchCircleDetail(circleId);
  }, [circleId, fetchCircleDetail]);

  const isManager = useMemo(() => circle?.myRole === "owner" || circle?.myRole === "admin", [circle]);
  const isOwner = circle?.myRole === "owner";

  if (circleLoading && !circle) {
    return (
      <AppShell active="/app/circles">
        <div className="grid h-full place-items-center text-sm text-cloak-text-muted">Loading…</div>
      </AppShell>
    );
  }
  if (!circle) {
    return (
      <AppShell active="/app/circles">
        <div className="mx-auto max-w-3xl px-5 pt-16 text-center">
          <p className="text-sm text-cloak-text-secondary">This Circle does not exist or you are not a member.</p>
          <button onClick={() => navigate("/app/circles")} className="mt-4 rounded-full border border-cloak-border px-4 py-2 text-[13px] text-cloak-text-secondary">
            Back to Circles
          </button>
        </div>
      </AppShell>
    );
  }

  const visibleSections = SECTIONS.filter((s) => (s.id !== "invitations" && s.id !== "activity") || isManager);

  return (
    <AppShell active="/app/circles">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-3xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          <button
            onClick={() => navigate("/app/circles")}
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-cloak-text-muted hover:text-cloak-text"
          >
            <ArrowLeftIcon size={14} />
            Circles
          </button>

          {/* Circle header (§29) */}
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {renaming !== null ? (
                  <Input
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                    className="h-9 w-56 border-cloak-border bg-cloak-surface text-cloak-text"
                    autoFocus
                  />
                ) : (
                  <h1 className="cloak-display text-2xl font-medium text-cloak-text">{circle.name}</h1>
                )}
                {circle.archived && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cloak-warning/30 bg-cloak-warning/10 px-2 py-0.5 text-[10px] text-cloak-warning">
                    <FileArchiveIcon size={10} />
                    Archived
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-cloak-text-muted">
                {circle.security.memberCount} people · {circle.security.groupCount} groups
                {circle.description ? ` · ${circle.description}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isManager && !circle.archived && (
                <>
                  <button
                    onClick={() => setNewGroupOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-cloak-gold/30 bg-cloak-gold/10 px-3.5 text-[12.5px] text-cloak-gold"
                  >
                    <PlusIcon size={13} />
                    New group
                  </button>
                  <button
                    onClick={() => setAddMembersOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-cloak-border px-3.5 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                  >
                    <UserPlusIcon size={13} />
                    Add member
                  </button>
                  <button
                    onClick={() => setInviteOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-cloak-border px-3.5 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                  >
                    <LinkIcon size={13} />
                    Invite
                  </button>
                </>
              )}
              {isOwner &&
                (renaming !== null ? (
                  <>
                    <button
                      onClick={async () => {
                        if (renaming.trim()) await renameCircle(circle.id, renaming.trim(), circle.description ?? null);
                        setRenaming(null);
                      }}
                      className="inline-flex h-9 items-center rounded-full border border-cloak-gold/30 bg-cloak-gold/10 px-3.5 text-[12.5px] text-cloak-gold"
                    >
                      Save
                    </button>
                    <button onClick={() => setRenaming(null)} className="text-[12.5px] text-cloak-text-muted">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setRenaming(circle.name)}
                    className="inline-flex h-9 items-center rounded-full border border-cloak-border px-3.5 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                  >
                    Rename
                  </button>
                ))}
            </div>
          </div>

          {/* Section tabs (§55) */}
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {visibleSections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
                  section === s.id
                    ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                    : "border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {section === "groups" && (
            <GroupsSection circle={circle} isManager={!!isManager} onCreateGroup={() => setNewGroupOpen(true)} />
          )}
          {section === "members" && <MembersSection circle={circle} isManager={!!isManager} />}
          {section === "invitations" && isManager && <InvitationsSection circle={circle} onCreateInvite={() => setInviteOpen(true)} />}
          {section === "security" && <SecuritySection circle={circle} />}
          {section === "activity" && isManager && <ActivitySection circle={circle} />}
          {section === "intelligence" && <IntelligenceSection circle={circle} />}

          {/* Lifecycle (§45/§46/§76/§77) */}
          <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-cloak-border pt-5">
            {isOwner ? (
              <>
                <button
                  onClick={() => void setCircleArchived(circle.id, !circle.archived)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border px-3.5 py-2 text-[12.5px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
                >
                  <FileArchiveIcon size={13} />
                  {circle.archived ? "Unarchive Circle" : "Archive Circle"}
                </button>
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cloak-danger/30 px-3.5 py-2 text-[12.5px] text-cloak-danger hover:bg-cloak-danger/10"
                >
                  <Trash2Icon size={13} />
                  Delete Circle
                </button>
              </>
            ) : (
              <button
                onClick={async () => {
                  setLeaveError(null);
                  const r = await leaveCircle(circle.id);
                  if (r.ok) navigate("/app/circles");
                  else setLeaveError(
                    r.error === "transfer_ownership_first"
                      ? "Transfer ownership before leaving the Circle."
                      : "Could not leave the Circle. Try again."
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-cloak-danger/30 px-3.5 py-2 text-[12.5px] text-cloak-danger hover:bg-cloak-danger/10"
              >
                <UsersIcon size={13} />
                Leave Circle
              </button>
            )}
            {leaveError && <p className="text-[12px] text-cloak-danger">{leaveError}</p>}
          </div>
        </div>
      </div>

      <NewGroupDialog circle={circle} open={newGroupOpen} onOpenChange={setNewGroupOpen} />
      <AddMembersDialog circle={circle} open={addMembersOpen} onOpenChange={setAddMembersOpen} />
      <InviteDialog circle={circle} open={inviteOpen} onOpenChange={setInviteOpen} />
      <DeleteCircleDialog circle={circle} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </AppShell>
  );
}
