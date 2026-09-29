"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { MarketingHeader } from "@/components/cloak/navigation/MarketingHeader";
import { MarketingFooter } from "@/components/cloak/navigation/MarketingFooter";
import { useCloakStore } from "@/stores/cloak-store";

export function MarketingShell({ path, children }: { path: string; children: ReactNode }) {
  const bootstrapAuth = useCloakStore((s) => s.bootstrapAuth);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  return (
    <div className="flex min-h-dvh flex-col bg-cloak-bg">
      <MarketingHeader route={{ path, segments: path.split("/").filter(Boolean) }} />
      <div className="flex-1">{children}</div>
      <MarketingFooter />
    </div>
  );
}

