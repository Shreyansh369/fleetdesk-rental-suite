import type { Metadata } from "next";

import { acceptableUseDocument } from "@/components/legal-documents";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Acceptable use · FleetDesk",
};

export default function Page() {
  return <LegalPage document={acceptableUseDocument()} />;
}
