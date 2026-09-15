"use client";

/*
 * CircleInvitePage — #/circles/invite/[token] (circles spec §40/§41/§60).
 *
 * Standalone landing (no app chrome): the token IS the capability, so
 * lookup needs no session and shows only what the recipient needs to
 * decide — circle name, inviter, groups offered, expiry, status.
 * Redemption REQUIRES an existing Cloaq account: circle invites organize
 * people who are already members; they are NOT a registration path (§60 —
 * registration is payment-gated; Reserve guest passes are the onboarding
 * grant). The link is shown once by the manager and cannot be reconstructed.
 */

import { useEffect, useState } from "react";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { CloakLogo } from "@/components/cloak/brand/CloakLogo";
import { cn } from "@/lib/utils";
import { CheckIcon, ShieldCheckIcon, WaypointsIcon, XIcon } from "@animateicons/react/lucide";

interface Lookup {
  status: "active" | "redeemed" | "expired" | "revoked";
  circleName: string;
  circleDescription?: string;
  inviterName: string;
  expiresAt: number;
  groups: string[];
}

export function CircleInvitePage({ token }: { token: string }) {
  const authUser = useCloakStore((s) => s.auth.user);
  const authChecked = useCloakStore((s) => s.auth.checked);
  const bootstrapAuth = useCloakStore((s) => s.bootstrapAuth);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ circleName: string; groupsJoined: string[] } | null>(null);
  const [requested, setRequested] = useState<{ circleName: string } | null>(null);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/circles/invite-lookup?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const json = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (res.ok && json.ok === true) {
          setLookup(json as unknown as Lookup);
          setState("ready");
        } else {
          setState("notfound");
        }
      } catch {
        if (!cancelled) setState("notfound");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const redeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setError(null);
    try {
      const res = await fetch("/api/circles/invite-redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok && json.ok === true) {
        if (json.status === "requested") {
          setRequested({ circleName: String(json.circleName ?? "the Circle") });
        } else {
          setJoined({
            circleName: String(json.circleName ?? "the Circle"),
            groupsJoined: (json.groupsJoined as string[]) ?? [],
          });
        }
      } else {
        const code = typeof json.error === "string" ? json.error : "server_error";
        setError(
          code === "already_member"
            ? "You are already a member of this Circle."
            : code === "invite_not_active"
              ? "This invite is no longer active."
              : code === "request_pending"
                ? "You already have a pending request for this Circle."
                : code === "member_limit_reached"
                  ? "This Circle is full."
                  : "Could not accept the invite. Ask the sender for a fresh link."
        );
      }
    } catch {
      setError("Network error — try again.");
    }
    setRedeeming(false);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-cloak-bg px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        <CloakLogo size="sm" withMark={false} />

        <div className="mt-10">
          {state === "loading" && (
            <p className="text-sm text-cloak-text-muted">Checking the invite…</p>
          )}

          {state === "notfound" && (
            <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 p-6 text-center">
              <XIcon size={20} className="mx-auto text-cloak-danger" />
              <p className="mt-3 text-sm text-cloak-text">Invite not found.</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-cloak-text-muted">
                Links are single-use and expire. Ask the sender for a fresh one.
              </p>
              <button
                onClick={() => navigate("/")}
                className="mt-5 rounded-full border border-cloak-border px-4 py-2 text-[13px] text-cloak-text-secondary hover:bg-cloak-surface-hover"
              >
                Go home
              </button>
            </div>
          )}

          {state === "ready" && lookup && requested && (
            <div className="rounded-2xl border border-cloak-gold/30 bg-cloak-gold-soft/20 p-6 text-center">
              <ShieldCheckIcon size={22} className="mx-auto text-cloak-gold" />
              <p className="cloak-wordmark mt-3 text-lg text-cloak-text">Request sent</p>
              <p className="mt-2 text-[13px] leading-relaxed text-cloak-text-secondary">
                A manager of {requested.circleName} will review your request.
                You will be notified when it is approved.
              </p>
              <button
                onClick={() => navigate("/")}
                className="mt-5 rounded-full border border-cloak-border px-5 py-2.5 text-[13px] text-cloak-text-secondary"
              >
                Done
              </button>
            </div>
          )}

          {state === "ready" && lookup && joined && (
            <div className="rounded-2xl border border-cloak-success/30 bg-cloak-success/5 p-6 text-center">
              <CheckIcon size={22} className="mx-auto text-cloak-success" />
              <p className="cloak-wordmark mt-3 text-lg text-cloak-text">Welcome to {joined.circleName}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-cloak-text-secondary">
                {joined.groupsJoined.length > 0
                  ? `You joined: ${joined.groupsJoined.join(", ")}.`
                  : "You now have access to the Circle."}
              </p>
              <button
                onClick={() => navigate("/app/circles")}
                className="mt-5 rounded-full border border-cloak-gold/30 bg-cloak-gold/10 px-5 py-2.5 text-[13px] font-medium text-cloak-gold"
              >
                Open Circles
              </button>
            </div>
          )}

          {state === "ready" && lookup && !joined && (
            <>
              <div className="rounded-2xl border border-cloak-border bg-cloak-surface/50 p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold/10 text-cloak-gold">
                    <WaypointsIcon size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="cloak-display truncate text-lg font-medium text-cloak-text">{lookup.circleName}</p>
                    <p className="text-[12.5px] text-cloak-text-muted">
                      Invited by {lookup.inviterName}
                    </p>
                  </div>
                </div>
                {lookup.circleDescription && (
                  <p className="mt-3 text-[13px] leading-relaxed text-cloak-text-secondary">
                    {lookup.circleDescription}
                  </p>
                )}
                <div className="mt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-cloak-text-muted">Groups included</p>
                  {lookup.groups.length === 0 ? (
                    <p className="mt-1 text-[13px] text-cloak-text-secondary">Circle access only.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {lookup.groups.map((g) => (
                        <li key={g} className="flex items-center gap-2 text-[13px] text-cloak-text">
                          <CheckIcon size={13} className="text-cloak-success" />
                          {g}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="mt-4 text-[11.5px] text-cloak-text-muted">
                  Single-use · expires {new Date(lookup.expiresAt).toLocaleDateString()}
                </p>
              </div>

              {lookup.status !== "active" ? (
                <p className="mt-5 rounded-xl border border-cloak-danger/30 bg-cloak-danger/10 px-4 py-3 text-center text-[13px] text-cloak-danger">
                  This invite is {lookup.status}.
                </p>
              ) : !authChecked ? (
                <p className="mt-5 text-center text-sm text-cloak-text-muted">Checking your session…</p>
              ) : authUser ? (
                <div className="mt-5">
                  <button
                    onClick={redeem}
                    disabled={redeeming}
                    className="w-full rounded-full bg-cloak-gold py-3 text-[14px] font-semibold text-black transition-colors hover:bg-cloak-gold/90 disabled:opacity-60"
                  >
                    {redeeming ? "Accepting…" : `Accept invite to ${lookup.circleName}`}
                  </button>
                  {error && <p className="mt-3 text-center text-[12.5px] text-cloak-danger">{error}</p>}
                </div>
              ) : (
                <div className="mt-5">
                  <button
                    onClick={() => navigate("/")}
                    className="w-full rounded-full border border-cloak-gold/30 bg-cloak-gold/10 py-3 text-[14px] font-medium text-cloak-gold"
                  >
                    Sign in to accept
                  </button>
                  <p className="mt-3 text-center text-[12px] leading-relaxed text-cloak-text-muted">
                    Circle invites are for existing Cloak members. New to Cloaq?
                    Membership starts with a plan on the home page — or ask the
                    sender about a Reserve guest pass.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
