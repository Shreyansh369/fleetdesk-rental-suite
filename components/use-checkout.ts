"use client";

import { useState } from "react";

import type {
  PlanId,
  WorkspaceRecord,
} from "@/lib/license";
import { checkoutUrlFor } from "@/lib/services/billing";

/*
 * Sends the administrator to Stripe for the plan they chose, and
 * reports why if that cannot happen.
 */
export function useCheckout(
  workspace: Pick<WorkspaceRecord, "id" | "adminEmail"> | null,
) {
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(plan: PlanId) {
    if (!workspace || busyPlan) return;

    setBusyPlan(plan);
    setError(null);

    try {
      const url = await checkoutUrlFor(workspace, plan);
      window.location.assign(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Stripe could not be opened. Please try again.",
      );
      setBusyPlan(null);
    }
  }

  return { busyPlan, error, choose };
}
