import { Suspense } from "react";

import { FleetView } from "@/components/fleet-view";
import { ProtectedPage } from "@/components/protected-page";

export default function VehiclesPage() {
  return (
    <ProtectedPage>
      <Suspense fallback={null}>
        <FleetView />
      </Suspense>
    </ProtectedPage>
  );
}
