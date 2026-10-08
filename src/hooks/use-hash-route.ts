"use client";

/*
 * Browser-path router for Cloak's client-side product shell.
 *
 * Next.js owns the public URL (for example /messages or /circles/abc), while
 * CloakApp continues to use its existing route map. Old hash URLs are
 * normalized on entry so saved links and installed app shortcuts keep working.
 */

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { isPublicMarketingPath } from "@/lib/cloak/seo";

export interface RouteInfo {
  /** Current browser pathname, normalized without a trailing slash. */
  path: string;
  segments: string[];
}

function normalizePath(path: string): string {
  let normalized = path || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function publicPathFor(route: string): string {
  const path = normalizePath(route);
  if (path === "/app") return "/";
  if (path.startsWith("/app/")) return path.slice("/app".length);
  return path;
}

function normalizeLegacyUrl() {
  if (typeof window === "undefined") return;

  const hashRoute = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : null;
  const pathRoute = window.location.pathname.startsWith("/app/")
    ? window.location.pathname
    : null;
  const legacyRoute = hashRoute ?? pathRoute;
  if (!legacyRoute) return;

  const destination = publicPathFor(legacyRoute);
  window.history.replaceState(
    null,
    "",
    `${destination}${window.location.search}`
  );
}

export function navigate(path: string) {
  if (typeof window === "undefined") return;
  const target = path.startsWith("/") ? path : `/${path}`;
  const [route, anchor] = target.split("#", 2);

  if (isPublicMarketingPath(route)) {
    const destination = anchor ? `${route}#${anchor}` : route;
    if (window.location.pathname === route) {
      if (anchor) {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo({ top: 0 });
      }
      return;
    }
    window.location.assign(destination);
    return;
  }

  const destination = `${publicPathFor(route)}${anchor ? `#${anchor}` : ""}`;
  if (window.location.pathname === publicPathFor(route) && !anchor) {
    window.scrollTo({ top: 0 });
    return;
  }
  window.history.pushState(null, "", destination);
}

/** Navigate to a route, then scroll to an in-page section id. */
export function navigateToSection(path: string, anchor: string) {
  if (typeof window === "undefined") return;
  const target = path.startsWith("/") ? path : `/${path}`;
  if (isPublicMarketingPath(target)) {
    if (window.location.pathname === target) {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.location.assign(`${target}#${anchor}`);
    return;
  }
  navigate(`${target}#${anchor}`);
  window.setTimeout(() => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

export function useHashRoute(): RouteInfo {
  const pathname = usePathname();

  useEffect(() => {
    normalizeLegacyUrl();
  }, [pathname]);

  const path = normalizePath(pathname ?? "/");
  return { path, segments: path.split("/").filter(Boolean) };
}

/** Programmatic navigation helper for event handlers. */
export function useNavigate() {
  return useCallback((path: string) => navigate(path), []);
}
