import { Suspense } from "react";

import { CustomerView } from "@/components/customer-view";
import { ProtectedPage } from "@/components/protected-page";

export default function CustomersPage() {
  return (
    <ProtectedPage>
      <Suspense fallback={null}>
        <CustomerView />
      </Suspense>
    </ProtectedPage>
  );
}
