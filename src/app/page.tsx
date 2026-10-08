import { CloakRoot } from "@/components/cloak/router/cloak-root";

/*
 * Cloak — single entry route.
 * The root page and the app's file-system routes share the same client router.
 */
export default function Page() {
  return <CloakRoot />;
}
