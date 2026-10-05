"use client";

import {
  Check,
  LoaderCircle,
  Info,
} from "@/components/icons";

import {
  ADD_ONS,
  HOSTING_NOTE,
  PLANS,
  PLAN_ORDER,
  TRIAL_DAYS,
  buyoutSavings,
  firstYearCents,
  formatUsd,
  type Plan,
  type PlanId,
} from "@/lib/license";

function ordinal(value: number): string {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[
          value % 10
        ] ?? "th";

  return `${value}${suffix}`;
}

/* What the plan includes, in the order a buyer weighs it. */
function planPoints(plan: Plan): string[] {
  const firstBilledMonth = plan.monthlyStartsAfterMonths + 1;

  return plan.id === "subscription"
    ? [
        `${formatUsd(plan.upfrontCents)} when you start`,
        `${formatUsd(plan.monthlyCents)}/month from the ${ordinal(firstBilledMonth)} month, charged automatically`,
        "Monthly fee covers hosting, updates, maintenance and support",
        "Cancel the monthly plan from the billing portal",
      ]
    : [
        `${formatUsd(plan.upfrontCents)} once, covering the first 12 months`,
        "No monthly fee for the first year",
        `Maintenance and change requests included for ${plan.includedMaintenanceMonths} months`,
        `${formatUsd(plan.monthlyCents)}/month from the ${ordinal(firstBilledMonth)} month, charged automatically`,
      ];
}

export function PricingPlans({
  onChoose,
  busyPlan = null,
  disabled = false,
  footnote = true,
}: {
  /* When given, each plan gets a button that calls it. */
  onChoose?: (plan: PlanId) => void;
  busyPlan?: PlanId | null;
  disabled?: boolean;
  footnote?: boolean;
}) {
  const savings = buyoutSavings();

  return (
    <div className="pricing">
      <div className="pricing-plans">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const featured = id === "buyout";

          return (
            <article
              key={id}
              className={`plan ${featured ? "is-featured" : ""}`}
              aria-labelledby={`plan-${id}`}
            >
              <header className="plan-head">
                <h3 id={`plan-${id}`}>{plan.name}</h3>

                {featured && savings.cents > 0 && (
                  <span className="plan-saving">
                    Save {formatUsd(savings.cents)} in year one
                  </span>
                )}
              </header>

              <p className="plan-summary">{plan.summary}</p>

              <p className="plan-price">
                <strong>{formatUsd(plan.upfrontCents)}</strong>
                <span>
                  {id === "buyout"
                    ? "once for the first year"
                    : "to start"}
                </span>
              </p>

              <p className="plan-then">
                then {formatUsd(plan.monthlyCents)}/month from
                month {plan.monthlyStartsAfterMonths + 1}
              </p>

              <ul className="plan-points">
                {planPoints(plan).map((point) => (
                  <li key={point}>
                    <Check size={16} weight="bold" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <dl className="plan-year">
                <dt>Your first 12 months</dt>
                <dd>{formatUsd(firstYearCents(plan))}</dd>
              </dl>

              {onChoose && (
                <button
                  type="button"
                  className={`button ${
                    featured
                      ? "button-primary"
                      : "button-secondary"
                  } plan-choose`}
                  disabled={disabled || busyPlan !== null}
                  onClick={() => onChoose(id)}
                >
                  {busyPlan === id && (
                    <LoaderCircle
                      size={16}
                      className="spin"
                    />
                  )}
                  Choose {plan.name.toLowerCase()}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {footnote && (
        <div className="pricing-notes">
          <p>
            <Info size={16} />
            <span>
              Every plan starts with a {TRIAL_DAYS}-day free
              trial, no card needed. {HOSTING_NOTE} Prices are
              in US dollars; sales tax is added where it
              applies.
            </span>
          </p>

          <table className="pricing-addons">
            <caption>Optional extras, charged at cost</caption>
            <tbody>
              {ADD_ONS.map((addOn) => (
                <tr key={addOn.id}>
                  <th scope="row">
                    {addOn.name}
                    <span>{addOn.detail}</span>
                  </th>
                  <td>
                    {formatUsd(addOn.cents)}
                    <span>{addOn.period}</span>
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">
                  Install on phones, tablets, computers and TVs
                  <span>
                    Add FleetDesk to the home screen from any
                    modern browser. It opens full screen like
                    an app.
                  </span>
                </th>
                <td>
                  Included
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
