import type { Metadata } from "next";
import { APP_URL, BRAND } from "@/lib/cloak/config";

export const SEO = {
  title: `${BRAND.name} | Secure Private Chat & On-Device AI`,
  description:
    "Cloak Dagger is a secure private chat app for encrypted messaging, trusted Circles, Ghost Chats, Cloak Mode, Dagger device control, and local-first AI.",
  keywords: [
    BRAND.name,
    "secure chat",
    "secure messaging app",
    "private chat app",
    "encrypted messaging",
    "private messaging",
    "privacy chat",
    "on-device AI",
    "local-first AI",
    "ghost chat",
    "privacy app",
  ],
} as const;

export type PublicMarketingRoute = {
  path: string;
  title: string;
  description: string;
  priority: number;
};

export const PUBLIC_MARKETING_ROUTES: PublicMarketingRoute[] = [
  {
    path: "/",
    title: SEO.title,
    description: SEO.description,
    priority: 1,
  },
  {
    path: "/security",
    title: `Security Model | ${BRAND.name}`,
    description:
      "Review Cloak Dagger's end-to-end encryption, threat model, device controls, local AI boundaries, disclosure policy, and privacy practices.",
    priority: 0.95,
  },
  {
    path: "/intelligence",
    title: `On-Device AI | ${BRAND.name}`,
    description:
      "See how Cloak Dagger AI keeps retrieval, memory, translation, and reasoning local-first for private conversations.",
    priority: 0.85,
  },
  {
    path: "/pricing",
    title: `Membership & Pricing | ${BRAND.name}`,
    description:
      "Compare Cloak Dagger Private, Reserve, Private Circle, Office, and Sovereign memberships for secure private communications.",
    priority: 0.8,
  },
  {
    path: "/download",
    title: `Install the Private Chat App | ${BRAND.name}`,
    description:
      "Install Cloak Dagger as a PWA for secure chat, private messaging, and automatic local AI model setup on supported devices.",
    priority: 0.75,
  },
  {
    path: "/about",
    title: `About | ${BRAND.name}`,
    description:
      "Learn why Cloak Dagger exists: secure private communications funded by membership, not advertising or behavioral tracking.",
    priority: 0.7,
  },
  {
    path: "/advisers",
    title: `Advisers | ${BRAND.name}`,
    description:
      "Cloak Dagger works with privacy, legal, executive-protection, and security advisers shaping secure private communications.",
    priority: 0.55,
  },
  {
    path: "/partners",
    title: `Partners | ${BRAND.name}`,
    description:
      "Commercial, deployment, and institutional partnership information for Cloak Dagger private communications environments.",
    priority: 0.5,
  },
] as const;

export function absoluteUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalized, APP_URL).toString();
}

export function seoRoute(path: string): PublicMarketingRoute {
  return PUBLIC_MARKETING_ROUTES.find((route) => route.path === path) ?? PUBLIC_MARKETING_ROUTES[0];
}

export function isPublicMarketingPath(path: string): boolean {
  return PUBLIC_MARKETING_ROUTES.some((route) => route.path === path);
}

export function marketingMetadata(path: string): Metadata {
  const route = seoRoute(path);
  const url = absoluteUrl(route.path);
  return {
    title: { absolute: route.title },
    description: route.description,
    alternates: { canonical: url },
    openGraph: {
      title: route.title,
      description: route.description,
      url,
      siteName: BRAND.name,
      type: "website",
      locale: "en_US",
      images: [
        {
          url: "/icons/icon-512.png",
          width: 512,
          height: 512,
          alt: `${BRAND.name} logo`,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: route.title,
      description: route.description,
      images: ["/icons/icon-512.png"],
    },
  };
}
