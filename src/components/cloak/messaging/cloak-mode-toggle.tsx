"use client";

/*
 * CloakModeToggle (spec §23) — restrained, immediate control used in the
 * app header and settings. Shows a compact icon state or a labeled switch.
 *
 * Guard-aware (user feedback round 4): turning Cloak Mode ON is immediate;
 * turning it OFF asks for PIN / biometric verification when protection is
 * configured in Settings > Cloak Mode.
 */

import { useCloakModeSwitch } from "@/hooks/use-cloak-mode";
import { cn } from "@/lib/utils";
import { EyeIcon, EyeOffIcon } from "@animateicons/react/lucide";
import { Switch } from "@/components/ui/switch";

export function CloakModeToggle({ compact = false }: { compact?: boolean }) {
  const { cloakMode, toggle } = useCloakModeSwitch();

  if (compact) {
    return (
      <button
        onClick={toggle}
        aria-pressed={cloakMode}
        aria-label={cloakMode ? "Cloak Mode is on — verify to turn it off" : "Turn Cloak Mode on"}
        title={cloakMode ? "Cloak Mode is on" : "Cloak Mode is off"}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
          cloakMode
            ? "bg-cloak-gold-soft text-cloak-gold"
            : "text-cloak-text-secondary hover:bg-cloak-surface hover:text-cloak-text"
        )}
      >
        {cloakMode ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-cloak-border bg-cloak-bg/50 p-4">
      <div>
        <p className="text-sm font-medium text-cloak-text">Cloak Mode</p>
        <p className="mt-0.5 text-xs leading-relaxed text-cloak-text-muted">
          Hide previews, reduce sender details, and lock sensitive chats.
        </p>
      </div>
      <Switch
        checked={cloakMode}
        onCheckedChange={toggle}
        aria-label="Toggle Cloak Mode"
      />
    </div>
  );
}
