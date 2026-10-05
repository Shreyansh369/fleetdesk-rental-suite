/*
 * The commercial terms, in one place, and what they mean for a
 * workspace at a given moment. Every price on the site, in the
 * legal pages and in the billing function is read from here.
 *
 * - A trial lasts TRIAL_DAYS from the moment the workspace is
 *   created, for one administrator email, with as many staff as
 *   the administrator approves. No card is needed to start.
 * - Then one of two plans:
 *   Subscription  a setup fee, then a monthly fee (subscription
 *                 and maintenance together) charged automatically
 *                 from the third month.
 *   Buy outright  one payment that covers the whole first year:
 *                 no monthly fee for twelve months, maintenance
 *                 included for the first three. The monthly fee
 *                 starts in month thirteen.
 * - Hosting and the database are included in both. The only
 *   extras are pass-through costs: an app-store listing and a
 *   custom domain.
 *
 * firestore.rules repeats TRIAL_DAYS — it is the rule there, not
 * this file, that actually closes an expired trial — so the two
 * must change together.
 */

export const TRIAL_DAYS = 7;

export type PlanId = "subscription" | "buyout";

export type Plan = {
  id: PlanId;
  name: string;
  summary: string;
  /* Charged when the plan is bought. */
  upfrontCents: number;
  /* Subscription and maintenance, charged monthly by autopay. */
  monthlyCents: number;
  /* Whole months after purchase before the first monthly charge. */
  monthlyStartsAfterMonths: number;
  /* Months after purchase during which change requests are free. */
  includedMaintenanceMonths: number;
};

export const PLANS: Record<PlanId, Plan> = {
  subscription: {
    id: "subscription",
    name: "Subscription",
    summary:
      "A smaller payment to start, then a monthly fee from the third month.",
    upfrontCents: 59_900,
    monthlyCents: 9_900,
    monthlyStartsAfterMonths: 2,
    includedMaintenanceMonths: 2,
  },
  buyout: {
    id: "buyout",
    name: "Buy outright",
    summary:
      "One payment covers the first year. No monthly fee until month 13.",
    upfrontCents: 129_900,
    monthlyCents: 9_900,
    monthlyStartsAfterMonths: 12,
    includedMaintenanceMonths: 3,
  },
};

export const PLAN_ORDER: PlanId[] = ["subscription", "buyout"];

/* What the customer pays in their first twelve months on a plan. */
export function firstYearCents(plan: Plan): number {
  const billedMonths = Math.max(
    0,
    12 - plan.monthlyStartsAfterMonths,
  );

  return plan.upfrontCents + billedMonths * plan.monthlyCents;
}

/* What buying outright saves over the subscription in year one. */
export function buyoutSavings(): {
  cents: number;
  percent: number;
} {
  const subscription = firstYearCents(PLANS.subscription);
  const buyout = firstYearCents(PLANS.buyout);
  const cents = Math.max(0, subscription - buyout);

  return {
    cents,
    percent: subscription
      ? Math.round((cents / subscription) * 100)
      : 0,
  };
}

/*
 * Pass-through costs, charged at what they cost us. A web app
 * install on any phone, tablet, computer or TV browser is free.
 */
export const ADD_ONS = [
  {
    id: "android",
    name: "Android app listing",
    cents: 2_500,
    period: "one-time",
    detail:
      "The Google Play developer registration, so the app can be installed from the Play Store under your name.",
  },
  {
    id: "domain",
    name: "Your own web address",
    cents: 1_200,
    period: "per year",
    detail:
      "A domain such as bookings.yourcompany.com, registered and connected for you.",
  },
] as const;

export const HOSTING_NOTE =
  "Hosting, database, backups and security updates are included in both plans.";

const DAY_MS = 86_400_000;

export type WorkspacePlan = "trial" | "paid";

export type WorkspaceRecord = {
  id: string;
  name: string;
  ownerUid: string;
  adminEmail: string;
  plan: WorkspacePlan | string;
  /* Which plan was bought, once paid. */
  licenceType: PlanId | null;
  trialStartedAt: Date | null;
  paidAt: Date | null;
  paymentSubmittedAt: Date | null;
  /* Set by the billing webhook when an automatic payment fails. */
  billingIssue: boolean;
};

export type LicenceStatus =
  | {
      state: "trial";
      trialEndsAt: Date;
      msLeft: number;
      daysLeft: number;
    }
  | {
      state: "expired";
      trialEndsAt: Date;
      paymentSubmitted: boolean;
    }
  | {
      state: "paid";
      plan: Plan | null;
      paidAt: Date | null;
      maintenanceIncludedUntil: Date | null;
      monthlyStartsAt: Date | null;
    };

export function trialEndsAt(
  trialStartedAt: Date,
): Date {
  return new Date(
    trialStartedAt.valueOf() + TRIAL_DAYS * DAY_MS,
  );
}

/* Calendar months, so "from the third month" is a date a person recognises. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.valueOf());
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDay = new Date(
    Date.UTC(
      result.getUTCFullYear(),
      result.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();

  result.setUTCDate(Math.min(day, lastDay));

  return result;
}

export function licenceStatus(
  workspace: Pick<
    WorkspaceRecord,
    | "plan"
    | "trialStartedAt"
    | "paidAt"
    | "paymentSubmittedAt"
  > & {
    licenceType?: PlanId | null;
  },
  now: Date = new Date(),
): LicenceStatus {
  if (workspace.plan === "paid") {
    const plan = workspace.licenceType
      ? PLANS[workspace.licenceType] ?? null
      : null;

    return {
      state: "paid",
      plan,
      paidAt: workspace.paidAt,
      maintenanceIncludedUntil:
        plan && workspace.paidAt
          ? addMonths(
              workspace.paidAt,
              plan.includedMaintenanceMonths,
            )
          : null,
      monthlyStartsAt:
        plan && workspace.paidAt
          ? addMonths(
              workspace.paidAt,
              plan.monthlyStartsAfterMonths,
            )
          : null,
    };
  }

  /*
   * A workspace created a moment ago reads back before the
   * server has stamped its start time; it is a fresh trial.
   */
  const ends = trialEndsAt(
    workspace.trialStartedAt ?? now,
  );

  const msLeft = ends.valueOf() - now.valueOf();

  if (workspace.plan === "trial" && msLeft > 0) {
    return {
      state: "trial",
      trialEndsAt: ends,
      msLeft,
      daysLeft: Math.ceil(msLeft / DAY_MS),
    };
  }

  return {
    state: "expired",
    trialEndsAt: ends,
    paymentSubmitted: Boolean(
      workspace.paymentSubmittedAt,
    ),
  };
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits:
      cents % 100 === 0 ? 0 : 2,
  });
}

/*
 * The no-server way to take payment: a Stripe Payment Link per
 * plan, created in the Stripe Dashboard (docs/billing.md). The
 * link carries the workspace id as client_reference_id, which is
 * how the payment is matched to the workspace it unlocks, and
 * the administrator's email so the receipt goes to the right
 * place. When the billing function is deployed, the Billing page
 * creates a Checkout Session through it instead.
 */
export function paymentLinkFor(
  plan: PlanId,
): string | undefined {
  return plan === "subscription"
    ? process.env.NEXT_PUBLIC_STRIPE_LINK_SUBSCRIPTION
    : process.env.NEXT_PUBLIC_STRIPE_LINK_BUYOUT;
}

export function stripeCheckoutUrl(
  workspace: Pick<WorkspaceRecord, "id" | "adminEmail">,
  baseUrl: string | undefined,
): string | null {
  const base = baseUrl?.trim();

  if (!base) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(base);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  url.searchParams.set(
    "client_reference_id",
    workspace.id,
  );

  if (workspace.adminEmail) {
    url.searchParams.set(
      "prefilled_email",
      workspace.adminEmail,
    );
  }

  return url.toString();
}

/* True when the Stripe billing function is deployed for this build. */
export function checkoutFunctionEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_FUNCTION === "true"
  );
}

export function salesEmail(): string | null {
  const value =
    process.env.NEXT_PUBLIC_SALES_EMAIL?.trim();

  return value ? value : null;
}
