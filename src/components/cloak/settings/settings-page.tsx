"use client";

/*
 * SettingsPage (spec §26, pricing & membership update §37) — Account,
 * Membership, Privacy, Security, Notifications, Cloaq Intelligence, Storage,
 * Appearance, About. Nested hash routes: /settings, /settings/membership,
 * /settings/privacy, /settings/notifications, /settings/ai,
 * /settings/storage, /settings/appearance.
 */

import { useEffect, useState } from "react";
import { AppShell } from "@/components/cloak/navigation/app-shell";
import { useCloakStore } from "@/stores/cloak-store";
import { Surface } from "@/components/cloak/shared/primitives";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";
import { AIModelCard } from "@/components/cloak/intelligence/model-install-card";
import { CloakModeToggle } from "@/components/cloak/messaging/cloak-mode-toggle";
import { MembershipSection } from "@/components/cloak/settings/membership-page";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { navigate } from "@/hooks/use-hash-route";
import type { AIProcessingPreference, PreviewVisibility } from "@/lib/cloak/types";
import { BRAND, MODEL_MANIFEST } from "@/lib/cloak/config";
import { TRANSLATION_LANGUAGES } from "@/lib/cloak/translation-languages";
import { DEFAULT_CLOAK_THEME, type CloakTheme } from "@/lib/cloak/theme";
import {
  biometricAvailable,
  enrollBiometric,
  isValidPin,
  sha256Hex,
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
} from "@/lib/cloak/cloak-guard";
import { notificationForIncomingMessage } from "@/lib/cloak/notifications";
import { WebPushCard } from "@/components/cloak/settings/web-push-card";
import {
  ShieldCheckIcon,
  ChevronRightIcon,
  MoonIcon,
  InfoIcon,
  TypeIcon,
  UserRoundCogIcon,
  HardDriveIcon,
  TicketIcon,
  EyeOffIcon,
  ScanIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
} from "@animateicons/react/lucide";
import { LanguagesIcon } from "lucide-react";
import { formatBytes } from "@/lib/cloak/utils";

type SectionId = "account" | "membership" | "cloak" | "privacy" | "notifications" | "ai" | "storage" | "appearance";

const SECTIONS: { id: SectionId; label: string; path: string }[] = [
  { id: "account", label: "Account", path: "/app/settings" },
  { id: "membership", label: "Membership", path: "/app/settings/membership" },
  { id: "cloak", label: "Cloaq Mode", path: "/app/settings/cloak" },
  { id: "privacy", label: "Privacy", path: "/app/settings/privacy" },
  { id: "notifications", label: "Notifications", path: "/app/settings/notifications" },
  { id: "ai", label: "Cloaq Intelligence", path: "/app/settings/ai" },
  { id: "storage", label: "Storage", path: "/app/settings/storage" },
  { id: "appearance", label: "Appearance", path: "/app/settings/appearance" },
];

export function SettingsPage({ section = "account" }: { section?: SectionId }) {
  const membership = useCloakStore((s) => s.membership);
  const guestPasses = useCloakStore((s) => s.guestPasses);

  return (
    <AppShell active="/app/settings">
      <div className="cloak-scroll h-full overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-4xl px-5 pb-[calc(56px+env(safe-area-inset-bottom))] pt-8 md:px-8 md:pb-8">
          <h1 className="cloak-display mb-6 text-2xl font-medium text-cloak-text">Settings</h1>

          <div className="grid gap-6 md:grid-cols-[190px_1fr]">
            {/* Section nav */}
            <nav aria-label="Settings sections" className="flex flex-row gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:flex-col">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(s.path)}
                  aria-current={section === s.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-lg px-3.5 py-2 text-left text-[13px] transition-colors",
                    section === s.id
                      ? "bg-cloak-gold-soft text-cloak-gold"
                      : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </nav>

            {/* Section content */}
            <div className="min-w-0 space-y-6">
              {section === "account" && (
                <AccountSection membership={membership} guestPasses={guestPasses} />
              )}
              {section === "membership" && <MembershipSection />}
              {section === "cloak" && <CloakModeSection />}
              {section === "privacy" && <PrivacySection />}
              {section === "notifications" && <NotificationsSection />}
              {section === "ai" && <AISection />}
              {section === "storage" && <StorageSection />}
              {section === "appearance" && <AppearanceSection />}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* Account ------------------------------------------------------------------ */

const MEMBERSHIP_NAMES: Record<string, string> = {
  none: "No membership",
  private: BRAND.cloakPrivate,
  reserve: BRAND.cloakReserve,
  private_circle: "Cloaq Private Circle",
  office: "Cloaq Office",
  sovereign: "Cloaq Sovereign",
};

function AccountSection({
  membership,
  guestPasses,
}: {
  membership: { membership: string; origin: string; active: boolean; renewal?: string };
  guestPasses: { id: string }[];
}) {
  const user = useCloakStore((s) => s.auth.user);
  const signOut = useCloakStore((s) => s.signOut);
  const available = guestPasses.length
    ? guestPasses.filter((p: { id: string } & { status?: string }) => p.status === "available" || p.status === "expired" || p.status === "revoked_before_redemption").length
    : 0;

  return (
    <>
      <Surface className="p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <UserRoundCogIcon size={15} className="text-cloak-text-secondary" />
          Profile
        </h2>
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-cloak-gold-soft text-base font-semibold text-cloak-gold">
            {user?.displayName?.[0]?.toUpperCase() ?? "Y"}
          </span>
          <div>
            <p className="text-sm font-medium text-cloak-text">
              {user?.displayName ?? "You"}
            </p>
            <p className="mt-0.5 font-mono text-[12.5px] text-cloak-text-muted">
              {user ? `@${user.handle}` : "@you"}
            </p>
            <p className="mt-1 text-[11.5px] text-cloak-text-muted">
              Phone number visibility: hidden from everyone
            </p>
          </div>
        </div>
        <button
          onClick={() => void signOut()}
          className="mt-5 w-full rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-2.5 text-left text-[13px] text-cloak-text-secondary transition-colors hover:border-cloak-danger/30 hover:text-cloak-danger"
        >
          Sign out of Cloak on this device
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-cloak-text-muted">
          Signing out clears this device's session. Your conversations remain
          end-to-end protected and return when you sign back in.
        </p>
      </Surface>

      <Surface className="relative overflow-hidden p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-32 w-56 rounded-full bg-cloak-gold-soft blur-3xl"
        />
        <h2 className="relative mb-4 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <ShieldCheckIcon size={15} className="text-cloak-gold" />
          {MEMBERSHIP_NAMES[membership.membership] ?? "Membership"}
        </h2>
        <dl className="relative space-y-2.5 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-cloak-text-secondary">Status</dt>
            <dd className="flex items-center gap-1.5 font-medium text-cloak-success">
              <ShieldCheckIcon size={13} />
              {membership.active ? "Active" : "Inactive"}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-cloak-text-secondary">Renewal</dt>
            <dd className="text-cloak-text">
              {membership.renewal === "annual"
                ? "Annual"
                : membership.renewal === "custom"
                  ? "Per agreement"
                  : "Never"}
            </dd>
          </div>
          {membership.membership === "reserve" && (
            <div className="flex items-center justify-between">
              <dt className="text-cloak-text-secondary">Private passes</dt>
              <dd className="flex items-center gap-1.5 text-cloak-text">
                <TicketIcon size={12} className="text-cloak-gold" />
                {available} remaining
              </dd>
            </div>
          )}
        </dl>
        <button
          onClick={() => navigate("/app/settings/membership")}
          className="relative mt-4 flex w-full items-center justify-between rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-3 text-[13px] text-cloak-text-secondary transition-colors hover:bg-cloak-surface hover:text-cloak-text"
        >
          Manage membership
          <ChevronRightIcon size={14} className="text-cloak-text-muted" />
        </button>
      </Surface>
    </>
  );
}

/* Cloaq Mode ----------------------------------------------------------------- */

/*
 * Cloaq Mode section (user feedback round 4): protection setup so turning
 * Cloaq Mode OFF requires a PIN or biometrics. Turning it ON never does.
 */

function CloakModeSection() {
  const guard = useCloakStore((s) => s.cloakGuard);
  const setCloakGuardPin = useCloakStore((s) => s.setCloakGuardPin);
  const setCloakGuardBiometric = useCloakStore((s) => s.setCloakGuardBiometric);
  const openCloakGate = useCloakStore((s) => s.openCloakGate);

  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [bioState, setBioState] = useState<"checking" | "available" | "unavailable">("checking");
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    biometricAvailable().then((available) => {
      if (mounted) setBioState(available ? "available" : "unavailable");
    });
    return () => {
      mounted = false;
    };
  }, []);

  const pinSet = !!guard.pinHash;
  const biometricSet = !!guard.credentialId;
  const protectedMode = pinSet || biometricSet;

  /* Any change to protection first verifies against the existing protection.
     Setting up the first method needs no verification — nothing is weakened. */
  const manage = (action: () => void) => {
    if (protectedMode) {
      openCloakGate("manage", (ok) => {
        if (ok) action();
      });
    } else {
      action();
    }
  };

  const enableBiometrics = async () => {
    setBioBusy(true);
    setBioError(null);
    const result = await enrollBiometric();
    setBioBusy(false);
    if (result.ok) {
      setCloakGuardBiometric(result.credentialId);
    } else {
      setBioError(result.error);
    }
  };

  return (
    <>
      <CloakModeToggle />

      <Surface className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <ShieldCheckIcon size={15} className="text-cloak-gold" />
          Turning Cloaq Mode off
        </h2>
        <p className="mb-4 text-[12px] leading-relaxed text-cloak-text-muted">
          Require a PIN or biometrics to turn Cloaq Mode off. Turning it on is
          always immediate — protection only guards the way out.
        </p>

        <div className="mb-4 rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-3">
          <p className="text-[13px] font-medium text-cloak-text">
            {protectedMode ? "Protection is on" : "No protection"}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
            {protectedMode
              ? "Turning Cloaq Mode off asks for "
              : "Cloaq Mode turns off immediately. Add a PIN or biometrics to require "}
            {pinSet && biometricSet
              ? "your PIN or biometrics."
              : pinSet
                ? "your PIN."
                : biometricSet
                  ? "your biometrics."
                  : "verification."}
          </p>
        </div>

        <div className="divide-y divide-cloak-border">
          {/* PIN row */}
          <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13.5px] text-cloak-text">
                <KeyRoundIcon size={14} className="text-cloak-text-secondary" />
                Device PIN
              </div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
                {pinSet ? `A ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digit PIN is set` : `Set a ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digit PIN`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-cloak-border-strong bg-transparent text-[12.5px] text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
                onClick={() => manage(() => setPinDialogOpen(true))}
              >
                {pinSet ? "Change" : "Set PIN"}
              </Button>
              {pinSet && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-[12.5px] text-cloak-text-muted hover:text-cloak-danger"
                  onClick={() => manage(() => setCloakGuardPin(null))}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>

          {/* Biometrics row */}
          <div className="flex items-center justify-between gap-4 py-3.5 last:pb-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13.5px] text-cloak-text">
                <ScanIcon size={14} className="text-cloak-text-secondary" />
                Biometrics
              </div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">
                {bioState === "checking"
                  ? "Checking this device…"
                  : bioState === "unavailable"
                    ? "No biometric authenticator on this device"
                    : biometricSet
                      ? "Face ID, Touch ID, or device biometrics enrolled"
                      : "Use this device's biometrics to verify"}
              </p>
            </div>
            {biometricSet ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2.5 text-[12.5px] text-cloak-text-muted hover:text-cloak-danger"
                onClick={() => manage(() => setCloakGuardBiometric(null))}
              >
                Remove
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={bioState !== "available" || bioBusy}
                className="h-8 shrink-0 border-cloak-border-strong bg-transparent text-[12.5px] text-cloak-text hover:bg-cloak-surface-hover hover:text-cloak-text"
                onClick={() => void enableBiometrics()}
              >
                {bioBusy && <LoaderCircleIcon size={13} className="mr-1.5 animate-spin" />}
                Enable
              </Button>
            )}
          </div>
        </div>

        {bioError && (
          <div role="alert" className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-cloak-danger">
            <InfoIcon size={13} className="mt-0.5 shrink-0" />
            {bioError}
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-cloak-text-muted">
          <InfoIcon size={13} className="mt-0.5 shrink-0" />
          The PIN is stored only as a SHA-256 hash on this device. Biometrics
          use this device's platform authenticator (Face ID, Touch ID, or
          Windows Hello) — Cloak never sees biometric data.
        </div>
      </Surface>

      <Surface className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <EyeOffIcon size={15} className="text-cloak-gold" />
          What Cloaq Mode hides
        </h2>
        <p className="mb-4 text-[12px] leading-relaxed text-cloak-text-muted">
          Cloaq Mode redacts the surfaces around your conversations — enforced
          before anything is displayed.
        </p>
        <ul className="space-y-2.5 text-[13px] text-cloak-text-secondary">
          <li className="flex items-start gap-2.5">
            <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-success" />
            Message previews in the chat list
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-success" />
            Message previews in notifications
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-success" />
            Sender names in notifications
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-cloak-success" />
            Locked chats stay hidden in app switchers where the platform allows
          </li>
        </ul>
      </Surface>

      <PinSetupDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        replacing={pinSet}
      />
    </>
  );
}

/* PIN setup — enter + confirm, saved only as a SHA-256 hash. */

function PinSetupDialog({
  open,
  onOpenChange,
  replacing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replacing: boolean;
}) {
  const setCloakGuardPin = useCloakStore((s) => s.setCloakGuardPin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RiseDialogContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-sm">
        {/* Mounted only while open — fresh state every time */}
        {open && (
          <PinForm
            replacing={replacing}
            onSave={async (pin) => {
              const hash = await sha256Hex(pin);
              if (!hash) return "This device cannot store a PIN securely.";
              setCloakGuardPin(hash);
              return null;
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </RiseDialogContent>
    </Dialog>
  );
}

function PinForm({
  replacing,
  onSave,
  onClose,
}: {
  replacing: boolean;
  onSave: (pin: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!isValidPin(pin)) {
      setError(`Use ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
      return;
    }
    if (pin !== confirm) {
      setError("PINs do not match. Re-enter and confirm.");
      return;
    }
    setBusy(true);
    const saveError = await onSave(pin);
    setBusy(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <span className="mb-1 grid h-11 w-11 place-items-center rounded-xl border border-cloak-gold/25 bg-cloak-gold-soft/40 text-cloak-gold">
          <KeyRoundIcon size={20} />
        </span>
        <DialogTitle className="cloak-display text-xl">
          {replacing ? "Change device PIN" : "Set device PIN"}
        </DialogTitle>
        <DialogDescription className="text-cloak-text-secondary">
          This PIN will be required to turn Cloaq Mode off. Use 4 to 8 digits.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3.5"
      >
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
            PIN
          </span>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH));
              setError(null);
            }}
            placeholder="••••"
            aria-label="New PIN"
            className="border-cloak-border bg-cloak-bg text-center text-lg tracking-[0.4em] text-cloak-text placeholder:text-cloak-text-muted"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
            Confirm PIN
          </span>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH));
              setError(null);
            }}
            placeholder="••••"
            aria-label="Confirm PIN"
            className="border-cloak-border bg-cloak-bg text-center text-lg tracking-[0.4em] text-cloak-text placeholder:text-cloak-text-muted"
          />
        </label>

        {error && (
          <p role="alert" className="text-[12px] leading-relaxed text-cloak-danger">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={busy || !pin || !confirm}
          className="bg-cloak-gold/20 hover:bg-cloak-gold/25 w-full border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
        >
          {busy && <LoaderCircleIcon size={15} className="mr-2 animate-spin" />}
          {replacing ? "Save new PIN" : "Set PIN"}
        </Button>
        <p className="text-[11px] leading-relaxed text-cloak-text-muted">
          The PIN is stored only as a SHA-256 hash on this device — never in
          plain text, never sent anywhere.
        </p>
      </form>
    </>
  );
}

/* Privacy ------------------------------------------------------------------ */

function PrivacySection() {
  const privacy = useCloakStore((s) => s.privacy);
  const setPrivacy = useCloakStore((s) => s.setPrivacy);
  const serverPrivacy = useCloakStore((s) => s.serverPrivacy);
  const savePrivacySettings = useCloakStore((s) => s.savePrivacySettings);
  const blockedUsers = useCloakStore((s) => s.blockedUsers);
  const blockedCount = Math.max(privacy.blockedCount, blockedUsers.length);

  return (
    <>
      <CloakModeToggle />
      <Surface className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-cloak-text">Activity</h2>
        <div className="divide-y divide-cloak-border">
          <ToggleRow label="Read receipts" note="Show when you have read messages" checked={privacy.readReceipts} onChange={(v) => setPrivacy({ readReceipts: v })} />
          <ToggleRow label="Typing indicator" note="Show when you are typing" checked={privacy.typingIndicator} onChange={(v) => setPrivacy({ typingIndicator: v })} />
          <ToggleRow label="Online status" note="Show when you are online" checked={privacy.onlineStatus} onChange={(v) => setPrivacy({ onlineStatus: v })} />
        </div>
      </Surface>

      {/* Groups & Circles (spec §74) — server-backed: the refusals happen
          where the decision is made (§80), not in the client. */}
      <Surface className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-cloak-text">Groups &amp; Circles</h2>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] text-cloak-text">Who can add you to groups?</p>
            <Select
              value={serverPrivacy.groupInvitePolicy}
              onValueChange={(v) => void savePrivacySettings({ groupInvitePolicy: v as "trusted" | "valid_invite" | "nobody" })}
            >
              <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
                <SelectItem value="trusted">Trusted contacts only</SelectItem>
                <SelectItem value="valid_invite">Anyone who can already add members</SelectItem>
                <SelectItem value="nobody">Nobody</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] text-cloak-text">Who can add you to Circles?</p>
            <Select
              value={serverPrivacy.circleInvitePolicy}
              onValueChange={(v) => void savePrivacySettings({ circleInvitePolicy: v as "trusted" | "valid_invite" | "nobody" })}
            >
              <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
                <SelectItem value="trusted">Trusted contacts only</SelectItem>
                <SelectItem value="valid_invite">Anyone who can already invite members</SelectItem>
                <SelectItem value="nobody">Nobody</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-cloak-text-muted">
              Applies to direct adds. Invite links stay manager-controlled —
              require approval on the link for the same control (§41).
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] text-cloak-text">Default AI access for new groups</p>
            <Select
              value={serverPrivacy.defaultAiAccess}
              onValueChange={(v) => void savePrivacySettings({ defaultAiAccess: v as "disabled" | "current_request" | "allowed" })}
            >
              <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
                <SelectItem value="disabled">Off</SelectItem>
                <SelectItem value="current_request">On request</SelectItem>
                <SelectItem value="allowed">Allowed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-cloak-text-muted">
              Groups you create start with this. Circle-created groups inherit
              the Circle policy instead — and a Circle restriction always wins (§39).
            </p>
          </div>
        </div>
      </Surface>

      <Surface className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-cloak-text">Content</h2>
        <div className="divide-y divide-cloak-border">
          <ToggleRow label="Message previews" note="Show message text in notifications" checked={privacy.messagePreviews} onChange={(v) => setPrivacy({ messagePreviews: v })} />
          <ToggleRow label="Link previews" note="Generate previews for shared links" checked={privacy.linkPreviews} onChange={(v) => setPrivacy({ linkPreviews: v })} />
          <ToggleRow label="Media saving" note="Save received media to your gallery" checked={privacy.mediaSaving} onChange={(v) => setPrivacy({ mediaSaving: v })} />
        </div>
      </Surface>
      <Surface className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-cloak-text">Blocked users</h2>
        <button
          onClick={() => navigate("/app/contacts")}
          className="flex w-full items-center justify-between rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-3 text-[13px] text-cloak-text-secondary transition-colors hover:bg-cloak-surface"
        >
          {blockedCount === 0
            ? "No blocked users"
            : `${blockedCount} blocked user${blockedCount === 1 ? "" : "s"}`}
          <ChevronRightIcon size={14} className="text-cloak-text-muted" />
        </button>
      </Surface>
    </>
  );
}

/* Notifications ------------------------------------------------------------- */

function NotificationsSection() {
  const notifications = useCloakStore((s) => s.notifications);
  const setNotifications = useCloakStore((s) => s.setNotifications);
  const cloakMode = useCloakStore((s) => s.cloakMode);

  /* Live example of what a notification may show, using the enforced
     notification pipeline (user feedback: Cloaq Mode hides previews and
     sender names in notifications). */
  const example = notificationForIncomingMessage({
    senderName: "Sarah Mitchell",
    body: "Dinner is confirmed for 8 PM Friday.",
    cloakMode,
    previews: notifications.previews,
  });

  return (
    <>
      {/* Web push (spec §62 transport): structural events delivered to the
          OS notification surface while Cloaq is closed. */}
      <WebPushCard />

      <Surface className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-cloak-text">Notifications</h2>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] text-cloak-text">Message previews</p>
            {cloakMode ? (
              <div className="rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/30 px-4 py-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-cloak-gold-bright">
                  <EyeOffIcon size={13} />
                  Hidden by Cloaq Mode
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-cloak-text-secondary">
                  Notifications show no sender name and no message preview while
                  Cloaq Mode is on.
                </p>
              </div>
            ) : (
              <Select
                value={notifications.previews}
                onValueChange={(v) => setNotifications({ previews: v as PreviewVisibility })}
              >
                <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
                  <SelectItem value="name-and-message">Name and message</SelectItem>
                  <SelectItem value="name-only">Name only</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-cloak-text-muted">
              Cloaq Mode overrides this setting: while it is on, notifications
              hide both message previews and sender names.
            </p>
          </div>
          <div className="divide-y divide-cloak-border">
            <ToggleRow label="Sounds" note="Play a quiet sound for new messages" checked={notifications.sounds} onChange={(v) => setNotifications({ sounds: v })} />
            <ToggleRow label="Ghost Chat notifications" note="Notify about Ghost Chats (content never shown)" checked={notifications.ghostChatNotifications} onChange={(v) => setNotifications({ ghostChatNotifications: v })} />
          </div>
        </div>
      </Surface>

      <Surface className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-cloak-text">What a notification shows</h2>
        <p className="mb-4 text-[12px] leading-relaxed text-cloak-text-muted">
          Live preview of an incoming message notification under your current
          settings{cloakMode ? " and Cloaq Mode" : ""}.
        </p>
        <div className="rounded-xl border border-cloak-border bg-cloak-bg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12.5px] font-medium text-cloak-text">{example.title}</p>
            <span className="shrink-0 text-[10.5px] text-cloak-text-muted">now</span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-cloak-text-secondary">{example.body}</p>
        </div>
        {cloakMode && (
          <div className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-cloak-gold-bright">
            <EyeOffIcon size={13} className="mt-0.5 shrink-0" />
            Cloaq Mode is on — the sender name and message preview are hidden.
          </div>
        )}
      </Surface>
    </>
  );
}

/* AI ------------------------------------------------------------------------- */

function AISection() {
  const ai = useCloakStore((s) => s.ai);
  const setAI = useCloakStore((s) => s.setAI);

  return (
    <>
      <Surface className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-cloak-text">Cloaq Intelligence</h2>
        <div className="divide-y divide-cloak-border">
          <ToggleRow label="Enable Cloaq Intelligence" note="Local-first assistant inside the messenger" checked={ai.enabled} onChange={(v) => setAI({ enabled: v })} />
          <ToggleRow label="Persistent memory" note="Keep allowed facts locally between sessions" checked={ai.persistentMemory} onChange={(v) => setAI({ persistentMemory: v })} />
          <ToggleRow label="Local translation" note="Translate with a local model where installed" checked={ai.translation} onChange={(v) => setAI({ translation: v })} />
        </div>
      </Surface>

      <Surface className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-cloak-text">AI processing</h2>
        <p className="mb-4 text-[12px] leading-relaxed text-cloak-text-muted">
          Where intelligence is allowed to run. Cloud is never used silently —
          every cloud answer is labeled, and local-only never contacts anything.
        </p>
        <Select
          value={ai.processing}
          onValueChange={(v) => setAI({ processing: v as AIProcessingPreference })}
        >
          <SelectTrigger className="w-full border-cloak-border bg-cloak-bg text-cloak-text">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
            <SelectItem value="local-only">Local only</SelectItem>
            <SelectItem value="ask-before-cloud">Ask before cloud processing</SelectItem>
            <SelectItem value="allow-cloud">Allow cloud fallback</SelectItem>
          </SelectContent>
        </Select>
      </Surface>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-cloak-text">Local model</h2>
        <AIModelCard />
      </div>
    </>
  );
}

/* Storage --------------------------------------------------------------------- */

function StorageSection() {
  return (
    <>
      <Surface className="p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <HardDriveIcon size={15} className="text-cloak-text-secondary" />
          Local storage
        </h2>
        <div className="space-y-3 text-[13px]">
          <StorageRow label="Message store" note="Encrypted application data (app-controlled)" value="4.2 MB" />
          <StorageRow label="Local AI model" note={MODEL_MANIFEST.gemma.url ? "Installed artifact" : "Not installed — nothing stored"} value={MODEL_MANIFEST.gemma.url ? formatBytes(MODEL_MANIFEST.gemma.sizeBytes) : "0 B"} />
          <StorageRow label="Media cache" note="Cleared on session end" value="12.8 MB" />
        </div>
      </Surface>
      <Surface className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-cloak-text">Model storage policy</h2>
        <p className="text-[12.5px] leading-relaxed text-cloak-text-secondary">
          Model artifacts are stored separately from the interface shell and
          from application data. Removing a model frees its space immediately
          and never touches your conversations.
        </p>
      </Surface>
    </>
  );
}

function StorageRow({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-cloak-border bg-cloak-bg/50 px-4 py-3">
      <div>
        <p className="text-cloak-text">{label}</p>
        <p className="mt-0.5 text-[11px] text-cloak-text-muted">{note}</p>
      </div>
      <span className="font-mono text-[12px] text-cloak-text-secondary">{value}</span>
    </div>
  );
}

/* Appearance -------------------------------------------------------------------- */

function AppearanceSection() {
  const chatFontSize = useCloakStore((s) => s.chatFontSize);
  const setChatFontSize = useCloakStore((s) => s.setChatFontSize);
  const translationLanguage = useCloakStore((s) => s.translationLanguage);
  const setTranslationLanguage = useCloakStore((s) => s.setTranslationLanguage);
  const theme = useCloakStore((s) => s.theme);
  const setTheme = useCloakStore((s) => s.setTheme);

  const fontSizes = [
    { id: "small", label: "Small" },
    { id: "medium", label: "Medium" },
    { id: "large", label: "Large" },
  ] as const;

  /* Swatch colours are literal, not tokens: each preview has to show the OTHER
     theme's palette while the current one is active, and a CSS variable would
     resolve to whatever the live theme happens to be. */
  const themeChoices: Array<{
    id: CloakTheme;
    label: string;
    note: string;
    bg: string;
    surface: string;
    border: string;
    text: string;
    gold: string;
  }> = [
    {
      id: "dark",
      label: "Dark",
      note: "Dark surfaces reduce glare in low light.",
      bg: "#0b0b0c",
      surface: "#151517",
      border: "rgba(255,255,255,0.13)",
      text: "#f4f2ec",
      gold: "#d6b15e",
    },
    {
      id: "light",
      label: "Light",
      note: "Clean white surfaces for crisp everyday reading.",
      bg: "#ffffff",
      surface: "#ffffff",
      border: "rgba(17,24,39,0.18)",
      text: "#111827",
      gold: "#b99343",
    },
  ];

  return (
    <Surface className="p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-cloak-text">
        <MoonIcon size={15} className="text-cloak-gold" />
        Theme
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {themeChoices.map((choice) => {
          const selected = theme === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => setTheme(choice.id)}
              aria-pressed={selected}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                selected
                  ? "border-cloak-gold/40 bg-cloak-gold-soft/30"
                  : "border-cloak-border bg-cloak-surface/50 hover:border-cloak-border-strong"
              )}
            >
              <span
                className="mb-3 flex h-16 items-end gap-1.5 rounded-lg border p-2"
                style={{ background: choice.bg, borderColor: choice.border }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: choice.text }}
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: choice.gold }}
                />
                <span
                  className="h-2.5 flex-1 rounded-full"
                  style={{ background: choice.surface }}
                />
              </span>
              <span className="flex items-center gap-2 text-[13px] font-medium text-cloak-text">
                {choice.label}
                {choice.id === DEFAULT_CLOAK_THEME && (
                  <span className="rounded-full bg-cloak-gold-soft px-2 py-0.5 text-[10px] font-medium text-cloak-gold-bright">
                    Default
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-cloak-text-muted">
                {choice.note}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-cloak-text-muted">
        <InfoIcon size={13} className="mt-0.5 shrink-0" />
        Cloaq is dark-first by design, and both themes are built from the same
        palette tokens — the choice applies to every screen on this device.
      </div>

      {/* Chat font size (user request): small / medium / large */}
      <div className="mt-5 border-t border-cloak-border pt-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <TypeIcon size={15} className="text-cloak-gold" />
          Chat font size
        </h3>
        <p className="mb-3 text-[11.5px] text-cloak-text-muted">
          Applies to message text in every conversation on this device.
        </p>
        <div className="grid max-w-xs grid-cols-3 gap-1 rounded-full border border-cloak-border bg-cloak-surface p-1">
          {fontSizes.map((f) => (
            <button
              key={f.id}
              onClick={() => setChatFontSize(f.id)}
              aria-pressed={chatFontSize === f.id}
              className={cn(
                "rounded-full py-1.5 text-[12.5px] font-medium transition-colors",
                chatFontSize === f.id
                  ? "bg-cloak-gold-soft text-cloak-gold"
                  : "text-cloak-text-secondary hover:text-cloak-text"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p
          className="mt-3 max-w-xs rounded-xl border border-cloak-border bg-cloak-bg/50 px-3.5 py-2.5 leading-relaxed text-cloak-text"
          style={{
            fontSize:
              chatFontSize === "small" ? "12.5px" : chatFontSize === "large" ? "15.5px" : "13.5px",
          }}
        >
          Preview — this is how your messages will read.
        </p>
      </div>

      {/* Translation language (user request): target language for the
          long-press Translate action on messages. */}
      <div className="mt-5 border-t border-cloak-border pt-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cloak-text">
          <LanguagesIcon size={15} className="text-cloak-gold" />
          Translation language
        </h3>
        <p className="mb-3 text-[11.5px] text-cloak-text-muted">
          Long-press any message and choose Translate — the text is translated
          into this language.
        </p>
        <Select
          value={translationLanguage}
          onValueChange={(v) => setTranslationLanguage(v)}
        >
          <SelectTrigger className="w-full max-w-xs border-cloak-border bg-cloak-surface text-cloak-text">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-cloak-border bg-cloak-bg-elevated text-cloak-text">
            {TRANSLATION_LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code} className="text-cloak-text">
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-3 flex max-w-xl items-start gap-2 text-[11.5px] leading-relaxed text-cloak-text-muted">
          <InfoIcon size={13} className="mt-0.5 shrink-0" />
          <span>
            Translation runs entirely on this device with TranslateGemma — the
            message text is never uploaded. The first translation downloads the
            model once (about 3.9 GB, kept on this device) and needs a WebGPU
            browser.
          </span>
        </div>
      </div>
    </Surface>
  );
}

/* Shared row ----------------------------------------------------------------------- */

function ToggleRow({
  label,
  note,
  checked,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div>
        <p className="text-[13.5px] text-cloak-text">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-cloak-text-muted">{note}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
