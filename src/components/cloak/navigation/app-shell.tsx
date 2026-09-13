"use client";

/*
 * App shell (spec §15, §16, §33, user feedback round 2).
 * Desktop: left navigation rail. Tablet: icon rail. Mobile: fixed bottom
 * tabs (Chats / Contacts / Security / Settings) that never scroll, with
 * Cloak AI reachable inline via @Cloak in any conversation.
 */

import {
  useEffect,
  useState,
  type ForwardRefExoticComponent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefAttributes,
} from "react";
import { CloakLogo, CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { navigate } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import { useCloakStore } from "@/stores/cloak-store";
import { useCloakModeSwitch } from "@/hooks/use-cloak-mode";
import { CloakGateDialog } from "@/components/cloak/security/cloak-gate-dialog";
import {
  CogIcon,
  MessageCircleMoreIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "@/components/cloak/shared/animated-icons";
import {
  useIconPressAnimation,
  type IconAnimationHandle,
} from "@/hooks/use-icon-press-animation";
import { EyeOffIcon, EyeIcon, WaypointsIcon } from "@animateicons/react/lucide";
import { PanelLeftCloseIcon } from "@/components/cloak/shared/panel-left-close-icon";
import {
  DaggerButton,
  DaggerDialogHost,
  useDaggerDialog,
} from "@/components/cloak/security/dagger";
import { NotificationsBell } from "@/components/cloak/notifications/notifications-center";
import { MobileHeaderMenu } from "@/components/cloak/navigation/mobile-header-menu";
import { useLongPress } from "@/hooks/use-long-press";

type NavIcon = ForwardRefExoticComponent<
  { size?: number; className?: string } & RefAttributes<IconAnimationHandle>
>;

interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
}

const APP_NAV: NavItem[] = [
  { label: "Chats", path: "/app/messages", icon: MessageCircleMoreIcon },
  /* Circles (groups & circles spec §28/§50): the trusted-structure layer,
     distinct from raw conversations. Waypoints = circle of groups. */
  { label: "Circles", path: "/app/circles", icon: WaypointsIcon },
  /* Round 17: owner-supplied lucide-animated references (portrait draw-in
     / shield + check draw-in) — keyframes END at rest so the press
     window's stop stays pixel-identical (no second animation). */
  { label: "Contacts", path: "/app/contacts", icon: UsersIcon },
  { label: "Security", path: "/app/security", icon: ShieldCheckIcon },
];

/* Mobile bottom nav (owner de-clutter round): exactly four tabs — Chats,
   Circles, Contacts, Settings. Security moved into the mobile header's
   three-dot overflow menu (with Cloak Mode and Dagger); the desktop rail
   keeps the full labelled set above. */
const MOBILE_NAV: NavItem[] = [
  { label: "Chats", path: "/app/messages", icon: MessageCircleMoreIcon },
  { label: "Circles", path: "/app/circles", icon: WaypointsIcon },
  { label: "Contacts", path: "/app/contacts", icon: UsersIcon },
  { label: "Settings", path: "/app/settings", icon: CogIcon },
];

/* Mobile nav icon — touch devices have no hover, so pressing a tab starts
   the icon animation and holds it for two seconds (user feedback round 5).
   The pressKey makes the animation survive the navigation remount
   (round 14): the new shell's identical icon resumes the same window. */
function MobileNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const { iconRef, onPointerDown } = useIconPressAnimation(2000, item.path);
  return (
    <button
      onClick={() => navigate(item.path)}
      onPointerDown={onPointerDown}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[56px] flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors",
        active ? "text-cloak-gold" : "text-cloak-text-muted"
      )}
    >
      <item.icon ref={iconRef} size={22} />
      {item.label}
    </button>
  );
}

export function AppShell({
  active,
  children,
  headerAction,
  mobileChrome = true,
}: {
  active: string;
  children: ReactNode;
  /** Optional right-aligned control in the mobile header. */
  headerAction?: ReactNode;
  /** Mobile chrome (header + bottom nav). Hidden while inside a chat
   *  so the conversation is fullscreen (user feedback round 3). */
  mobileChrome?: boolean;
}) {
  const cloakMode = useCloakStore((s) => s.cloakMode);
  const user = useCloakStore((s) => s.auth.user);
  const sidebarCollapsed = useCloakStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useCloakStore((s) => s.setSidebarCollapsed);
  const { toggle: toggleCloakGuarded } = useCloakModeSwitch();

  /* Emergency Dagger gesture (codex §21): hold the Cloak logo for five
     seconds. Opt-in only (default off), never a keyboard shortcut. */
  const emergencyGesture = useCloakStore((s) => s.daggerConfig.emergencyGestureEnabled);
  const openDaggerDialog = useDaggerDialog((s) => s.openDialog);
  const gesture = useLongPress(() => openDaggerDialog(), { ms: 5000 });

  /* Collapsed rail (user feedback round 18): there is no dedicated "open
     drawer" icon — pressing anywhere that is not a real control (empty
     space, header, avatar strip) re-expands the sidebar. The closest()
     guard keeps clicks on the nav buttons / toggles from also bubbling
     into an expansion, so icons keep their own actions only. */
  const handleCollapsedRailClick = (e: ReactMouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='menu'], [role='menuitem']")) {
      return;
    }
    setSidebarCollapsed(false);
  };

  /* Cloak Mode banner announces activation, then fades away after 5s
     (user feedback round 4). Turning Cloak Mode off hides it immediately.
     Phase changes are scheduled in timer callbacks — never synchronously. */
  const [bannerPhase, setBannerPhase] = useState<"hidden" | "shown" | "fading">("hidden");
  useEffect(() => {
    if (!cloakMode) {
      const hide = window.setTimeout(() => setBannerPhase("hidden"), 0);
      return () => window.clearTimeout(hide);
    }
    const show = window.setTimeout(() => setBannerPhase("shown"), 0);
    const fade = window.setTimeout(() => setBannerPhase("fading"), 5000);
    const gone = window.setTimeout(() => setBannerPhase("hidden"), 5600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [cloakMode]);

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-x-hidden bg-cloak-bg md:flex-row">
      {/* Desktop nav rail — collapsible (user feedback round 14).
          Expanded: wordmark + labelled items. Collapsed: Cloak logo,
          icon-only items and the avatar. Width animates. */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden border-r border-cloak-border bg-cloak-bg-elevated transition-[width] duration-200 ease-out md:flex",
          sidebarCollapsed ? "w-[68px] cursor-pointer" : "w-[228px] lg:w-[248px]"
        )}
        title={sidebarCollapsed ? "Expand sidebar" : undefined}
        onClick={sidebarCollapsed ? handleCollapsedRailClick : undefined}
        {...(emergencyGesture ? gesture.longPressHandlers : {})}
      >
        {/* Rail header — expanded: wordmark (no logo mark) + collapse
            toggle; collapsed: no toggle icon at all, just the Cloak logo
            which doubles as the keyboard-accessible expand trigger. */}
        <div
          className={cn(
            "pb-2 pt-6",
            sidebarCollapsed
              ? "flex flex-col items-center"
              : "flex items-center justify-between px-5"
          )}
        >
          {sidebarCollapsed ? (
            <button
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="grid h-10 w-10 place-items-center rounded-md transition-colors hover:bg-cloak-surface"
            >
              <CloakLogoImage size={26} />
            </button>
          ) : (
            <>
              <CloakLogo size="sm" withMark={false} />
              <button
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
                aria-expanded={!sidebarCollapsed}
                title="Collapse sidebar"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-cloak-text-muted transition-colors hover:bg-cloak-surface hover:text-cloak-text"
              >
                <PanelLeftCloseIcon size={18} />
              </button>
            </>
          )}
        </div>

        <nav
          aria-label="Application"
          className={cn(
            "mt-6 flex-1 space-y-0.5",
            sidebarCollapsed ? "px-2" : "px-3"
          )}
        >
          {APP_NAV.map((item) => {
            const isActive = active === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                aria-current={isActive ? "page" : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                className={cn(
                  "transition-colors",
                  sidebarCollapsed
                    ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
                    : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  isActive
                    ? "bg-cloak-gold-soft text-cloak-gold"
                    : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
                )}
              >
                <item.icon size={17} />
                {!sidebarCollapsed && (
                  <span className="whitespace-nowrap">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          className={cn(
            "space-y-0.5 border-t border-cloak-border",
            sidebarCollapsed ? "p-2" : "p-3"
          )}
        >
          <button
            onClick={toggleCloakGuarded}
            aria-pressed={cloakMode}
            title={sidebarCollapsed ? "Cloak Mode" : undefined}
            className={cn(
              "transition-colors",
              sidebarCollapsed
                ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
                : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
              cloakMode
                ? "bg-cloak-gold-soft text-cloak-gold"
                : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
            )}
          >
            {cloakMode ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 whitespace-nowrap text-left">Cloak Mode</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    cloakMode
                      ? "bg-cloak-gold/20 text-cloak-gold"
                      : "border border-cloak-border text-cloak-text-muted"
                  )}
                >
                  {cloakMode ? "On" : "Off"}
                </span>
              </>
            )}
          </button>
          {/* Dagger sits DIRECTLY between Cloak Mode and Settings (§2);
              the notifications bell sits between Dagger and Settings so
              structural events stay one tap away (§62). */}
          <DaggerButton variant="rail" />
          <div className={cn(sidebarCollapsed ? "flex justify-center" : "")}>
            <NotificationsBell variant="rail" collapsed={sidebarCollapsed} />
          </div>
          <button
            onClick={() => navigate("/app/settings")}
            title={sidebarCollapsed ? "Settings" : undefined}
            className={cn(
              "transition-colors",
              sidebarCollapsed
                ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
                : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
              active === "/app/settings"
                ? "bg-cloak-gold-soft text-cloak-gold"
                : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
            )}
          >
            <CogIcon size={17} />
            {!sidebarCollapsed && (
              <span className="whitespace-nowrap">Settings</span>
            )}
          </button>
          <div
            className={cn(
              "flex items-center rounded-lg py-2.5",
              sidebarCollapsed ? "justify-center" : "gap-3 px-3"
            )}
            title={sidebarCollapsed ? user?.displayName ?? "You" : undefined}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cloak-gold-soft text-[11px] font-semibold text-cloak-gold">
              {user?.displayName?.[0]?.toUpperCase() ?? "Y"}
            </span>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-cloak-text">
                  {user?.displayName ?? "You"}
                </p>
                <p className="truncate text-[11px] text-cloak-text-muted">
                  {user ? `@${user.handle}` : "@you"}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main column — min-h-0 lets it shrink inside the h-dvh root so
          the page itself never scrolls on mobile */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-cloak-bg">
        {/* Mobile header — fixed glass overlay (homepage glassmorphism,
            user feedback round 13). Content scrolls beneath it; each page's
            scroll container clears it with pt-14. Owner de-clutter round:
            the right side is ONLY the notifications bell (icon, no text)
            and the three-dot overflow menu — Cloak Mode, Dagger and
            Security live inside that menu. Hidden while inside a
            conversation. */}
        {mobileChrome && (
          <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-cloak-border bg-cloak-bg-elevated px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-cloak-bg-elevated/70 md:hidden">
            {/* Emergency gesture (§21): hold the wordmark 5s when enabled. */}
            <span
              className="cloak-wordmark text-3xl text-cloak-text"
              {...(emergencyGesture ? gesture.longPressHandlers : {})}
            >
              Cloak
            </span>
            <div className="flex items-center gap-1">
              {headerAction}
              <NotificationsBell variant="header" />
              <MobileHeaderMenu />
            </div>
          </header>
        )}

        {/* Cloak Mode banner — desktop: in-flow bar (unchanged) */}
        {cloakMode && bannerPhase !== "hidden" && (
          <div
            className={cn(
              "cloak-message-in hidden shrink-0 items-center justify-center gap-2 border-b border-cloak-gold/20 bg-cloak-gold-soft/40 px-4 py-1.5 text-[11px] font-medium text-cloak-gold-bright transition-opacity duration-500 md:flex",
              bannerPhase === "fading" && "opacity-0"
            )}
          >
            <EyeOffIcon size={12} />
            Cloak Mode is on — previews and activity are hidden
          </div>
        )}

        {/* Cloak Mode banner — mobile: fixed glass toast under the header,
            overlays the list for 5s and fades (no layout shift) */}
        {mobileChrome && cloakMode && bannerPhase !== "hidden" && (
          <div
            className={cn(
              "cloak-message-in fixed inset-x-0 top-14 z-40 flex items-center justify-center gap-2 border-b border-cloak-gold/20 bg-cloak-gold-soft px-4 py-1.5 text-[11px] font-medium text-cloak-gold-bright backdrop-blur-md transition-opacity duration-500 supports-[backdrop-filter]:bg-cloak-gold-soft/70 md:hidden",
              bannerPhase === "fading" && "opacity-0"
            )}
          >
            <EyeOffIcon size={12} />
            Cloak Mode is on — previews and activity are hidden
          </div>
        )}

        <main className="cloak-scroll min-h-0 flex-1 overflow-y-auto bg-cloak-bg md:overflow-hidden">
          {children}
        </main>

        {/* No in-flow spacer: page scroll containers extend to the bottom
            edge so content passes beneath the glass bottom nav — clearance
            is provided inside each page's scroll area (round 13). */}
      </div>

      {/* Mobile bottom nav — fixed glass overlay (homepage glassmorphism,
          user feedback round 13). Content scrolls beneath it. Four tabs
          (owner de-clutter round): Chats / Circles / Contacts / Settings.
          Hidden while inside a conversation. The safe-area strip BELOW the
          tab row is solid app background (round 15): on edge-to-edge
          devices the gesture-bar zone shows this strip, so it must read as
          the app background, not translucent glass. Zero-height when the
          device reports no inset (plain browser tabs) — no visual change. */}
      {mobileChrome && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 md:hidden"
        >
          <div className="grid grid-cols-4 border-t border-cloak-border bg-cloak-bg-elevated backdrop-blur-xl supports-[backdrop-filter]:bg-cloak-bg-elevated/70">
            {MOBILE_NAV.map((item) => (
              <MobileNavItem
                key={item.path}
                item={item}
                active={active === item.path}
              />
            ))}
          </div>
          <div
            aria-hidden
            className="h-[env(safe-area-inset-bottom)] bg-cloak-bg"
          />
        </nav>
      )}
      {/* Cloak Mode protection gate — PIN / biometric verification */}
      <CloakGateDialog />
      {/* Dagger confirmation dialog — one host for rail, header, gesture
          and the security centre (codex §4). */}
      <DaggerDialogHost />
    </div>
  );
}
