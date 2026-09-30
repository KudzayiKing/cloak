"use client";

import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";

/*
 * The logo source has a large square canvas around an asymmetric C mark. Prompt
 * badges are tiny, so centre the visible mark inside a clipped 32px stage
 * instead of relying on the SVG's transparent canvas alone.
 */
export function PwaPromptLogoBadge() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-surface">
      <span className="grid h-8 w-8 place-items-center overflow-hidden">
        <CloakLogoImage size={34} className="h-[34px] w-[34px] max-w-none" />
      </span>
    </span>
  );
}
