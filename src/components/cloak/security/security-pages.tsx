"use client";

/*
 * SecurityCentrePage (spec §21) + DevicesPage (spec §22).
 * Typed protection states — no fake green checks for unwired functionality.
 */

import { useEffect, useState, type ComponentType } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { useCloakStore, type ForwardSecrecyWindow } from "@/stores/cloak-store";
import { CloakModeToggle } from "@/components/cloak/messaging/cloak-mode-toggle";
import { useDaggerDialog } from "@/components/cloak/security/dagger";
import { Switch } from "@/components/ui/switch";
import {
  Surface,
  ProtectionDot,
  OnDeviceBadge,
} from "@/components/cloak/shared/primitives";
import { AIModelCard } from "@/components/cloak/intelligence/model-install-card";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import { BRAND } from "@/lib/cloak/config";
import {
  ShieldCheckIcon,
  LockIcon,
  MonitorSmartphoneIcon,
  CpuIcon,
  CloudOffIcon,
  KeyRoundIcon,
  BellIcon,
  WaypointsIcon,
  LogOutIcon,
  ChevronRightIcon,
  TriangleAlertIcon,
  QrCodeIcon,
  UserRoundCheckIcon,
  CircleCheckIcon,
  HourglassIcon,
} from "@animateicons/react/lucide";
import { Sword as SwordIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProtectionState } from "@/lib/cloak/types";

interface SecurityRow {
  id: string;
  label: string;
  state: ProtectionState;
  value: string;
  detail: string;
  /* Structural icon type: animateicons handles AND plain lucide icons
     (Sword) both satisfy it. */
  icon: ComponentType<{ size?: number; className?: string }>;
  action?: { label: string; onClick: () => void };
}

function useSecurityRows(onConfigureFs: () => void): SecurityRow[] {
  const aiSettings = useCloakStore((s) => s.ai);
  const deviceCount = useCloakStore((s) => s.devices.length);
  /* Membership-aware control (pricing & membership update spec §44):
     shown plainly, never as a sales pitch. */
  const isReserve = useCloakStore((s) => s.membership.membership === "reserve");
  const forwardSecrecy = useCloakStore((s) => s.forwardSecrecy);
  const openDaggerDialog = useDaggerDialog((s) => s.openDialog);
  /* Circle posture (circles spec §56): count-only at this level — per-
     circle security status lives on the Circle page (§68). */
  const circleCount = useCloakStore((s) => s.circles.length);

  return [
    {
      id: "messages",
      label: "Messages",
      state: "protected",
      value: "Protected",
      detail: "Conversations are protected by the end-to-end architecture module.",
      icon: LockIcon,
    },
    {
      id: "forward-secrecy",
      label: "Forward secrecy",
      state: forwardSecrecy === "off" ? "not-configured" : "protected",
      value:
        forwardSecrecy === "off"
          ? "Off"
          : forwardSecrecy === "24h"
            ? "24-hour window"
            : "7-day window",
      detail:
        forwardSecrecy === "off"
          ? "Message keys are retained so your full history stays readable. Enable a window to have old keys destroyed automatically."
          : `Key versions older than the window are destroyed on this device and on the server — messages under them expire for everyone, including you. Rotation every ${forwardSecrecy === "24h" ? "12 hours" : "3.5 days"} keeps versions flowing.`,
      icon: HourglassIcon,
      action: { label: "Configure", onClick: onConfigureFs },
    },
    {
      id: "identity",
      label: "Identity",
      state: "protected",
      value: "Verified",
      detail: "Your Cloak ID is active. Contacts verify identity by QR or safety number.",
      icon: UserRoundCheckIcon,
      action: { label: "Manage", onClick: () => navigate("/app/contacts") },
    },
    {
      id: "devices",
      label: "Devices",
      state: "protected",
      value: `${deviceCount} trusted`,
      detail: "Every linked device is listed and revocable from device management.",
      icon: MonitorSmartphoneIcon,
      action: { label: "Review", onClick: () => navigate("/security/devices") },
    },
    {
      id: "circles",
      label: "Circles",
      state: circleCount > 0 ? "protected" : "not-configured",
      value: circleCount > 0 ? `${circleCount} active` : "None",
      detail:
        circleCount > 0
          ? "Circle membership, group access and invites are enforced server-side. Open a Circle to review its security status."
          : "Circles organize trusted people into private groups. They appear here once you create or join one.",
      icon: WaypointsIcon,
      action: circleCount > 0 ? { label: "Review", onClick: () => navigate("/app/circles") } : undefined,
    },
    {
      id: "advanced-devices",
      label: "Advanced device approval",
      state: isReserve ? "protected" : "not-configured",
      value: isReserve ? "Enabled" : `Available with ${BRAND.cloakReserve}`,
      detail: isReserve
        ? "New devices require explicit approval before they can sync."
        : `Stricter device approval options are part of ${BRAND.cloakReserve}.`,
      icon: KeyRoundIcon,
      action: isReserve
        ? { label: "Configure", onClick: () => navigate("/security/devices") }
        : undefined,
    },
    {
      id: "ai",
      label: "AI processing",
      state: aiSettings.enabled ? "protected" : "disabled",
      value: aiSettings.enabled ? "On-device" : "Disabled",
      detail: aiSettings.enabled
        ? "Cloak Intelligence runs locally. Memory stays on this device."
        : "Cloak Intelligence is disabled. Messaging works normally.",
      icon: CpuIcon,
      action: { label: "Adjust", onClick: () => navigate("/app/settings/ai") },
    },
    {
      id: "cloud",
      label: "Cloud fallback",
      state: aiSettings.processing === "allow-cloud" ? "attention" : "protected",
      value:
        aiSettings.processing === "allow-cloud"
          ? "Allowed"
          : aiSettings.processing === "ask-before-cloud"
            ? "Ask first"
            : "Off",
      detail:
        aiSettings.processing === "allow-cloud"
          ? "Cloud processing is allowed. Every cloud answer is labeled."
          : "No cloud processing without your explicit consent.",
      icon: CloudOffIcon,
      action: { label: "Adjust", onClick: () => navigate("/app/settings/ai") },
    },
    {
      id: "backups",
      label: "Backups",
      state: "not-configured",
      value: "Encrypted (design)",
      detail:
        "Encrypted backup is part of the architecture. It activates when the secure transport layer is wired — this panel will not claim it before then.",
      icon: KeyRoundIcon,
    },
    {
      id: "notifications",
      label: "Notifications",
      state: "protected",
      value: "Preview rules active",
      detail: "Preview visibility follows your privacy settings, including Cloak Mode.",
      icon: BellIcon,
      action: { label: "Adjust", onClick: () => navigate("/app/settings/notifications") },
    },
    {
      id: "dagger",
      label: "Dagger",
      state: "protected",
      value: "Ready",
      detail:
        "Emergency device control: destroys local keys first, then clears private local data and revokes this device. Your account and other devices stay active.",
      icon: SwordIcon,
      action: { label: "Configure", onClick: () => openDaggerDialog() },
    },
    {
      id: "remote-dagger",
      label: "Remote Dagger",
      state: "protected",
      value: "Enabled",
      detail:
        "Revoke a device immediately and queue local destruction for its next reconnect. An offline device cannot be wiped until it reconnects.",
      icon: MonitorSmartphoneIcon,
      action: { label: "Review", onClick: () => navigate("/security/devices") },
    },
    {
      id: "session",
      label: "Session",
      state: "protected",
      value: "This device only",
      detail: "Your session is bound to this device. Signing out clears local keys.",
      icon: ShieldCheckIcon,
    },
  ];
}

const FS_OPTIONS: { value: ForwardSecrecyWindow; label: string; blurb: string }[] = [
  {
    value: "off",
    label: "Off — keep full history",
    blurb: "Every key version is retained. Your entire history stays readable on any device that restores your keys.",
  },
  {
    value: "24h",
    label: "24-hour window",
    blurb: "Keys older than 24 hours are destroyed (rotated every 12 h). Messages past the window expire permanently — even for you.",
  },
  {
    value: "7d",
    label: "7-day window",
    blurb: "Keys older than 7 days are destroyed (rotated every 3.5 days). A softer balance between history and secrecy.",
  },
];

function ForwardSecrecyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const forwardSecrecy = useCloakStore((s) => s.forwardSecrecy);
  const setForwardSecrecy = useCloakStore((s) => s.setForwardSecrecy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">Forward secrecy window</DialogTitle>
          <DialogDescription className="text-cloak-text-secondary">
            How long old conversation keys survive before Cloak destroys them.
            Destruction is real: messages encrypted under a destroyed key can
            never be decrypted again — by anyone, including you. Keys are
            removed from this device AND from the server's key directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {FS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setForwardSecrecy(opt.value)}
              className={cn(
                "w-full rounded-2xl border p-3.5 text-left transition-colors",
                forwardSecrecy === opt.value
                  ? "border-cloak-gold/40 bg-cloak-gold-soft/20"
                  : "border-cloak-border bg-cloak-bg hover:border-cloak-border-strong"
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] font-medium text-cloak-text">{opt.label}</span>
                {forwardSecrecy === opt.value && (
                  <CircleCheckIcon size={15} className="shrink-0 text-cloak-gold" />
                )}
              </span>
              <span className="mt-1 block text-[12px] leading-relaxed text-cloak-text-muted">
                {opt.blurb}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-cloak-text-muted">
          <TriangleAlertIcon size={13} className="mt-0.5 shrink-0 text-cloak-warning" />
          Turning the window off stops future deletions, but keys already
          destroyed cannot be recovered. Group history shared as "all" is also
          limited to versions still inside the window.
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SecurityCentrePage() {
  const [fsDialogOpen, setFsDialogOpen] = useState(false);
  const rows = useSecurityRows(() => setFsDialogOpen(true));
  const fetchCircles = useCloakStore((s) => s.fetchCircles);
  const protectedCount = rows.filter((r) => r.state === "protected").length;
  const overall: ProtectionState =
    protectedCount === rows.length ? "protected" : "attention";

  /* Keep the Circles posture row honest — refresh the server mirror. */
  useEffect(() => {
    void fetchCircles();
  }, [fetchCircles]);

  return (
    <AppShell active="/app/security">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-3xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          {/* Top state */}
          <div className="mb-8 text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cloak-text-muted">
              Security
            </p>
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-2.5 cloak-display text-4xl font-medium",
                overall === "protected" ? "text-cloak-success" : "text-cloak-warning"
              )}
            >
              <span
                className={cn(
                  "cloak-pulse-once inline-block h-2.5 w-2.5 rounded-full",
                  overall === "protected" ? "bg-cloak-success" : "bg-cloak-warning"
                )}
              />
              {overall === "protected" ? "Protected" : "Attention needed"}
            </p>
            <p className="mt-2 text-[13px] text-cloak-text-muted">
              {protectedCount} of {rows.length} surfaces fully protected
            </p>
          </div>

          <div className="mb-6">
            <CloakModeToggle />
          </div>

          {/* Rows */}
          <div className="space-y-2.5">
            {rows.map((row) => (
              <Surface key={row.id} hover className="p-4">
                <div className="flex items-start gap-3.5">
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
                      row.state === "protected"
                        ? "border-cloak-border bg-cloak-bg text-cloak-text-secondary"
                        : row.state === "disabled" || row.state === "not-configured"
                          ? "border-cloak-warning/25 bg-cloak-warning/5 text-cloak-warning"
                          : "border-cloak-warning/25 bg-cloak-warning/5 text-cloak-warning"
                    )}
                  >
                    <row.icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-cloak-text">{row.label}</p>
                      <span className="flex shrink-0 items-center gap-2 text-[12.5px]">
                        <ProtectionDot state={row.state} />
                        <span
                          className={cn(
                            row.state === "protected"
                              ? "text-cloak-text"
                              : "text-cloak-warning"
                          )}
                        >
                          {row.value}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-muted">
                      {row.detail}
                    </p>
                    {row.action && (
                      <button
                        onClick={row.action.onClick}
                        className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-cloak-gold transition-colors hover:text-cloak-gold-bright"
                      >
                        {row.action.label}
                        <ChevronRightIcon size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </Surface>
            ))}
          </div>

          {/* Model card */}
          <div className="mt-8">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
              Local AI model
            </h2>
            <AIModelCard />
          </div>

          {/* Dagger preferences (codex §20/§21/§22) */}
          <DaggerPreferences />
        </div>
      </div>

      <ForwardSecrecyDialog open={fsDialogOpen} onOpenChange={setFsDialogOpen} />
    </AppShell>
  );
}

/* Dagger configuration (codex §20 silent completion, §21 emergency
   gesture, §22 settings placement). Defaults off — the user must
   explicitly enable and test the gesture. */
function DaggerPreferences() {
  const daggerConfig = useCloakStore((s) => s.daggerConfig);
  const setDaggerConfig = useCloakStore((s) => s.setDaggerConfig);
  const openDaggerDialog = useDaggerDialog((s) => s.openDialog);

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-cloak-text-muted">
        Dagger
      </h2>
      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-cloak-text">Emergency device control</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-muted">
              Destroys local keys, clears private data and revokes this
              device. Fast in an emergency, hard to trigger by accident.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-cloak-danger/30 text-cloak-danger hover:bg-cloak-danger/10 hover:text-cloak-danger"
            onClick={openDaggerDialog}
          >
            Dagger this device
          </Button>
        </div>
        <div className="mt-5 space-y-4 border-t border-cloak-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] text-cloak-text">Silent completion</p>
              <p className="mt-0.5 text-[11.5px] text-cloak-text-muted">
                Return straight to the signed-out site. No completion screen.
              </p>
            </div>
            <Switch
              checked={daggerConfig.silentCompletion}
              onCheckedChange={(v) => setDaggerConfig({ silentCompletion: v })}
              aria-label="Silent completion"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] text-cloak-text">Emergency gesture</p>
              <p className="mt-0.5 text-[11.5px] text-cloak-text-muted">
                Hold the Cloak logo for 5 seconds. Off by default.
              </p>
            </div>
            <Switch
              checked={daggerConfig.emergencyGestureEnabled}
              onCheckedChange={(v) => setDaggerConfig({ emergencyGestureEnabled: v })}
              aria-label="Emergency Dagger gesture"
            />
          </div>
        </div>
        <button
          onClick={() => navigate("/security#dagger")}
          className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-cloak-gold transition-colors hover:text-cloak-gold-bright"
        >
          Learn about Dagger
          <ChevronRightIcon size={12} />
        </button>
      </Surface>
    </div>
  );
}

/* ---------------- Devices + Remote Dagger (spec §22, codex §18/§24) ---------------- */

export function DevicesPage() {
  const devices = useCloakStore((s) => s.devices);
  const fetchDevices = useCloakStore((s) => s.fetchDevices);
  const revokeDeviceRemote = useCloakStore((s) => s.revokeDeviceRemote);
  const requestRemoteDagger = useCloakStore((s) => s.requestRemoteDagger);
  const openDaggerDialog = useDaggerDialog((s) => s.openDialog);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [pendingDagger, setPendingDagger] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  const revokeTarget = devices.find((d) => d.id === pendingRevoke);
  const daggerTarget = devices.find((d) => d.id === pendingDagger);

  return (
    <AppShell active="/app/security">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-3xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          <button
            onClick={() => navigate("/app/security")}
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-cloak-text-secondary transition-colors hover:text-cloak-text"
          >
            Security
            <ChevronRightIcon size={13} />
            Devices
          </button>

          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h1 className="cloak-display text-2xl font-medium text-cloak-text">Trusted devices</h1>
              <p className="mt-1 text-[13px] text-cloak-text-muted">
                Devices holding your conversations. Revoke anything you do not recognize.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cloak-border bg-cloak-surface px-3 py-1.5 text-[11.5px] text-cloak-text-secondary">
              <QrCodeIcon size={13} className="text-cloak-gold" />
              QR linking — ready
            </span>
          </div>

          <div className="space-y-3">
            {devices.length === 0 && (
              <Surface className="p-5 text-[13px] text-cloak-text-muted">
                Loading the device registry…
              </Surface>
            )}
            {devices.map((d) => {
              /* A session predating device tracking has no device to wipe, so
                 it can be revoked but not daggered. */
              const isLegacy = d.id.startsWith("legacy-");
              return (
              <Surface key={d.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-bg text-cloak-text-secondary">
                      <MonitorSmartphoneIcon size={19} />
                    </span>
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-cloak-text">
                        {d.name}
                        {d.current && (
                          <span className="rounded-full bg-cloak-gold-soft px-2 py-0.5 text-[10px] font-medium text-cloak-gold-bright">
                            This device
                          </span>
                        )}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-cloak-text-muted">
                        <span>Added: {d.addedAt}</span>
                        <span>Last active: {d.lastActive}</span>
                      </div>
                      {isLegacy && (
                        <p className="mt-2 max-w-sm text-[11.5px] leading-relaxed text-cloak-text-muted">
                          Signed in before this device was enrolled. Revoke it
                          to sign that session out, then sign in again to
                          enroll the device properly.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[11.5px]",
                        isLegacy ? "text-cloak-text-muted" : "text-cloak-success"
                      )}
                    >
                      {!isLegacy && <CircleCheckIcon size={12} />}
                      {isLegacy ? "Unenrolled" : "Trusted"}
                    </span>
                    {d.current ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-cloak-danger/30 text-cloak-danger hover:bg-cloak-danger/10 hover:text-cloak-danger"
                        onClick={openDaggerDialog}
                      >
                        Dagger this device
                      </Button>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
                          disabled={busy}
                          onClick={() => setPendingRevoke(d.id)}
                        >
                          Revoke
                        </Button>
                        {!isLegacy && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-cloak-danger/30 text-cloak-danger hover:bg-cloak-danger/10 hover:text-cloak-danger"
                            disabled={busy}
                            onClick={() => setPendingDagger(d.id)}
                          >
                            Dagger Device
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Surface>
              );
            })}
          </div>

          <div className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-cloak-text-muted">
            <TriangleAlertIcon size={13} className="mt-0.5 shrink-0 text-cloak-warning" />
            Revoking a device removes its access immediately. Remote Dagger also
            queues local destruction — an offline device can only be wiped once
            it reconnects.
          </div>
        </div>
      </div>

      {/* Revoke confirmation — plain revocation, NOT Dagger (codex §24) */}
      <Dialog open={!!pendingRevoke} onOpenChange={(v) => !v && setPendingRevoke(null)}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">Revoke {revokeTarget?.name}?</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              The device loses access to your conversations immediately. This
              action cannot be undone from here. Its local encrypted storage
              stays until the app is used on that device again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
              onClick={() => setPendingRevoke(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-cloak-danger text-white hover:bg-cloak-danger/90"
              disabled={busy}
              onClick={async () => {
                if (!pendingRevoke) return;
                setBusy(true);
                await revokeDeviceRemote(pendingRevoke);
                setBusy(false);
                setPendingRevoke(null);
              }}
            >
              <LogOutIcon size={14} className="mr-1.5" />
              Revoke device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remote Dagger confirmation — codex §18 exact copy */}
      <Dialog open={!!pendingDagger} onOpenChange={(v) => !v && setPendingDagger(null)}>
        <DialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">Dagger {daggerTarget?.name}?</DialogTitle>
            <DialogDescription className="text-cloak-text-secondary">
              This will revoke this device immediately.
              <br />
              <br />
              If the device reconnects, Cloak will attempt to destroy its local
              Cloak keys and private data.
              <br />
              <br />
              Offline devices cannot receive the local wipe command until they
              reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-cloak-border text-cloak-text-secondary hover:bg-cloak-surface"
              onClick={() => setPendingDagger(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-cloak-danger text-white hover:bg-cloak-danger/90"
              disabled={busy}
              onClick={async () => {
                if (!pendingDagger) return;
                setBusy(true);
                await requestRemoteDagger(pendingDagger);
                setBusy(false);
                setPendingDagger(null);
              }}
            >
              <SwordIcon size={14} className="mr-1.5" />
              Dagger Device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
