"use client";

import { CloakLogoImage } from "@/components/cloak/brand/CloakLogo";

/*
 * The 40px badge that fronts the install and update prompts.
 *
 * The mark's outer circle is centred in the artwork's own square canvas (see
 * public/cloak-logo.svg — the <use> offset is derived from the ring's
 * tangencies, not from the image rectangle), so a plain centred <img> lands
 * the mark dead centre. Earlier revisions cropped an oversized image inside a
 * clipped 32px stage to fake the centring; that hack is gone.
 *
 * The artwork's ring is 805/943 of the canvas, so a 28px image paints a ~24px
 * mark inside the 40px badge.
 */
export function PwaPromptLogoBadge() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cloak-border bg-cloak-surface">
      <CloakLogoImage size={28} className="max-w-none" />
    </span>
  );
}
