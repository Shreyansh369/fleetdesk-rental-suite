import type { Metadata } from "next";

import { cookiesDocument } from "@/components/legal-documents";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Cookie policy · FleetDesk",
};

export default function Page() {
  return <LegalPage document={cookiesDocument()} />;
}
