"use client";

/*
 * AIModelCard / AIModelDownload (spec §3, §29).
 * Full ModelInstallState lifecycle with honest states — no simulated
 * downloads while the artifact URL is unconfigured.
 */

import { useEffect, useState } from "react";
import { modelManager, type ModelStatusSnapshot } from "@/ai/models/modelManager";
import { availabilitySummary, checkLocalAIAvailability } from "@/lib/cloak/capability";
import { formatBytes } from "@/lib/cloak/utils";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  CpuIcon,
  TriangleAlertIcon,
  CheckIcon,
  RefreshCwIcon,
  Trash2Icon,
  LoaderCircleIcon,
  PackageIcon,
  CloudIcon,
} from "@animateicons/react/lucide";
import { Button } from "@/components/ui/button";

export function AIModelCard({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<ModelStatusSnapshot | null>(null);
  const [summary, setSummary] = useState("Checking local capability…");

  useEffect(() => {
    void modelManager.probe();
    const unsub = modelManager.subscribe(setSnapshot);
    void checkLocalAIAvailability().then((a) => setSummary(availabilitySummary(a)));
    return () => unsub();
  }, []);

  const state = snapshot?.state ?? "checking";

  return (
    <div className="rounded-xl border border-cloak-border bg-cloak-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
              state === "ready"
                ? "border-cloak-success/30 bg-cloak-success/10 text-cloak-success"
                : state === "error" || state === "unsupported" || state === "insufficient-storage"
                  ? "border-cloak-warning/30 bg-cloak-warning/10 text-cloak-warning"
                  : "border-cloak-border bg-cloak-bg text-cloak-gold"
            )}
          >
            <PackageIcon size={18} />
          </span>
          <div>
            <p className="text-sm font-medium text-cloak-text">Cloaq AI</p>
            <p className="mt-0.5 text-xs text-cloak-text-muted">
              Local reasoning model · WebGPU
              {snapshot?.sizeBytes ? ` · approx. ${formatBytes(snapshot.sizeBytes)}` : ""}
            </p>
          </div>
        </div>
        <StateChip state={state} />
      </div>

      {snapshot && (
        <>
          {state === "downloading" && snapshot.progress !== undefined && (
            <Progress value={snapshot.progress * 100} className="mt-4" />
          )}
          <p className="mt-3 text-[12.5px] leading-relaxed text-cloak-text-secondary">
            {snapshot.message}
          </p>
        </>
      )}

      {!compact && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(state === "not-installed" || state === "error") && (
            <Button
              size="sm"
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
              onClick={() => modelManager.install()}
            >
              <RefreshCwIcon size={14} className="mr-1.5" />
              Install Cloaq AI
            </Button>
          )}
          {state === "ready" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface-hover"
                onClick={() => modelManager.remove()}
              >
                <Trash2Icon size={13} className="mr-1.5" />
                Remove Cloaq AI
              </Button>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-success/25 bg-cloak-success/10 px-2.5 py-1 text-[11px] text-cloak-success">
                <CheckIcon size={11} />
                Verified on this device
              </span>
            </>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-cloak-text-muted">
            {state === "unsupported" ? (
              <>
                <CloudIcon size={12} />
                Local inference unavailable — messaging unaffected
              </>
            ) : (
              <>
                <CpuIcon size={12} />
                {summary}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function StateChip({ state }: { state: ModelStatusSnapshot["state"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    "not-installed": { label: "Not installed", cls: "border-cloak-border text-cloak-text-secondary" },
    checking: { label: "Checking", cls: "border-cloak-border text-cloak-text-secondary" },
    downloading: { label: "Downloading", cls: "border-cloak-gold/30 text-cloak-gold-bright" },
    verifying: { label: "Verifying", cls: "border-cloak-gold/30 text-cloak-gold-bright" },
    ready: { label: "Ready", cls: "border-cloak-success/30 text-cloak-success" },
    "update-available": { label: "Update available", cls: "border-cloak-gold/30 text-cloak-gold-bright" },
    unsupported: { label: "Unsupported", cls: "border-cloak-warning/30 text-cloak-warning" },
    "insufficient-storage": { label: "Storage full", cls: "border-cloak-warning/30 text-cloak-warning" },
    error: { label: "Error", cls: "border-cloak-danger/30 text-cloak-danger" },
  };
  const chip = map[state] ?? map.checking;
  const spinning = state === "checking" || state === "downloading" || state === "verifying";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        chip.cls
      )}
    >
      {spinning && <LoaderCircleIcon size={10} className="animate-spin" />}
      {state === "unsupported" && <TriangleAlertIcon size={10} />}
      {chip.label}
    </span>
  );
}
