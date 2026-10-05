import type { Metadata, Viewport } from "next";

import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./globals.css";

import { CookieNotice } from "@/components/cookie-notice";
import { FirebaseProvider } from "@/components/firebase-provider";

export const metadata: Metadata = {
  title: "FleetDesk",
  description: "Operations software for car rental businesses",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FleetDesk",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/brand/app-icon-180.png",
  },
};

/*
 * viewport-fit=cover lets the layout use the whole screen on
 * phones with a notch; the stylesheet pads the edges with the
 * safe-area insets so nothing sits under it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121822",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <FirebaseProvider>{children}</FirebaseProvider>
        <CookieNotice />
      </body>
    </html>
  );
}
