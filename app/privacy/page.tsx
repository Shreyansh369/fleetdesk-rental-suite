import type { Metadata } from "next";

import { privacyDocument } from "@/components/legal-documents";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy · FleetDesk",
};

export default function Page() {
  return <LegalPage document={privacyDocument()} />;
}
