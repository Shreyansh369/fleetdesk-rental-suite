import type { Metadata } from "next";
import "./globals.css";
import { FirebaseProvider } from "@/components/firebase-provider";

export const metadata: Metadata = {
  title: "FleetDesk",
  description: "Secure rental operations management",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <FirebaseProvider>{children}</FirebaseProvider>
      </body>
    </html>
  );
}
