"use client";

/*
 * New-user onboarding (guardrails baked in — see MEMORY.md "Onboarding"):
 *  - Skippable at every step; nothing is forced.
 *  - Per-device (state lives in localStorage via the store's partialize).
 *  - No secret ever leaves the device: PIN is stored only as a SHA-256 hash,
 *    biometric only as a credential id, and the E2EE key backup is wrapped
 *    client-side with the user's passphrase (zero-knowledge to the server).
 *  - "Off" is a valid notification choice; we never promise lock-screen
 *    content (push is E2EE-blind by design — see receipts/push notes).
 *  - Re-surfaced: skipped steps can be revisited from Settings, and the
 *    notifications nudge re-appears when the first message lands and the
 *    user is still unsubscribed on this device.
 *
 * Onboarding triggers for ALL authenticated users (including those arriving
 * via an adviser invitation) because the trigger is purely client state:
 * auth.user exists, membership is active, and onboarding.completed is false.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  BellIcon,
  CheckIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  ShieldUserIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "@animateicons/react/lucide";
import { useCloakStore } from "@/stores/cloak-store";
import type { OnboardingStepId } from "@/stores/cloak-store";
import { BRAND } from "@/lib/cloak/config";
import {
  biometricAvailable,
  enrollBiometric,
  isValidPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  sha256Hex,
} from "@/lib/cloak/cloak-guard";
import {
  enablePush,
  getPushState,
  pushSupport,
  type PushSupport,
} from "@/lib/cloak/push-client";
import { myIdentityInfo } from "@/lib/crypto/e2ee-orchestrator";
import type { PreviewVisibility } from "@/lib/cloak/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "keys",
  "cloakMode",
  "notifications",
  "done",
];

const STEP_META: Record<
  OnboardingStepId,
  { title: string; subtitle: string; Icon: typeof KeyRoundIcon }
> = {
  welcome: {
    title: "Welcome to Cloak",
    subtitle: "A few quick steps to make it yours",
    Icon: SparklesIcon,
  },
  keys: {
    title: "End-to-end encryption",
    subtitle: "Your messages stay private by design",
    Icon: KeyRoundIcon,
  },
  cloakMode: {
    title: "Cloak Mode passcode",
    subtitle: "Lock the screen when you step away",
    Icon: ShieldUserIcon,
  },
  notifications: {
    title: "Notifications",
    subtitle: "Know when someone writes",
    Icon: BellIcon,
  },
  done: {
    title: "You're all set",
    subtitle: "Cloak is ready",
    Icon: ShieldCheckIcon,
  },
};

function firstIncompleteStep(done: OnboardingStepId[]): number {
  const idx = STEP_ORDER.findIndex((s) => !done.includes(s) && s !== "done");
  return idx === -1 ? 0 : idx;
}

const PUSH_REASON_COPY: Record<string, string> = {
  "ios-needs-install":
    "On iPhone, add Cloak to your Home Screen first (share menu → Add to Home Screen), then enable notifications.",
  insecure: "Notifications need a secure (https) connection.",
  unsupported: "This browser does not support push notifications.",
  "permission-denied":
    "Notification permission was blocked. Enable it in your browser settings, then try again.",
  "server-unconfigured": "Push isn't configured on this server yet.",
  "no-sw": "The service worker isn't active. Reload and try again.",
  "subscribe-failed": "Couldn't subscribe. Try again in a moment.",
  "server-reject": "The server rejected the subscription. Try again.",
};

/* -------------------------------------------------------------------------- */
/* Flow                                                                        */
/* -------------------------------------------------------------------------- */

export function OnboardingFlow() {
  const authChecked = useCloakStore((s) => s.auth.checked);
  const user = useCloakStore((s) => s.auth.user);
  const membershipActive = useCloakStore((s) => s.membership.active);
  const onboarding = useCloakStore((s) => s.onboarding);
  const completeOnboarding = useCloakStore((s) => s.completeOnboarding);
  const completeStep = useCloakStore((s) => s.completeOnboardingStep);
  const skipStep = useCloakStore((s) => s.skipOnboardingStep);

  const open = authChecked && !!user && membershipActive && !onboarding.completed;
  const [step, setStep] = useState(0);

  /* Jump to the first unfinished step whenever the flow (re)opens. */
  useEffect(() => {
    if (open) setStep(firstIncompleteStep(onboarding.stepsDone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const advance = (stepId: OnboardingStepId, skipped = false) => {
    if (skipped) skipStep(stepId);
    else completeStep(stepId);
    setStep((s) => Math.min(s + 1, STEP_ORDER.length - 1));
  };

  const meta = STEP_META[STEP_ORDER[step]];
  const progressTotal = STEP_ORDER.length - 1; // exclude terminal "done"
  const progressCurrent = Math.min(step, progressTotal);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="cloak-scroll flex max-h-[92vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-cloak-bg-elevated shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-cloak-border px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-cloak-gold-soft text-cloak-gold">
              <meta.Icon size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cloak-text">{meta.title}</p>
              <p className="truncate text-xs text-cloak-text-secondary">{meta.subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => completeOnboarding()}
            className="rounded-md px-2 py-1 text-xs text-cloak-text-muted transition-colors hover:bg-cloak-surface hover:text-cloak-text"
            aria-label="Skip setup for now"
          >
            Skip all
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 px-5 pt-3">
          {Array.from({ length: progressTotal }).map((_, i) => (
            <span
              key={i}
              className={
                "h-1 flex-1 rounded-full transition-colors " +
                (i <= progressCurrent ? "bg-cloak-gold" : "bg-cloak-border")
              }
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-5">
          {STEP_ORDER[step] === "welcome" && (
            <WelcomeStep
              handle={user?.handle ?? ""}
              onContinue={() => advance("welcome")}
            />
          )}
          {STEP_ORDER[step] === "keys" && (
            <KeysStep
              userId={user?.id ?? ""}
              identityStatus={useCloakStore.getState().identityStatus}
              onDone={() => advance("keys")}
              onSkip={() => advance("keys", true)}
            />
          )}
          {STEP_ORDER[step] === "cloakMode" && (
            <CloakModeStep
              onDone={() => advance("cloakMode")}
              onSkip={() => advance("cloakMode", true)}
            />
          )}
          {STEP_ORDER[step] === "notifications" && (
            <NotificationsStep
              onDone={() => advance("notifications")}
              onSkip={() => advance("notifications", true)}
            />
          )}
          {STEP_ORDER[step] === "done" && (
            <DoneStep onFinish={() => completeOnboarding()} />
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Welcome                                                                     */
/* -------------------------------------------------------------------------- */

function WelcomeStep({ handle, onContinue }: { handle: string; onContinue: () => void }) {
  const items = [
    { Icon: KeyRoundIcon, label: "End-to-end encryption is already on", note: "Your keys live on this device." },
    { Icon: ShieldUserIcon, label: "Set a Cloak Mode passcode", note: "Lock the screen when you step away." },
    { Icon: BellIcon, label: "Turn on notifications", note: "Get told when someone writes." },
  ];
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-cloak-text-secondary">
        You&apos;re in, <span className="text-cloak-text">@{handle || "friend"}</span>. Cloak is
        private by default. Three quick choices and you&apos;re done — every step is optional.
      </p>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-start gap-3 rounded-lg border border-cloak-border bg-cloak-bg/40 p-3"
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-cloak-gold-soft text-cloak-gold">
              <it.Icon size={16} />
            </span>
            <div>
              <p className="text-sm font-medium text-cloak-text">{it.label}</p>
              <p className="text-xs text-cloak-text-secondary">{it.note}</p>
            </div>
          </li>
        ))}
      </ul>
      <Button
        className="h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright"
        onClick={onContinue}
      >
        Get started <ArrowRightIcon size={16} className="ml-1.5" />
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Keys (E2EE)                                                                */
/* -------------------------------------------------------------------------- */

function KeysStep({
  userId,
  identityStatus,
  onDone,
  onSkip,
}: {
  userId: string;
  identityStatus: string;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    myIdentityInfo(userId)
      .then((info) => {
        if (!cancelled && info) setFingerprint(info.fingerprint);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-cloak-text-secondary">
        Every message is end-to-end encrypted. Your private key is generated on this device and never
        uploaded — not even Cloak can read your conversations.
      </p>

      {fingerprint && (
        <div className="rounded-lg border border-cloak-border bg-cloak-bg/40 p-3">
          <p className="text-xs text-cloak-text-secondary">Your identity fingerprint</p>
          <p className="mt-1 break-all font-mono text-xs text-cloak-text">{fingerprint}</p>
        </div>
      )}

      <div className="rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/40 p-3">
        <p className="text-sm font-medium text-cloak-text">Your backup is safe</p>
        <p className="mt-1 text-xs leading-relaxed text-cloak-text-secondary">
          {identityStatus === "ready" ? (
            <>
              An encrypted backup of your keys is already saved, protected by your Cloak passphrase.
              You can restore your identity on a new device — and only you hold the passphrase.
            </>
          ) : (
            <>
              Set a recovery passphrase in <span className="text-cloak-text">Settings → Security</span>{" "}
              so you can restore your keys on a new device.
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          className="h-11 flex-1 bg-cloak-gold text-black hover:bg-cloak-gold-bright"
          onClick={onDone}
        >
          Got it
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-4 text-cloak-text-secondary hover:text-cloak-text"
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cloak Mode passcode                                                        */
/* -------------------------------------------------------------------------- */

function CloakModeStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const setCloakGuardPin = useCloakStore((s) => s.setCloakGuardPin);
  const setCloakGuardBiometric = useCloakStore((s) => s.setCloakGuardBiometric);
  const existingPin = useCloakStore((s) => s.cloakGuard.pinHash);
  const existingBio = useCloakStore((s) => s.cloakGuard.credentialId);
  const alreadyConfigured = !!existingPin || !!existingBio;

  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [biometricChosen, setBiometricChosen] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    biometricAvailable().then(setBioSupported).catch(() => setBioSupported(false));
  }, []);

  const pinValid = isValidPin(pin) && pin === confirm;
  const canContinue = pinValid || (biometricChosen && bioSupported) || alreadyConfigured;

  async function handleContinue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (pinValid) {
        const hash = await sha256Hex(pin);
        if (hash) setCloakGuardPin(hash);
      }
      if (biometricChosen && bioSupported) {
        const res = await enrollBiometric();
        if (res.ok) setCloakGuardBiometric(res.credentialId);
        else if (!pinValid) setError(res.error);
      }
      onDone();
    } catch {
      setError("Something went wrong. Try again or skip for now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-cloak-text-secondary">
        Cloak Mode hides your messages on screen. A passcode (or biometrics) is required to turn it
        off — so no one can reveal your chats without your permission. This is optional.
      </p>

      {alreadyConfigured && (
        <div className="flex items-center gap-2 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/40 p-3 text-xs text-cloak-text-secondary">
          <CheckIcon size={14} className="shrink-0 text-cloak-gold" />
          You already have a Cloak Mode lock set up.
        </div>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">
            Passcode ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)
          </span>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            maxLength={PIN_MAX_LENGTH}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            className="border-cloak-border bg-cloak-bg text-cloak-text"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-cloak-text-secondary">
            Confirm passcode
          </span>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirm}
            maxLength={PIN_MAX_LENGTH}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            className="border-cloak-border bg-cloak-bg text-cloak-text"
          />
        </label>
        {pin.length > 0 && !isValidPin(pin) && (
          <p className="text-xs text-cloak-warning">
            Enter {PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits.
          </p>
        )}
        {isValidPin(pin) && pin !== confirm && (
          <p className="text-xs text-cloak-warning">Passcodes don&apos;t match.</p>
        )}
      </div>

      {bioSupported && (
        <button
          type="button"
          onClick={() => setBiometricChosen((v) => !v)}
          className={
            "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors " +
            (biometricChosen
              ? "border-cloak-gold/40 bg-cloak-gold-soft/40 text-cloak-text"
              : "border-cloak-border bg-cloak-bg/40 text-cloak-text-secondary hover:text-cloak-text")
          }
        >
          <span className="flex items-center gap-2">
            <ShieldUserIcon size={16} className="text-cloak-gold" /> Use Face / Touch ID instead
          </span>
          {biometricChosen && <CheckIcon size={16} className="text-cloak-gold" />}
        </button>
      )}

      {error && <p className="text-xs text-cloak-warning">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          disabled={!canContinue || busy}
          className="h-11 flex-1 bg-cloak-gold text-black hover:bg-cloak-gold-bright disabled:opacity-40"
          onClick={() => void handleContinue()}
        >
          {busy && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
          {biometricChosen && !pin ? "Add & continue" : "Continue"}
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-4 text-cloak-text-secondary hover:text-cloak-text"
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

const PREVIEW_OPTIONS: { value: PreviewVisibility; label: string; note: string }[] = [
  { value: "name-and-message", label: "Name & message", note: "Shows sender and text in-app." },
  { value: "name-only", label: "Name only", note: "Hides the message text." },
  { value: "off", label: "Off", note: "No preview content at all." },
];

function NotificationsStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const notifications = useCloakStore((s) => s.notifications);
  const setNotifications = useCloakStore((s) => s.setNotifications);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    setSupport(pushSupport());
    getPushState()
      .then((st) => setSubscribed(st.subscribed))
      .catch(() => setSubscribed(false));
  }, []);

  async function handleEnable() {
    setEnabling(true);
    setReason(null);
    const res = await enablePush();
    setEnabling(false);
    if (res.ok) setSubscribed(true);
    else setReason(PUSH_REASON_COPY[res.reason ?? ""] ?? "Couldn't enable notifications.");
  }

  const canEnable = support === "supported" || support === null;

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-cloak-text-secondary">
        Turn on notifications so you know when someone writes. This is per-device and completely
        optional — you can pick what (if anything) a notification shows.
      </p>

      {/* Preview level */}
      <div>
        <p className="mb-2 text-xs font-medium text-cloak-text-secondary">Notification preview</p>
        <div className="grid grid-cols-3 gap-2">
          {PREVIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setNotifications({ previews: opt.value })}
              className={
                "rounded-lg border px-2 py-2 text-center text-xs transition-colors " +
                (notifications.previews === opt.value
                  ? "border-cloak-gold/50 bg-cloak-gold-soft/50 text-cloak-text"
                  : "border-cloak-border bg-cloak-bg/40 text-cloak-text-secondary hover:text-cloak-text")
              }
            >
              <span className="block font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-cloak-text-muted">
          {PREVIEW_OPTIONS.find((o) => o.value === notifications.previews)?.note}
        </p>
      </div>

      {/* Honest E2EE note */}
      <div className="flex gap-2 rounded-lg border border-cloak-border bg-cloak-bg/40 p-3">
        <TriangleAlertIcon size={15} className="mt-0.5 shrink-0 text-cloak-gold" />
        <p className="text-xs leading-relaxed text-cloak-text-secondary">
          While the app is open, notifications honor this choice. When it&apos;s closed, the
          lock-screen alert stays generic (&ldquo;New message&rdquo;) — your messages are
          end-to-end encrypted, so their content is never sent to our servers or your lock screen.
        </p>
      </div>

      {/* Enable button */}
      {subscribed ? (
        <div className="flex items-center gap-2 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/40 p-3 text-sm text-cloak-text">
          <CheckIcon size={16} className="text-cloak-gold" /> Notifications are on for this device.
        </div>
      ) : (
        <Button
          disabled={!canEnable || enabling}
          className="h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright disabled:opacity-40"
          onClick={() => void handleEnable()}
        >
          {enabling && <LoaderCircleIcon size={14} className="mr-1.5 animate-spin" />}
          Enable notifications
        </Button>
      )}

      {reason && <p className="text-xs text-cloak-warning">{reason}</p>}
      {support === "ios-needs-install" && (
        <p className="text-xs text-cloak-text-secondary">
          On iPhone, add Cloak to your Home Screen first (share menu → Add to Home Screen), then
          enable notifications.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          className="h-11 flex-1 text-cloak-text-secondary hover:text-cloak-text"
          onClick={onDone}
        >
          {subscribed ? "Continue" : "No thanks"}
        </Button>
        <Button
          variant="ghost"
          className="h-11 px-4 text-cloak-text-secondary hover:text-cloak-text"
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Done                                                                       */
/* -------------------------------------------------------------------------- */

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-5 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-cloak-gold-soft text-cloak-gold">
        <ShieldCheckIcon size={28} />
      </span>
      <div>
        <p className="text-base font-medium text-cloak-text">You&apos;re all set</p>
        <p className="mt-1 text-sm text-cloak-text-secondary">
          Cloak is ready. You can revisit any of these choices anytime in{" "}
          <span className="text-cloak-text">Settings</span>.
        </p>
      </div>
      <Button
        className="h-11 w-full bg-cloak-gold text-black hover:bg-cloak-gold-bright"
        onClick={onFinish}
      >
        Finish
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Re-surface nudge (post-completion)                                         */
/* -------------------------------------------------------------------------- */

const NUDGE_STEP: OnboardingStepId = "notifications";

export function OnboardingNudge() {
  const onboarding = useCloakStore((s) => s.onboarding);
  const user = useCloakStore((s) => s.auth.user);
  const conversations = useCloakStore((s) => s.conversations);
  const dismissNudge = useCloakStore((s) => s.dismissOnboardingNudge);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (pushSupport() !== "supported") {
      setSubscribed(true); // don't nag on unsupported devices
      return;
    }
    getPushState()
      .then((st) => {
        if (!cancelled) setSubscribed(st.subscribed);
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasMessages = useMemo(
    () => conversations.some((c) => (c.messages?.length ?? 0) > 0),
    [conversations]
  );

  const show =
    onboarding.completed &&
    onboarding.stepsSkipped.includes(NUDGE_STEP) &&
    !onboarding.dismissedNudges.includes(NUDGE_STEP) &&
    subscribed === false &&
    hasMessages &&
    !!user;

  if (!show) return null;

  async function enable() {
    setEnabling(true);
    setReason(null);
    const res = await enablePush();
    setEnabling(false);
    if (res.ok) setSubscribed(true);
    else setReason(PUSH_REASON_COPY[res.reason ?? ""] ?? "Couldn't enable notifications.");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[75] flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] sm:bottom-4 sm:px-4">
      <div className="cloak-scroll flex w-full max-w-md items-center gap-3 rounded-xl border border-cloak-border bg-cloak-bg-elevated p-3 shadow-xl">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cloak-gold-soft text-cloak-gold">
          <BellIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-cloak-text">Turn on notifications?</p>
          <p className="truncate text-xs text-cloak-text-secondary">
            You skipped this earlier — get told when someone writes.
          </p>
          {reason && <p className="mt-1 text-xs text-cloak-warning">{reason}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => dismissNudge(NUDGE_STEP)}
            aria-label="Dismiss"
            className="rounded-md p-2 text-cloak-text-muted transition-colors hover:bg-cloak-surface hover:text-cloak-text"
          >
            <XIcon size={16} />
          </button>
          <Button
            disabled={enabling}
            className="h-9 bg-cloak-gold px-3 text-black hover:bg-cloak-gold-bright disabled:opacity-40"
            onClick={() => void enable()}
          >
            {enabling ? <LoaderCircleIcon size={14} className="animate-spin" /> : "Enable"}
          </Button>
        </div>
      </div>
    </div>
  );
}
