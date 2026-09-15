import type { Metadata } from "next";
import { AdviserInvitePage } from "@/components/cloak/membership/adviser-invite-page";
import { BRAND } from "@/lib/cloak/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Private invitation — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AdviserInvitePage token={token} />;
}
