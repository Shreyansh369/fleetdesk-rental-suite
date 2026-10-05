import { BillingOverview } from "@/components/billing-overview";
import { ProtectedPage } from "@/components/protected-page";

export default function BillingPage() {
  return (
    <ProtectedPage allowExpired>
      <BillingOverview />
    </ProtectedPage>
  );
}
