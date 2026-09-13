"use client";

/*
 * CirclesPage — #/app/circles (circles spec §28/§30/§31/§50/§52).
 *
 * A Circle is a private structure over trusted groups. The list shows
 * ONLY circles the viewer belongs to — no discovery, no public counts
 * (§47/§48). Creation is tier-gated server-side; Private accounts see an
 * honest note instead of a dead button (§32/§34).
 */

import { useEffect, useState } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { useCloakStore } from "@/stores/cloak-store";
import { Surface } from "@/components/cloak/shared/primitives";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import { CIRCLE_TEMPLATES, type CircleSummary } from "@/lib/cloak/types";
import {
  WaypointsIcon,
  CirclePlusIcon,
  FileArchiveIcon,
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

function relativeActivity(ms: number | null): string {
  if (!ms) return "No activity yet";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Active just now";
  if (diff < 3_600_000) return `Updated ${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `Updated ${Math.floor(diff / 3_600_000)} h ago`;
  return `Updated ${Math.floor(diff / 86_400_000)} d ago`;
}

function CircleCard({ circle }: { circle: CircleSummary }) {
  return (
    <li>
      <button
        onClick={() => navigate(`/app/circles/${circle.id}`)}
        className="block w-full text-left"
      >
        <Surface hover className="flex items-center gap-4 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold/10 text-cloak-gold">
            <WaypointsIcon size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-cloak-text">{circle.name}</p>
              <span className="rounded-full border border-cloak-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-cloak-text-muted">
                {circle.kind === "managed" ? "Managed" : "Personal"}
              </span>
              {circle.archived && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cloak-warning/30 bg-cloak-warning/10 px-2 py-0.5 text-[10px] text-cloak-warning">
                  <FileArchiveIcon size={10} />
                  Archived
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[12.5px] text-cloak-text-muted">
              {circle.visibleGroupCount} group{circle.visibleGroupCount === 1 ? "" : "s"}
              {circle.hiddenGroupCount > 0 && ` · ${circle.hiddenGroupCount} not shared with you`} ·{" "}
              {relativeActivity(circle.lastActivityAt)}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-cloak-border px-2.5 py-1 text-[10.5px] text-cloak-text-secondary">
            {circle.myRole === "owner" ? "Owner" : circle.myRole === "admin" ? "Admin" : "Member"}
          </span>
        </Surface>
      </button>
    </li>
  );
}

function CreateCircleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createCircle = useCloakStore((s) => s.createCircle);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setTemplateId(null);
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await createCircle(name.trim(), description.trim() || undefined, templateId ?? undefined);
    if (result.ok) {
      onOpenChange(false);
      reset();
      navigate(`/app/circles/${result.circleId}`);
    } else {
      setBusy(false);
      setError(
        result.error === "circle_limit_reached"
          ? "Your membership includes a set number of Circles, and they are all in use."
          : result.error === "circle_create_not_allowed"
            ? "Your membership tier cannot create Circles."
            : "Could not create the Circle. Try again."
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="cloak-display text-lg">Create a private Circle</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              Organize trusted people and conversations without making them
              public or discoverable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Family Office"
                maxLength={80}
                className="border-cloak-border bg-cloak-surface text-cloak-text"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Purpose <span className="text-cloak-text-muted">(optional)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this Circle for?"
                maxLength={200}
                className="border-cloak-border bg-cloak-surface text-cloak-text"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Starting structure <span className="text-cloak-text-muted">(optional template)</span>
              </label>
              <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                <button
                  onClick={() => setTemplateId(null)}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors",
                    templateId === null
                      ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                      : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:bg-cloak-surface-hover"
                  )}
                >
                  Empty Circle
                </button>
                {CIRCLE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors",
                      templateId === t.id
                        ? "border-cloak-gold/50 bg-cloak-gold/10 text-cloak-gold"
                        : "border-cloak-border bg-cloak-surface text-cloak-text-secondary hover:bg-cloak-surface-hover"
                    )}
                  >
                    {t.name}
                    <span className="mt-0.5 block text-[10px] text-cloak-text-muted">
                      {t.groups.length} groups
                    </span>
                  </button>
                ))}
              </div>
              {templateId && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-cloak-text-muted">
                  {CIRCLE_TEMPLATES.find((t) => t.id === templateId)?.groups.join(" · ")}
                </p>
              )}
            </div>
            {error && <p className="text-[12px] text-cloak-danger">{error}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!name.trim() || busy}
              className="bg-cloak-gold text-black hover:bg-cloak-gold/90"
            >
              Create Circle
            </Button>
          </DialogFooter>
        </RiseDialogContent>
    </Dialog>
  );
}

export function CirclesPage() {
  const circles = useCloakStore((s) => s.circles);
  const circlesLoading = useCloakStore((s) => s.circlesLoading);
  const fetchCircles = useCloakStore((s) => s.fetchCircles);
  const membership = useCloakStore((s) => s.membership.membership);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void fetchCircles();
  }, [fetchCircles]);

  const canCreate =
    membership === "reserve" ||
    membership === "private_circle" ||
    membership === "office" ||
    membership === "sovereign";

  return (
    <AppShell active="/app/circles">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-3xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="cloak-display text-2xl font-medium text-cloak-text">Circles</h1>
              <p className="mt-1 text-[13px] text-cloak-text-muted">
                Trusted structures over private groups — invite-only, never discoverable.
              </p>
            </div>
            {canCreate && (
              <button
                onClick={() => setCreateOpen(true)}
                className="bg-cloak-gold/20 hover:bg-cloak-gold/25 inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-cloak-gold/30 px-4 text-[13px] font-medium text-cloak-gold"
              >
                <CirclePlusIcon size={15} />
                New Circle
              </button>
            )}
          </div>

          {!canCreate && (
            <div className="mb-5 rounded-2xl border border-cloak-border bg-cloak-surface/50 px-5 py-4 text-[13px] leading-relaxed text-cloak-text-secondary">
              Circles organize people who are already Cloak members.{" "}
              {membership === "private"
                ? "Cloak Private members can be invited into Circles; creating one is part of Cloak Reserve and the managed tiers."
                : "Become a member to create or join a Circle."}
            </div>
          )}

          {circlesLoading && circles.length === 0 ? (
            <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-12 text-center text-sm text-cloak-text-muted">
              Loading…
            </div>
          ) : circles.length === 0 ? (
            <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 px-6 py-12 text-center">
              <WaypointsIcon size={22} className="mx-auto text-cloak-text-muted" />
              <p className="mt-3 text-sm text-cloak-text-secondary">No Circles yet.</p>
              <p className="mt-1 text-xs text-cloak-text-muted">
                {canCreate
                  ? "Create one to organize trusted people into private groups."
                  : "When someone invites you into a Circle, it appears here."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {circles.map((c) => (
                <CircleCard key={c.id} circle={c} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <CreateCircleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </AppShell>
  );
}
