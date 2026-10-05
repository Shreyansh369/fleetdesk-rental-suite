/*
 * The commercial terms, in one place, and what they mean for a
 * workspace at a given moment.
 *
 * - A trial lasts 7 days from the moment the workspace is
 *   created, for one administrator email, with as many staff as
 *   the administrator approves.
 * - Continuing after the trial is a one-time licence fee.
 * - Changes requested in the first month after payment are
 *   included; after that, maintenance is billed monthly.
 *
 * firestore.rules repeats TRIAL_DAYS — it is the rule there, not
 * this file, that actually closes an expired trial — so the two
 * must change together.
 */

export const TRIAL_DAYS = 7;
export const LICENCE_PRICE_CENTS = 49_900;
export const INCLUDED_SUPPORT_DAYS = 30;
export const MAINTENANCE_MONTHLY_CENTS = 2_000;

const DAY_MS = 86_400_000;

export type WorkspacePlan = "trial" | "paid";

export type WorkspaceRecord = {
  id: string;
  name: string;
  ownerUid: string;
  adminEmail: string;
  plan: WorkspacePlan | string;
  trialStartedAt: Date | null;
  paidAt: Date | null;
  paymentSubmittedAt: Date | null;
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
      paidAt: Date | null;
      includedSupportEndsAt: Date | null;
      maintenanceActive: boolean;
    };

export function trialEndsAt(
  trialStartedAt: Date,
): Date {
  return new Date(
    trialStartedAt.valueOf() + TRIAL_DAYS * DAY_MS,
  );
}

export function licenceStatus(
  workspace: Pick<
    WorkspaceRecord,
    "plan" | "trialStartedAt" | "paidAt" | "paymentSubmittedAt"
  >,
  now: Date = new Date(),
): LicenceStatus {
  if (workspace.plan === "paid") {
    const includedSupportEndsAt = workspace.paidAt
      ? new Date(
          workspace.paidAt.valueOf() +
            INCLUDED_SUPPORT_DAYS * DAY_MS,
        )
      : null;

    return {
      state: "paid",
      paidAt: workspace.paidAt,
      includedSupportEndsAt,
      maintenanceActive: Boolean(
        includedSupportEndsAt &&
          now >= includedSupportEndsAt,
      ),
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
 * Checkout is a Stripe Payment Link: no server of ours creates a
 * session, so nothing secret is needed in the browser. The link
 * carries the workspace id as client_reference_id, which is how
 * the payment is matched to the workspace it unlocks, and the
 * administrator's email so the receipt goes to the right place.
 */
export function stripeCheckoutUrl(
  workspace: Pick<WorkspaceRecord, "id" | "adminEmail">,
  baseUrl: string | undefined = process.env
    .NEXT_PUBLIC_STRIPE_PAYMENT_LINK,
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

export function salesEmail(): string | null {
  const value =
    process.env.NEXT_PUBLIC_SALES_EMAIL?.trim();

  return value ? value : null;
}
