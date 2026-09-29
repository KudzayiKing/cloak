import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/cloak/config";

export const metadata: Metadata = {
  title: { absolute: `Messages — ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export default function MessagesRedirect() {
  redirect("/#/app/messages");
}
