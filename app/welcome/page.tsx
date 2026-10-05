import type { Metadata } from "next";

import { WelcomePage } from "@/components/welcome-page";

export const metadata: Metadata = {
  title: "FleetDesk · Car rental office software",
  description:
    "Bookings, handovers, rental agreements, damage records, payments and finance for car rental businesses. Try the demo in your browser or start a 7-day trial.",
  robots: { index: true, follow: true },
};

export default function Welcome() {
  return <WelcomePage />;
}
