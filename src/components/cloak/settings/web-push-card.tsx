"use client";

/*
 * Web Push settings card (spec §62 transport) — the honest surface for
 * browser/OS notifications on structural events. Handles every real-world
 * browser posture: full support, iOS that needs Home-Screen install,
 * insecure context, and no push support at all — each with truthful copy
 * rather than a dead control.
 */

import { useCallback, useEffect, useState } from "react";
import { BellIcon, BellRingIcon, LoaderCircleIcon } from "@animateicons/react/lucide";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/cloak/shared/primitives";
import { cn } from "@/lib/utils";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/cloak/push-client";

const REASONS: Record<string, string> = {
  "permission-denied": "Permission was denied. Allow notifications for this site in your browser settings, then try again.",
  "ios-needs-install": "On iPhone and iPad, notifications require Cloaq to be installed. Open the Share menu and choose “Add to Home Screen” first.",
  insecure: "Notifications need a secure connection.",
  unsupported: "This browser does not support web notifications.",
  "no-sw": "The app shell is still loading \u2014 try again in a moment.",
  "server-unconfigured": "Push is not configured on this server yet.",
  "subscribe-failed": "This browser refused the subscription. Try again or check site permissions.",
  "server-reject": "The server could not register this device. Try again shortly.",
};

function statusLine(state: PushState): { title: string; detail: string } {
  if (state.support === "ios-needs-install") {
    return {
      title: "Install Cloaq to enable notifications",
      detail: "Add Cloaq to your Home Screen (Share → Add to Home Screen), then open it from there to turn notifications on.",
    };
  }
  if (state.support === "insecure") {
    return { title: "Unavailable on this connection", detail: "Notifications require a secure (HTTPS) connection." };
  }
  if (state.support === "unsupported") {
    return { title: "Not supported in this browser", detail: "Your browser does not offer web notifications." };
  }
  if (state.subscribed) {
    return {
      title: "Notifications are on for this device",
      detail: "Membership, role and policy events appear on this device even when Cloaq is closed.",
    };
  }
  if (state.permission === "denied") {
    return {
      title: "Blocked in browser settings",
      detail: "Notifications are blocked for this site. Re-allow them in your browser's site settings, then enable here.",
    };
  }
  return {
    title: "Get notified when Cloaq is closed",
    detail: "Adds, removals, role and policy changes, join requests \u2014 delivered to this device's notification area.",
  };
}

export function WebPushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getPushState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onEnable = async () => {
    setBusy(true);
    setError(null);
    const res = await enablePush();
    if (!res.ok) setError(REASONS[res.reason ?? ""] ?? "Notifications could not be enabled.");
    refresh();
    setBusy(false);
  };

  const onDisable = async () => {
    setBusy(true);
    setError(null);
    await disablePush();
    refresh();
    setBusy(false);
  };

  const status = state ? statusLine(state) : null;
  const actionable = state !== null && state.support === "supported" && state.permission !== "denied";
  const isOn = state?.subscribed === true;

  return (
    <Surface className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-cloak-text">Web push</h2>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border",
            isOn ? "border-cloak-gold/30 bg-cloak-gold-soft/30 text-cloak-gold" : "border-cloak-border bg-cloak-bg text-cloak-text-muted"
          )}
        >
          {isOn ? <BellRingIcon size={16} /> : <BellIcon size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          {status ? (
            <>
              <p className="text-[13.5px] font-medium text-cloak-text">{status.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-cloak-text-secondary">{status.detail}</p>
            </>
          ) : (
            <p className="text-[13px] text-cloak-text-muted">Checking this device…</p>
          )}

          {actionable && (
            <div className="mt-3">
              {isOn ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onDisable()}
                  className="border-cloak-border bg-transparent text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
                >
                  {busy && <LoaderCircleIcon size={13} className="animate-spin" />}
                  Turn off for this device
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => void onEnable()} className="bg-cloak-gold text-black hover:bg-cloak-gold-bright">
                  {busy ? <LoaderCircleIcon size={13} className="animate-spin" /> : <BellRingIcon size={13} />}
                  Enable notifications
                </Button>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-cloak-gold/25 bg-cloak-gold-soft/20 px-3 py-2 text-[11.5px] leading-relaxed text-cloak-gold-bright">
              {error}
            </p>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-cloak-text-muted">
            Push notifications carry structural events only — never message
            content (§62). Message previews stay an in-app decision made on
            this device.
          </p>
        </div>
      </div>
    </Surface>
  );
}
