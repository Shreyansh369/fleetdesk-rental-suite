import type { Metadata } from "next";

import { termsDocument } from "@/components/legal-documents";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of service · FleetDesk",
};

export default function Page() {
  return <LegalPage document={termsDocument()} />;
}
