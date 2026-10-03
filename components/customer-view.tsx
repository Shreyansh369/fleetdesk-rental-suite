"use client";

import { useSearchParams } from "next/navigation";

import { CustomerDirectory } from "./customer-directory";

/*
 * The dashboard links to /customers?view=history so "Full
 * history" opens the customers screen on the history tab
 * rather than on the directory.
 */
export function CustomerView() {
  const params = useSearchParams();

  return (
    <CustomerDirectory
      initialView={params.get("view")}
    />
  );
}
