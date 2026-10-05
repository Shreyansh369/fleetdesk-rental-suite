import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { changeForEvent, checkoutSessionParams } from "../../billing/src/logic";
import {
  PLANS,
  addMonths,
  buyoutSavings,
  firstYearCents,
  licenceStatus,
  stripeCheckoutUrl,
} from "../../lib/license";

describe("plans", () => {
  it("prices the subscription as $599 then $99 a month from month three", () => {
    expect(PLANS.subscription.upfrontCents).toBe(59_900);
    expect(PLANS.subscription.monthlyCents).toBe(9_900);
    expect(firstYearCents(PLANS.subscription)).toBe(59_900 + 10 * 9_900);
  });

  it("prices buying outright as $1,299 covering the whole first year", () => {
    expect(firstYearCents(PLANS.buyout)).toBe(129_900);
    expect(PLANS.buyout.includedMaintenanceMonths).toBe(3);
  });

  it("shows what buying outright saves in year one", () => {
    expect(buyoutSavings()).toEqual({ cents: 29_000, percent: 18 });
  });

  it("adds calendar months without spilling into the next month", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-10-05T10:00:00Z"), 12).toISOString()).toBe("2027-10-05T10:00:00.000Z");
  });

  it("dates a paid plan's included maintenance and first monthly charge", () => {
    const status = licenceStatus({
      plan: "paid",
      licenceType: "buyout",
      trialStartedAt: null,
      paidAt: new Date("2026-10-05T10:00:00Z"),
      paymentSubmittedAt: null,
    });

    expect(status).toMatchObject({ state: "paid" });
    if (status.state !== "paid") return;
    expect(status.maintenanceIncludedUntil?.toISOString()).toBe("2027-01-05T10:00:00.000Z");
    expect(status.monthlyStartsAt?.toISOString()).toBe("2027-10-05T10:00:00.000Z");
  });

  it("ends a trial after seven days", () => {
    const started = new Date("2026-10-01T00:00:00Z");

    expect(licenceStatus({ plan: "trial", trialStartedAt: started, paidAt: null, paymentSubmittedAt: null }, new Date("2026-10-07T23:00:00Z")).state).toBe("trial");
    expect(licenceStatus({ plan: "trial", trialStartedAt: started, paidAt: null, paymentSubmittedAt: null }, new Date("2026-10-08T00:00:01Z")).state).toBe("expired");
  });

  it("puts the workspace on a payment link, and refuses anything but https", () => {
    const url = stripeCheckoutUrl({ id: "ws123", adminEmail: "owner@sunrise.test" }, "https://buy.stripe.com/test_abc");

    expect(url).toBe("https://buy.stripe.com/test_abc?client_reference_id=ws123&prefilled_email=owner%40sunrise.test");
    expect(stripeCheckoutUrl({ id: "ws123", adminEmail: "" }, "http://buy.stripe.com/x")).toBeNull();
    expect(stripeCheckoutUrl({ id: "ws123", adminEmail: "" }, undefined)).toBeNull();
  });
});

describe("Stripe checkout session", () => {
  const prices = { subscriptionSetup: "price_setup", buyout: "price_buyout", monthly: "price_monthly" };
  const now = new Date("2026-10-05T10:00:00Z");

  it("charges the setup fee now and starts $99 a month in month three", () => {
    const params = checkoutSessionParams({ plan: "subscription", workspaceId: "ws1", email: "a@b.test", customerId: null, prices, appUrl: "https://app.test/", now });

    expect(params.mode).toBe("subscription");
    expect(params.client_reference_id).toBe("ws1");
    expect(params.customer_email).toBe("a@b.test");
    expect(params.line_items).toEqual([
      { price: "price_setup", quantity: 1 },
      { price: "price_monthly", quantity: 1 },
    ]);
    expect(params.subscription_data?.trial_end).toBe(Date.parse("2026-12-05T10:00:00Z") / 1000);
    expect(params.success_url).toBe("https://app.test/billing/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.metadata).toEqual({ workspaceId: "ws1", plan: "subscription" });
  });

  it("charges the buy-out now and holds the monthly fee for twelve months", () => {
    const params = checkoutSessionParams({ plan: "buyout", workspaceId: "ws1", email: "a@b.test", customerId: "cus_1", prices, appUrl: "https://app.test", now });

    expect(params.customer).toBe("cus_1");
    expect(params.customer_email).toBeUndefined();
    expect(params.line_items?.[0]).toEqual({ price: "price_buyout", quantity: 1 });
    expect(params.subscription_data?.trial_end).toBe(Date.parse("2027-10-05T10:00:00Z") / 1000);
  });
});

describe("Stripe events", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  const event = (type: string, object: Record<string, unknown>) =>
    ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;

  it("switches the licence on for a paid checkout", () => {
    const change = changeForEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        client_reference_id: "ws1",
        payment_status: "paid",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { plan: "buyout", workspaceId: "ws1" },
        amount_total: 129_900,
      }),
      now,
    );

    expect(change).toMatchObject({
      workspaceId: "ws1",
      workspace: { plan: "paid", licenceType: "buyout", paidAt: now, billingIssue: false },
      billing: { customerId: "cus_1", subscriptionId: "sub_1", amountTotalCents: 129_900 },
    });
  });

  it("does not switch the licence on while payment is pending or nothing was charged", () => {
    for (const status of ["unpaid", "no_payment_required"]) {
      const change = changeForEvent(
        event("checkout.session.completed", { id: "cs_2", client_reference_id: "ws1", payment_status: status, customer: "cus_1", metadata: {} }),
        now,
      );

      expect(change?.workspace).toEqual({ paymentSubmittedAt: now });
    }
  });

  it("raises and clears a billing problem from invoices", () => {
    expect(changeForEvent(event("invoice.payment_failed", { id: "in_1", customer: "cus_1" }), now)).toMatchObject({
      workspaceId: null,
      customerId: "cus_1",
      workspace: { billingIssue: true },
    });
    expect(changeForEvent(event("invoice.paid", { id: "in_2", customer: "cus_1" }), now)?.workspace).toEqual({ billingIssue: false });
  });

  it("ignores events it has no use for", () => {
    expect(changeForEvent(event("customer.created", { id: "cus_1" }), now)).toBeNull();
  });
});
