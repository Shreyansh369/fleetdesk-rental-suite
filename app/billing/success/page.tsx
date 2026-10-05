import { PaymentReturn } from "@/components/billing-overview";
import { ProtectedPage } from "@/components/protected-page";

export default function PaymentReturnPage() {
  return (
    <ProtectedPage allowExpired>
      <PaymentReturn />
    </ProtectedPage>
  );
}
