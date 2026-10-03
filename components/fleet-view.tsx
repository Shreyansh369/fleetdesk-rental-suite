"use client";

import { useSearchParams } from "next/navigation";

import { VehicleDirectory } from "./vehicle-directory";

/*
 * The dashboard links to /vehicles?view=documents so that the
 * "Documents due" figure opens the fleet already narrowed to
 * the vehicles it counted.
 */
export function FleetView() {
  const params = useSearchParams();

  return (
    <VehicleDirectory
      initialView={params.get("view")}
    />
  );
}
