import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, EB_Garamond } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/cloak/pwa/pwa-register";
import { ThemeSync } from "@/components/cloak/theme/theme-sync";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/cloak/theme";
import { BRAND } from "@/lib/cloak/config";

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
  title: `${BRAND.name} — Private Communications & Local-First Intelligence`,
  description:
    "Private messaging, trusted Circles and local-first AI designed for conversations that should remain under your control. No ads. No behavioral advertising.",
  applicationName: BRAND.name,
  manifest: "/manifest.webmanifest",
  keywords: [
    BRAND.name,
    "private messaging",
    "local-first AI",
    "private communications",
    "privacy",
  ],
  authors: [{ name: BRAND.name }],
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
    title: `${BRAND.name} — Private Communications & Local-First Intelligence`,
    description:
      "Private messaging, trusted Circles and local-first AI designed for conversations that should remain under your control.",
    siteName: BRAND.name,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
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
        {children}
        <ThemeSync />
        <PwaRegister />
        <Toaster />
      </body>
    </html>
  );
}
