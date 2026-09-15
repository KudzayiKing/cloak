import { redirect } from "next/navigation";

export default function MembershipSettingsRedirect() {
  redirect("/#/app/settings/membership");
}
