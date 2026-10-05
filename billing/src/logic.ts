import type Stripe from "stripe";

import {
  PLANS,
  addMonths,
  type PlanId,
} from "../../lib/license";

/*
 * The decisions the billing function makes, kept free of Stripe
 * and Firebase calls so they can be tested on their own: what a
 * Checkout Session for a plan contains, and what a Stripe event
 * changes on a workspace.
 */

export type PriceIds = {
  subscriptionSetup: string;
  buyout: string;
  monthly: string;
};

/*
 * Both plans are one Stripe subscription: the plan's upfront
 * price as a one-time line item, charged at checkout, and the
 * monthly price, whose first charge is held back by a trial that
 * ends when the plan's monthly fee is due to begin — the third
 * month for Subscription, the thirteenth for Buy outright. After
 * that Stripe charges the card every month (autopay) until the
 * customer cancels from the customer portal.
 *
 * Verify in test mode that the one-time item is charged at
 * checkout (docs/billing.md): the webhook only switches the
 * licence on when the completed session is actually paid.
 */
export function checkoutSessionParams(input: {
  plan: PlanId;
  workspaceId: string;
  email: string;
  customerId: string | null;
  prices: PriceIds;
  appUrl: string;
  now: Date;
}): Stripe.Checkout.SessionCreateParams {
  const plan = PLANS[input.plan];

  if (!plan) {
    throw new Error(`Unknown plan: ${input.plan}`);
  }

  const upfrontPrice =
    plan.id === "subscription"
      ? input.prices.subscriptionSetup
      : input.prices.buyout;

  const monthlyStartsAt = addMonths(
    input.now,
    plan.monthlyStartsAfterMonths,
  );

  const metadata = {
    workspaceId: input.workspaceId,
    plan: plan.id,
  };

  const appUrl = input.appUrl.replace(/\/+$/, "");

  return {
    mode: "subscription",
    client_reference_id: input.workspaceId,
    ...(input.customerId
      ? { customer: input.customerId }
      : { customer_email: input.email }),
    line_items: [
      { price: upfrontPrice, quantity: 1 },
      { price: input.prices.monthly, quantity: 1 },
    ],
    subscription_data: {
      trial_end: Math.floor(
        monthlyStartsAt.valueOf() / 1000,
      ),
      metadata,
    },
    metadata,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing`,
  };
}

export type WorkspaceChange = {
  workspaceId: string | null;
  /* Find the workspace by its Stripe customer when the event has no id. */
  customerId: string | null;
  workspace: Record<string, unknown>;
  billing: Record<string, unknown>;
};

function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function planOf(value: unknown): PlanId | null {
  return value === "subscription" || value === "buyout"
    ? value
    : null;
}

/*
 * What a Stripe event changes. `now` stands in for the server
 * timestamp the caller writes.
 *
 * - A completed and paid checkout switches the licence on.
 * - A completed checkout whose payment is still pending (a bank
 *   debit, say) is only noted; the async success event finishes
 *   the job.
 * - A paid invoice clears a billing problem; a failed one raises
 *   it, so the Billing page can ask for a new card.
 * - A cancelled subscription is recorded for us to follow up;
 *   access is not withdrawn automatically.
 */
export function changeForEvent(
  event: Stripe.Event,
  now: Date,
): WorkspaceChange | null {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const workspaceId =
        session.client_reference_id ??
        session.metadata?.workspaceId ??
        null;

      if (!workspaceId) {
        return null;
      }

      const customerId = idOf(session.customer);
      const subscriptionId = idOf(session.subscription);

      if (session.payment_status !== "paid") {
        return {
          workspaceId,
          customerId,
          workspace: { paymentSubmittedAt: now },
          billing: {
            customerId,
            subscriptionId,
            lastCheckoutSessionId: session.id,
            lastCheckoutPaymentStatus:
              session.payment_status,
          },
        };
      }

      return {
        workspaceId,
        customerId,
        workspace: {
          plan: "paid",
          licenceType: planOf(session.metadata?.plan),
          paidAt: now,
          paymentReference: session.id,
          billingIssue: false,
        },
        billing: {
          customerId,
          subscriptionId,
          lastCheckoutSessionId: session.id,
          lastCheckoutPaymentStatus: "paid",
          amountTotalCents: session.amount_total ?? null,
        },
      };
    }

    case "invoice.paid": {
      const invoice = event.data.object;

      return {
        workspaceId: null,
        customerId: idOf(invoice.customer),
        workspace: { billingIssue: false },
        billing: {
          lastInvoicePaidAt: now,
          lastInvoiceId: invoice.id ?? null,
        },
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;

      return {
        workspaceId: null,
        customerId: idOf(invoice.customer),
        workspace: { billingIssue: true },
        billing: {
          lastPaymentFailedAt: now,
          lastInvoiceId: invoice.id ?? null,
        },
      };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;

      return {
        workspaceId:
          subscription.metadata?.workspaceId ?? null,
        customerId: idOf(subscription.customer),
        workspace: { subscriptionCancelled: true },
        billing: {
          subscriptionStatus: subscription.status,
          subscriptionEndedAt: now,
        },
      };
    }

    default:
      return null;
  }
}
