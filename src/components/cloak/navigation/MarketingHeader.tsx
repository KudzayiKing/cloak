"use client";

/*
 * Marketing header — minimal, sticky, quiet (spec §9).
 * Wordmark: CLOAK in EB Garamond. Mobile: animated menu icon, no emoji.
 */

import { useEffect, useRef, useState } from "react";
import { CloakLogo } from "@/components/cloak/brand/CloakLogo";
import { PrimaryCTA } from "@/components/cloak/shared/primitives";
import { navigate, type RouteInfo } from "@/hooks/use-hash-route";
import { useCloakStore } from "@/stores/cloak-store";
import { cn } from "@/lib/utils";
import { MenuIcon, MoonIcon, SunIcon, XIcon } from "@animateicons/react/lucide";

/* Review spec §73: four primary links, no clutter. */
const NAV_ITEMS = [
  { label: "Product", path: "/" },
  { label: "Security", path: "/security" },
  { label: "Intelligence", path: "/intelligence" },
  { label: "Membership", path: "/pricing" },
] as const;

export function MarketingHeader({ route }: { route: RouteInfo }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const authUser = useCloakStore((s) => s.auth.user);
  const authChecked = useCloakStore((s) => s.auth.checked);
  const theme = useCloakStore((s) => s.theme);
  const setTheme = useCloakStore((s) => s.setTheme);
  /* Signed-out visitors get an explicit login path on every page — the
     app route gate renders the sign-in screen for them (owner ask: the
     login link was missing on mobile). */
  const showSignIn = authChecked && !authUser;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    let raf = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => route.path === path && path !== "/";
  const nextTheme = theme === "dark" ? "light" : "dark";
  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-200",
        scrolled
          ? "border-b border-cloak-border bg-cloak-bg/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 md:px-8">
        {/* The C-bubble SVG artwork on every viewport (owner ask: always
            the /cloak-logo.svg mark, never a text-only or legacy mark). */}
        <CloakLogo />

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              onClick={() => go(item.path)}
              aria-current={isActive(item.path) ? "page" : undefined}
              className={cn(
                "rounded-md px-3.5 py-2 text-sm transition-colors",
                isActive(item.path)
                  ? "text-cloak-gold"
                  : "text-cloak-text-secondary hover:text-cloak-text"
              )}
            >
              {item.label}
            </button>
          ))}
          <div className="ml-4 flex items-center gap-3">
            <button
              type="button"
              aria-label={themeLabel}
              title={themeLabel}
              onClick={() => setTheme(nextTheme)}
              className="grid h-9 w-9 place-items-center rounded-full border border-cloak-border bg-cloak-surface text-cloak-text-secondary transition-colors hover:border-cloak-gold/40 hover:text-cloak-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cloak-gold/45"
            >
              {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </button>
            <button
              onClick={() => navigate("/download")}
              className="hidden text-sm text-cloak-text-secondary transition-colors hover:text-cloak-text lg:block"
            >
              Install
            </button>
            {showSignIn && (
              <button
                onClick={() => navigate("/app/messages")}
                className="text-sm text-cloak-text-secondary transition-colors hover:text-cloak-text"
              >
                Sign in
              </button>
            )}
            <PrimaryCTA size="sm" className="h-9 px-4" />
          </div>
        </nav>

        {/* Mobile menu */}
        <div className="relative md:hidden" ref={menuRef}>
          <button
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-cloak-text transition-colors hover:bg-cloak-surface-hover"
          >
            {menuOpen ? <XIcon size={20} /> : <MenuIcon size={20} />}
          </button>
          {menuOpen && (
            <div className="cloak-message-in absolute right-0 top-12 w-56 overflow-hidden rounded-xl border border-cloak-border bg-cloak-bg-elevated shadow-2xl shadow-black/50">
              <div className="flex flex-col p-1.5">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-left text-sm",
                      isActive(item.path)
                        ? "bg-cloak-gold-soft text-cloak-gold"
                        : "text-cloak-text-secondary hover:bg-cloak-surface-hover hover:text-cloak-text"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  onClick={() => go("/download")}
                  className="rounded-lg px-3 py-2.5 text-left text-sm text-cloak-text-secondary hover:bg-cloak-surface-hover hover:text-cloak-text"
                >
                  Install
                </button>
                <button
                  type="button"
                  onClick={() => setTheme(nextTheme)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-cloak-text-secondary hover:bg-cloak-surface-hover hover:text-cloak-text"
                >
                  {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </button>
                {showSignIn && (
                  <button
                    onClick={() => go("/app/messages")}
                    className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-cloak-gold hover:bg-cloak-surface-hover"
                  >
                    Sign in
                  </button>
                )}
                <div className="my-1 h-px bg-cloak-border" />
                <div className="p-1.5">
                  <PrimaryCTA size="sm" className="w-full justify-center" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
