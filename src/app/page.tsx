import { CloakRoot } from "@/components/cloak/router/cloak-root";

/*
 * Cloak — single entry route.
 * The sandbox preview exposes this route only; the full product route map
 * (marketing + app) is delivered through the internal hash router, whose
 * paths match the eventual file-system routes one-for-one.
 */
export default function Page() {
  return <CloakRoot />;
}
