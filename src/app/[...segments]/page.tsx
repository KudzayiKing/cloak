import { notFound } from "next/navigation";
import { CloakRoot } from "@/components/cloak/router/cloak-root";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function CloakRoute({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}) {
  const { segments } = await params;

  // API paths must continue to resolve only through their route handlers.
  if (segments[0] === "api") notFound();

  return <CloakRoot />;
}
