import {
  Check,
} from "lucide-react";

import {
  INCLUDED_SUPPORT_DAYS,
  LICENCE_PRICE_CENTS,
  MAINTENANCE_MONTHLY_CENTS,
  TRIAL_DAYS,
  formatUsd,
} from "@/lib/license";

/*
 * The offer, stated the same way wherever it appears: on the
 * welcome page, at the end of a trial, and on Billing.
 */
export function LicenceTerms({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={`licence-terms ${
        compact ? "is-compact" : ""
      }`}
    >
      <div className="licence-price">
        <strong>
          {formatUsd(LICENCE_PRICE_CENTS)}
        </strong>
        <span>one-time licence</span>
      </div>

      <ul className="licence-points">
        <li>
          <Check size={16} />
          <span>
            {TRIAL_DAYS}-day free trial first, for
            your administrator and the whole team
          </span>
        </li>
        <li>
          <Check size={16} />
          <span>
            Everything in the workspace — bookings,
            agreements, damage, payments, expenses,
            finance and staff
          </span>
        </li>
        <li>
          <Check size={16} />
          <span>
            Changes you ask for in the first{" "}
            {INCLUDED_SUPPORT_DAYS} days are included
          </span>
        </li>
        <li>
          <Check size={16} />
          <span>
            Then{" "}
            {formatUsd(MAINTENANCE_MONTHLY_CENTS)}
            /month maintenance for updates, fixes and
            support
          </span>
        </li>
      </ul>
    </div>
  );
}
