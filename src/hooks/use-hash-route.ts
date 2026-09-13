"use client";

/*
 * Hash-based router.
 *
 * The sandbox preview exposes a single Next.js route, so Cloak's full route
 * map (marketing + app) is delivered through hash paths: #/, #/security,
 * #/messages, #/security/devices ... The path strings match the eventual
 * file-system routes exactly, so migrating to real routes is a
 * mechanical change: replace `navigate()` with `next/link` and split
 * components into page files.
 */

import { useCallback, useEffect, useState } from "react";

export interface RouteInfo {
  /** Normalized path without leading '#', always starts with '/'. */
  path: string;
  segments: string[];
}

function parseHash(): RouteInfo {
  const raw = typeof window === "undefined" ? "" : window.location.hash;
  let path = raw.replace(/^#/, "");
  if (!path || path === "/") path = "/";
  if (!path.startsWith("/")) path = "/" + path;
  // Strip trailing slash except root
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, segments: path.split("/").filter(Boolean) };
}

export function navigate(path: string) {
  if (typeof window === "undefined") return;
  const target = path.startsWith("/") ? path : "/" + path;
  if (window.location.hash === "#" + target) {
    // Force scroll reset for same-route navigation
    window.scrollTo({ top: 0 });
    return;
  }
  window.location.hash = target;
}

/**
 * Navigate to a route, then scroll to an in-page section id.
 * Used for footer/trust links such as "Threat model" -> /security#threat-model.
 * The hash router owns location.hash, so anchors are resolved after the
 * route renders (short delay), never via the raw URL fragment.
 */
export function navigateToSection(path: string, anchor: string) {
  if (typeof window === "undefined") return;
  const scroll = () => {
    window.setTimeout(() => {
      document
        .getElementById(anchor)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };
  if (window.location.hash === "#" + (path.startsWith("/") ? path : "/" + path)) {
    scroll();
    return;
  }
  navigate(path);
  scroll();
}

export function useHashRoute(): RouteInfo {
  const [route, setRoute] = useState<RouteInfo>({ path: "/", segments: [] });

  useEffect(() => {
    const update = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return route;
}

/** Programmatic navigation helper for event handlers. */
export function useNavigate() {
  return useCallback((path: string) => navigate(path), []);
}
