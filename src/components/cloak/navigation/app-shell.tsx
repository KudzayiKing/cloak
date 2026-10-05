"use client";

/*
 * App shell (spec §15, §16, §33, user feedback round 2).
 * Desktop: left navigation rail. Tablet: icon rail. Mobile: fixed bottom
 * tabs (Chats / Contacts / Security / Settings) that never scroll, with
 * Cloak Dagger AI reachable inline via @CD in any conversation.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefAttributes,
} from "react";
import { CloakLogo, CloakLogoImage } from "@/components/cloak/brand/CloakLogo";
import { navigate } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/cloak/config";
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
import { EyeOffIcon, EyeIcon, WaypointsIcon, WifiCogIcon } from "@animateicons/react/lucide";
import { PanelLeftCloseIcon } from "@/components/cloak/shared/panel-left-close-icon";
import {
  DaggerButton,
  DaggerDialogHost,
  useDaggerDialog,
} from "@/components/cloak/security/dagger";
import { NotificationsBell } from "@/components/cloak/notifications/notifications-center";
import { MobileHeaderMenu } from "@/components/cloak/navigation/mobile-header-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { hapticTap } from "@/lib/cloak/haptics";
import { OnboardingFlow, OnboardingNudge } from "@/components/cloak/onboarding/onboarding-flow";

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
   (round 14): the new shell's identical icon resumes the same window.

   A press also fires a haptic pulse. On a phone the vibration is felt under
   the finger the instant it starts, which is what makes a bottom-nav tap feel
   connected to the screen that opens — the icon animation is still running at
   that point, so it is not the only cue, just a different sense. */
function MobileNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const { iconRef, onPointerDown } = useIconPressAnimation(2000, item.path);

  return (
    <button
      onClick={() => navigate(item.path)}
      onPointerDown={(e) => {
        hapticTap(e.pointerType);
        onPointerDown(e);
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[56px] flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors",
        active ? "text-cloak-gold" : "text-cloak-text-muted"
      )}
    >
      {/* No active pill on mobile. The selection is carried by the gold icon and
          label alone (owner round 6): a filled surface behind a tab that already
          has its own icon, its own label and a 2s press animation reads as a
          button being held down, not a tab being selected — and it adds a third
          block of gold to a bar that is mostly empty space. The desktop rail
          keeps its indicator; it is a wide row where the fill aids scanning,
          whereas here the four tabs are equal-width and the fill would instead
          shift the visual centre of the bar. The icon still pops on
          activation via cloak-tab-active, so the state change is not silent. */}
      <span
        key={active ? "on" : "off"}
        className={cn("flex flex-col items-center", active && "cloak-tab-active")}
      >
        <item.icon ref={iconRef} size={22} />
      </span>
      {item.label}
    </button>
  );
}

function DesktopNavItem({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const iconRef = useRef<IconAnimationHandle | null>(null);
  const onMouseEnter = useCallback(() => {
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (!reduced) iconRef.current?.startAnimation();
  }, []);
  const onMouseLeave = useCallback(() => {
    iconRef.current?.stopAnimation();
  }, []);

  return (
    <button
      onClick={() => navigate(item.path)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative transition-colors",
        collapsed
          ? "mx-auto grid h-10 w-10 place-items-center rounded-lg"
          : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
        active
          ? "text-cloak-gold"
          : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
      )}
    >
      {/* Active surface as a separate layer behind the row, so the icon and
          label can pop on their own without dragging the fill with them.

          The fill is NOT given a negative z-index: the <aside> that owns this
          row does not establish a stacking context, so -z-10 would drop the
          fill behind the rail's own background and make it invisible. Both
          layers are simply positioned siblings and DOM order paints the
          content last, which is the stacking we want. */}
      {active && (
        <span
          aria-hidden="true"
          className="cloak-tab-indicator absolute inset-0 rounded-lg bg-cloak-gold-soft"
        />
      )}
      <span
        key={active ? "on" : "off"}
        className={cn("relative flex items-center gap-3", active && "cloak-tab-active")}
      >
        <item.icon ref={iconRef} size={17} />
        {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
      </span>
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

  /* Publish the bottom nav's height so the update prompt can dock above it and
     so every page's scroll container can clear it via
     `--cloak-bottom-clearance`. Inside a conversation the mobile chrome is
     hidden, so the prompt drops to the safe-area edge and the clearance
     collapses to the safe area alone. Desktop ignores the value entirely
     (globals.css overrides the offset at md).

     The height is MEASURED, not asserted. It used to be the literal "56px",
     which is one pixel short of the truth: the nav is a 1px border-t above a
     56px tab row, so it renders 57px. Every page then cleared 56px and the
     bottom edge of the last card sat under the nav's top hairline on every
     scrolling screen. Measuring also means the value stays honest if the tab
     row is ever re-sized. */
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const publish = () => {
      const el = navRef.current;
      if (!el) {
        root.style.setProperty("--cloak-bottom-nav-h", "0px");
        return;
      }
      /* The nav's padding-bottom is the gesture-area bleed, which hangs BELOW
         the viewport and never covers content — only the part above it has to
         be cleared, so the border box minus that padding is the real number. */
      const styles = window.getComputedStyle(el);
      const bleed = parseFloat(styles.paddingBottom) || 0;
      const height = el.getBoundingClientRect().height - bleed;
      root.style.setProperty(
        "--cloak-bottom-nav-h",
        `${Math.max(0, Math.round(height))}px`
      );
    };
    publish();
    /* The nav is laid out after first paint (fonts, the safe-area inset, the
       PWA install prompt), so re-measure once the frame has settled. */
    const raf = window.requestAnimationFrame(publish);
    /* A one-shot measurement goes stale: the nav can change height AFTER first
       paint — the safe-area inset settles, a font swap reflows the tab row, the
       install prompt appears, or the device rotates. If the published number
       drifts below the nav's real height the last card on every page slides back
       under the bar (the "doesn't scroll all the way down" class of bug). Watch
       the element and the viewport so the value can never drift. */
    const el = navRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && el
        ? new ResizeObserver(publish)
        : null;
    if (ro && el) ro.observe(el);
    window.addEventListener("resize", publish);
    window.addEventListener("orientationchange", publish);
    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
      root.style.setProperty("--cloak-bottom-nav-h", "0px");
    };
  }, [mobileChrome]);

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
              <DesktopNavItem
                key={item.path}
                item={item}
                active={isActive}
                collapsed={sidebarCollapsed}
              />
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
          <DesktopNavItem
            item={{ label: "Nearby", path: "/app/nearby", icon: WifiCogIcon }}
            active={active === "/app/nearby"}
            collapsed={sidebarCollapsed}
          />
          <DesktopNavItem
            item={{ label: "Settings", path: "/app/settings", icon: CogIcon }}
            active={active === "/app/settings"}
            collapsed={sidebarCollapsed}
          />
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
        {/* Mobile header — fixed, OPAQUE chrome (round 20). It was glass until
            round 19; the glass is precisely what stopped it matching the status
            bar. A translucent panel composites with whatever is behind it, so
            the header resolved to #0f0f11 over the page while the OS status-bar
            strip resolved to its own theme_color — a 2/255 seam, and one that
            drifted with whatever scrolled underneath it. Chrome has to be a
            known colour to agree with a colour the platform paints, so the
            header now lays --cloak-bg-elevated down flat.

            The status-bar inset lives INSIDE this panel and carries no
            background of its own, so the strip above the wordmark is the same
            single colour as the row below it by construction — there is no
            separate strip that can drift out of step. Content scrolls beneath
            the header; each page's scroll container clears it with
            --cloak-top-chrome-h. Owner de-clutter round: the right side is ONLY
            the notifications bell (icon, no text) and the three-dot overflow
            menu — Cloak Mode, Dagger and Security live inside that menu.
            Hidden while inside a conversation. */}
        {mobileChrome && (
          <header className="fixed inset-x-0 top-0 z-40 border-b border-cloak-border bg-cloak-bg-elevated md:hidden">
            {/* Status-bar inset. Zero-height when the device reports no inset
                (plain browser tabs) — no visual change there. */}
            <div aria-hidden className="h-[env(safe-area-inset-top)]" />
            <div className="flex h-14 items-center justify-between px-4">
              {/* Emergency gesture (§21): hold the wordmark 5s when enabled. */}
              <span
                className="cloak-wordmark text-2xl text-cloak-text"
                {...(emergencyGesture ? gesture.longPressHandlers : {})}
              >
                {BRAND.name}
              </span>
              <div className="flex items-center gap-1">
                {headerAction}
                <NotificationsBell variant="header" />
                <MobileHeaderMenu />
              </div>
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
              "cloak-message-in fixed inset-x-0 top-[var(--cloak-top-chrome-h)] z-40 flex items-center justify-center gap-2 border-b border-cloak-gold/20 bg-cloak-gold-soft px-4 py-1.5 text-[11px] font-medium text-cloak-gold-bright backdrop-blur-md transition-opacity duration-500 supports-[backdrop-filter]:bg-cloak-gold-soft/70 md:hidden",
              bannerPhase === "fading" && "opacity-0"
            )}
          >
            <EyeOffIcon size={12} />
            Cloak Mode is on — previews and activity are hidden
          </div>
        )}

        {/* The page scroller. `overflow-y-auto` alone computes `overflow-x` to
            `auto`, so ANY horizontal overflow in any page becomes a scrollbar
            band across the bottom of the screen — which is exactly what the
            owner photographed between the chat composer and the gesture bar
            (the band measured rgb(52,52,52), i.e. --cloak-scroll-thumb over
            --cloak-bg-elevated).

            The app shell is a VERTICAL scroller by construction, and desktop
            already hides both axes (`md:overflow-hidden`). Stating the inline
            axis makes mobile match, instead of letting a stray few pixels paint
            chrome. Every route is swept at phone width by the layout probe, so
            this clips nothing that was meant to pan. */}
        <main className="cloak-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-cloak-bg md:overflow-hidden">
          {children}
        </main>

        {/* New-user onboarding (guides every fresh account, including adviser
            invite arrivals) + its post-completion re-surface nudge. */}
        <OnboardingFlow />
        <OnboardingNudge />

        {/* No in-flow spacer: page scroll containers extend to the bottom
            edge so content passes beneath the glass bottom nav — clearance
            is provided inside each page's scroll area (round 13). */}
      </div>

      {/* Mobile bottom nav — fixed, OPAQUE chrome (round 20). Content scrolls
          beneath it. Four tabs (owner de-clutter round): Chats / Circles /
          Contacts / Settings. Hidden while inside a conversation.

          The gesture area is NOT reserved with a spacer of its own (round 19).
          On the owner's device the nav measures exactly 57px — the 1px border
          plus the 56px tab row — which proves env(safe-area-inset-bottom) is 0:
          the strip below the bar is Android's own gesture navigation bar (24dp,
          with Android's 108x4dp pill inside it), sitting OUTSIDE the viewport,
          so nothing in the document can paint it. A spacer would therefore be
          0-height anyway, and the round-19 bleed never fired — it grows the bar
          by the MAXIMUM inset upfront, and safe-area-max-inset-bottom measures
          0 there too. The pattern is kept (it is correct, and costs nothing
          where it does not apply) but the seam is closed from the app's side
          instead: the chrome adopts the platform's own band colour, which is
          what --cloak-bg-elevated now holds.

          The backing is --cloak-bg-ELEVATED, not --cloak-bg, and the panel is
          OPAQUE (round 20). Both matter, for one reason: this bar has to be a
          known colour, because the thing it sits against is painted by Android
          and cannot be negotiated with. A translucent panel over a --cloak-bg
          backing resolves to a blend (#0f0f11), not to the token — which is
          exactly how the two chromes came to disagree. The outer <nav> carries
          the surface AND the bleed (it is what reaches into the padding), so
          the tab row and the strip below it are one colour by construction;
          the inner row adds only the hairline border. */}
      {mobileChrome && (
        <nav
          ref={navRef}
          aria-label="Primary"
          className="cloak-bottom-nav fixed inset-x-0 z-40 bg-cloak-bg-elevated md:hidden"
        >
          <div className="border-t border-cloak-border">
            <div className="grid grid-cols-4">
              {MOBILE_NAV.map((item) => (
                <MobileNavItem
                  key={item.path}
                  item={item}
                  active={active === item.path}
                />
              ))}
            </div>
          </div>
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
