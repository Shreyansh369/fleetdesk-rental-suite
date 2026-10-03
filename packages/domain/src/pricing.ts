import type { Quote, RentalPeriod, VehicleRates } from "./types";

const DAY_MS = 86_400_000;

function assertSafeCurrency(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative integer number of cents`);
  }
}

/** Rounds every started 24-hour period up; a same-day hire is one rental day. */
export function chargedRentalDays(period: RentalPeriod): number {
  const pickup = Date.parse(period.pickupAt);
  const returnAt = Date.parse(period.expectedReturnAt);
  if (!Number.isFinite(pickup) || !Number.isFinite(returnAt) || returnAt <= pickup) {
    throw new Error("Expected return must be after pickup");
  }
  return Math.max(1, Math.ceil((returnAt - pickup) / DAY_MS));
}

/**
 * Finds the least costly valid daily/weekly/monthly bundle, preserving the exact
 * price snapshot for the rental. Rates are cents to avoid floating-point drift.
 */
export function quoteRental(period: RentalPeriod, rates: VehicleRates): Quote {
  assertSafeCurrency(rates.dailyCents, "Daily rate");
  assertSafeCurrency(rates.weeklyCents, "Weekly rate");
  assertSafeCurrency(rates.monthlyCents, "Monthly rate");
  const days = chargedRentalDays(period);
  const options = [
    { days: 1, cents: rates.dailyCents, key: "daily" as const },
    { days: 7, cents: rates.weeklyCents, key: "weekly" as const },
    { days: 30, cents: rates.monthlyCents, key: "monthly" as const },
  ].filter((option): option is { days: number; cents: number; key: "daily" | "weekly" | "monthly" } => option.cents !== null);

  if (options.length === 0) throw new Error("Vehicle has no active rental rate");

  const limit = days + 29;
  const total = Array<number>(limit + 1).fill(Number.POSITIVE_INFINITY);
  const bundles = Array.from({ length: limit + 1 }, () => ({ daily: 0, weekly: 0, monthly: 0 }));
  total[0] = 0;
  for (let current = 0; current <= limit; current += 1) {
    if (!Number.isFinite(total[current])) continue;
    for (const option of options) {
      const next = current + option.days;
      if (next > limit) continue;
      const candidate = total[current] + option.cents;
      if (candidate < total[next]) {
        total[next] = candidate;
        bundles[next] = { ...bundles[current], [option.key]: bundles[current][option.key] + 1 };
      }
    }
  }
  let best = -1;
  for (let coveredDays = days; coveredDays <= limit; coveredDays += 1) {
    if (best === -1 || total[coveredDays] < total[best]) best = coveredDays;
  }
  if (best === -1 || !Number.isFinite(total[best])) throw new Error("Rental period cannot be priced");
  return {
    chargedDays: days,
    dailyUnits: bundles[best].daily,
    weeklyUnits: bundles[best].weekly,
    monthlyUnits: bundles[best].monthly,
    baseRentalCents: total[best],
    currency: rates.currency,
  };
}

export function calculateBalance(totalCents: number, paidCents: number, refundedCents = 0): number {
  if (![totalCents, paidCents, refundedCents].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Financial values must be non-negative integer cents");
  }
  return totalCents - paidCents + refundedCents;
}

/**
 * Rent owed for keeping a vehicle out until `throughAt`, on top of what has
 * already been charged. It is the same difference an extension charges: the
 * whole hire re-priced from pickup, less the base rental already on the books,
 * so a long hire moves onto a weekly or monthly bundle as soon as that is
 * cheaper. Returns 0 when `throughAt` is not past what is already charged.
 */
export function rentOwedThrough(
  input: { pickupAt: string; chargedThroughAt: string; throughAt: string; baseRentalCents: number },
  rates: VehicleRates,
): number {
  assertSafeCurrency(input.baseRentalCents, "Base rental");
  if (Date.parse(input.throughAt) <= Date.parse(input.chargedThroughAt)) return 0;
  const quote = quoteRental({ pickupAt: input.pickupAt, expectedReturnAt: input.throughAt }, rates);
  return Math.max(0, quote.baseRentalCents - input.baseRentalCents);
}
