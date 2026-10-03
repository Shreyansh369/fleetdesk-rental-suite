import { FinanceOverview } from "@/components/finance-overview";
import { ProtectedPage } from "@/components/protected-page";

export default function FinancePage() {
  return <ProtectedPage><FinanceOverview /></ProtectedPage>;
}
