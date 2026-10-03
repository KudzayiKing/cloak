import type { Metadata } from "next";
import { InvitePage } from "@/components/cloak/membership/invite-page";

export const metadata: Metadata = {
  title: "Private invitation — Cloak Dagger",
  robots: { index: false, follow: false },
};

export default async function TrustedInviteRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
