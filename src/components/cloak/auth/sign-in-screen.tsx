"use client";

/*
 * SignInScreen — identity gate for app routes. The session cookie is the
 * source of truth; this screen collects a Cloak ID + passphrase and hands
 * both to /api/auth/login, or creates an account via /api/auth/register
 * (access to the app itself still requires payment or an invitation — the
 * paywall handles that; the account is just the identity). Visual language
 * matches the paywall.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon } from "@animateicons/react/lucide";

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: "That Cloak ID and passphrase don't match.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  bad_request: "Enter your Cloak ID and passphrase.",
  bad_handle: "Cloak IDs are 3-24 characters using letters, numbers, and underscores.",
  bad_password: "Passphrases are 8-256 characters.",
  handle_taken: "That Cloak ID is already taken. Choose another, or sign in.",
  network: "Cloak could not reach the server. Check your connection.",
  server_error: "Something went wrong on our side. Try again.",
};

export function SignInScreen() {
  const signIn = useCloakStore((s) => s.signIn);
  const register = useCloakStore((s) => s.register);
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = handle.trim();
    if (!trimmed || !password) {
      setError(ERROR_COPY.bad_request);
      return;
    }
    setBusy(true);
    setError(null);
    const res =
      mode === "sign-in"
        ? await signIn(trimmed, password)
        : await register(trimmed, password, displayName.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      navigate("/app/messages");
    } else {
      setError(ERROR_COPY[res.error] ?? ERROR_COPY.server_error);
      setPassword("");
      passwordRef.current?.focus();
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cloak-bg px-5 py-16">
      <div aria-hidden="true" className="cloak-vault-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-cloak-gold-soft blur-[110px]"
      />

      <div className="relative w-full max-w-md">
        <button
          onClick={() => navigate("/")}
          aria-label="Cloak — home"
          className="mx-auto mb-10 flex items-center gap-3 text-cloak-text transition-opacity hover:opacity-85"
        >
          {/* Brand mark — the white C-bubble artwork (upload/cloak_logo.svg) */}
          <img
            src="/cloak-logo.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 object-contain"
            draggable={false}
          />
          <span className="cloak-wordmark text-2xl text-cloak-text">Cloak</span>
        </button>

        <div className="cloak-message-in rounded-2xl border border-cloak-border bg-cloak-bg-elevated p-7 md:p-9">
          <div className="text-center">
            <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl border border-cloak-gold/25 bg-cloak-gold-soft/40 text-cloak-gold">
              <KeyRoundIcon size={20} />
            </span>
            <h1 className="cloak-display text-2xl font-medium text-cloak-text">
              {mode === "sign-in" ? "Sign in to Cloak" : "Create your Cloak ID"}
            </h1>
            <p className="mt-2.5 text-[13px] leading-relaxed text-cloak-text-secondary">
              {mode === "sign-in"
                ? "Your conversations stay tied to this device. Signing in restores them — nothing is shared beyond it."
                : "Your account is your identity. Membership is unlocked next, by payment or invitation."}
            </p>
          </div>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Cloak ID
              </span>
              <Input
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setError(null);
                }}
                placeholder={mode === "sign-in" ? "@your.id" : "your-name"}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
              />
            </label>

            {mode === "create" && (
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                  Display name (optional)
                </span>
                <Input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setError(null);
                  }}
                  placeholder="How you appear to others"
                  autoComplete="nickname"
                  className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">
                Passphrase
              </span>
              <Input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder={mode === "create" ? "At least 8 characters" : "••••••••••••"}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                className="border-cloak-border bg-cloak-bg text-[15px] text-cloak-text placeholder:text-cloak-text-muted"
              />
            </label>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-1.5 rounded-lg border border-cloak-danger/25 bg-cloak-danger/5 px-3 py-2.5 text-[12.5px] leading-relaxed text-cloak-danger"
              >
                <TriangleAlertIcon size={13} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 h-12 w-full border border-cloak-gold/30 text-[15px] font-medium text-cloak-gold hover:text-cloak-gold"
            >
              {busy && <LoaderCircleIcon size={15} className="mr-2 animate-spin" />}
              {mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-[12.5px] text-cloak-text-secondary">
            {mode === "sign-in" ? "New to Cloak? " : "Already have a Cloak ID? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "create" : "sign-in");
                setError(null);
              }}
              className="font-medium text-cloak-gold underline-offset-2 transition-colors hover:text-cloak-text hover:underline"
            >
              {mode === "sign-in" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-[11.5px] text-cloak-text-muted">
          Protected by device-bound sessions.{" "}
          <button
            onClick={() => navigate("/")}
            className="text-cloak-text-secondary underline-offset-2 transition-colors hover:text-cloak-text hover:underline"
          >
            Back to cloak.com
          </button>
        </p>
      </div>
    </div>
  );
}
