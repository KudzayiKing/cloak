import type { MetadataRoute } from "next";
import { PUBLIC_MARKETING_ROUTES, absoluteUrl } from "@/lib/cloak/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_MARKETING_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: new Date("2026-09-30"),
    changeFrequency: route.path === "/" ? "weekly" : "monthly",
    priority: route.priority,
  }));
}

