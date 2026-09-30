import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, EB_Garamond } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/cloak/pwa/pwa-register";
import { AutoModelInstall } from "@/components/cloak/pwa/auto-model-install";
import { ThemeSync } from "@/components/cloak/theme/theme-sync";
import { CLOAK_THEME_COLORS, THEME_BOOTSTRAP_SCRIPT } from "@/lib/cloak/theme";
import { APP_URL, BRAND } from "@/lib/cloak/config";
import { SEO, absoluteUrl } from "@/lib/cloak/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Brand wordmark font — user requirement: header wordmark uses EB Garamond */
const cloakSerif = EB_Garamond({
  variable: "--font-cloak-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: SEO.title,
    template: `%s | ${BRAND.name}`,
  },
  description: SEO.description,
  applicationName: BRAND.name,
  manifest: "/manifest.webmanifest",
  keywords: [...SEO.keywords],
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  publisher: BRAND.name,
  category: "Secure communications software",
  alternates: {
    canonical: absoluteUrl("/"),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: SEO.title,
    description: SEO.description,
    url: absoluteUrl("/"),
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
    title: SEO.title,
    description: SEO.description,
    images: ["/icons/icon-512.png"],
  },
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.name,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icons/icon-512.png"),
    slogan: BRAND.tagline,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "security",
      email: "security@cloakdagger.app",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: BRAND.name,
    applicationCategory: "CommunicationApplication",
    operatingSystem: "Web, iOS, Android, macOS, Windows",
    url: absoluteUrl("/"),
    description: SEO.description,
    offers: {
      "@type": "Offer",
      price: "499",
      priceCurrency: "USD",
      category: "membership",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: BRAND.name,
    url: absoluteUrl("/"),
    description: SEO.description,
  },
];

export const viewport: Viewport = {
  /* The elevated surface, not the app background: the mobile header owns the
     status-bar inset and paints it, so the OS chrome has to agree with the
     header. Kept in step with CLOAK_THEME_COLORS in src/lib/cloak/theme.ts,
     which overwrites it once the stored theme is known.

     ONE colour, deliberately NOT a prefers-color-scheme pair (round 21).
     A media-scoped theme-color is resolved against the DEVICE's colour scheme,
     never the app's, so the pair was actively wrong in both directions: a
     light-mode app on a dark-mode phone was handed the dark tint, and — since
     the app's default is dark — a dark app on a light-mode phone was handed
     #ffffff. The status bar then disagreed with the header it sits on and the
     seam read as a border above the header. The app's theme is a stored
     preference, so only one tint can be right here; the pre-paint script
     corrects it for light-mode users a few bytes later. */
  themeColor: CLOAK_THEME_COLORS.dark,
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* Android Chrome: shrink the layout viewport when the keyboard opens so
     dialogs and the composer rise with it (iOS is handled per-dialog via
     the visualViewport keyboard-rise hook). */
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No theme class is hardcoded on <html>: the inline bootstrap script
    // applies the stored choice before first paint and ThemeSync re-applies it
    // on mount, so a hardcoded class would be redundant and could let a layout
    // re-render wipe an imperatively-added .light.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cloakSerif.variable} antialiased bg-background text-foreground`}
      >
        {/* Applies the stored theme before first paint, so a light-mode user
            never sees a flash of the dark shell. Runs first in <body>, which
            is before anything below it has painted. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        <ThemeSync />
        <PwaRegister />
        <AutoModelInstall />
        <Toaster />
      </body>
    </html>
  );
}
