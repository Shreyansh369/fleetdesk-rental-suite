"use client";

import {
  getFunctions,
  httpsCallable,
} from "firebase/functions";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  checkoutFunctionEnabled,
  paymentLinkFor,
  stripeCheckoutUrl,
  type PlanId,
  type WorkspaceRecord,
} from "@/lib/license";

/*
 * Taking payment, whichever way this site is set up for:
 *
 * - With the billing function deployed (Blaze plan), a Stripe
 *   Checkout Session is created on the server for the chosen
 *   plan, and the licence switches on by itself when Stripe's
 *   webhook reports the payment.
 * - Without it, the plan's Stripe Payment Link is opened with the
 *   workspace id attached, and the licence is switched on from
 *   our side once the payment is matched (pnpm licence activate).
 */

function functions() {
  return getFunctions(
    getFirebaseClient().app,
    process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() ||
      "us-central1",
  );
}

export function canTakePayment(plan: PlanId): boolean {
  return (
    checkoutFunctionEnabled() ||
    Boolean(paymentLinkFor(plan)?.trim())
  );
}

/* Returns the Stripe page to send the administrator to. */
export async function checkoutUrlFor(
  workspace: Pick<WorkspaceRecord, "id" | "adminEmail">,
  plan: PlanId,
): Promise<string> {
  if (checkoutFunctionEnabled()) {
    const create = httpsCallable<
      { plan: PlanId },
      { url: string }
    >(functions(), "createCheckoutSession");

    const { data } = await create({ plan });

    return data.url;
  }

  const link = stripeCheckoutUrl(
    workspace,
    paymentLinkFor(plan),
  );

  if (!link) {
    throw new Error(
      "Online payment is not set up for this plan yet. Contact us and we will send you a payment link.",
    );
  }

  return link;
}

/*
 * Stripe's customer portal, where the card on file is changed
 * and invoices are downloaded. Through the function when it is
 * deployed; otherwise the portal's login link from the Stripe
 * Dashboard, if one is configured.
 */
export async function billingPortalUrl(): Promise<
  string | null
> {
  if (checkoutFunctionEnabled()) {
    const create = httpsCallable<
      undefined,
      { url: string }
    >(functions(), "createPortalSession");

    const { data } = await create();

    return data.url;
  }

  return (
    process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL?.trim() ||
    null
  );
}
