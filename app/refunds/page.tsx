import type { Metadata } from "next";

import { refundsDocument } from "@/components/legal-documents";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Refunds and cancellation · FleetDesk",
};

export default function Page() {
  return <LegalPage document={refundsDocument()} />;
}
