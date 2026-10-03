import { describe, expect, it } from "vitest";
import { calculateBalance, chargedRentalDays, quoteRental, rentOwedThrough } from "../../packages/domain/src/pricing";
import { isValidVehicleTransition } from "../../packages/domain/src/lifecycle";
import { pickupWindowError } from "../../packages/domain/src/booking";

const rates = { currency: "USD" as const, dailyCents: 7_500, weeklyCents: 45_000, monthlyCents: 150_000 };
describe("rental pricing", () => {
  it("charges a same-day rental as one day", () => expect(chargedRentalDays({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-08-20T17:00:00.000Z" })).toBe(1));
  it("selects the least costly valid rate bundle and snapshots cents", () => expect(quoteRental({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-09-19T08:00:00.000Z" }, rates)).toMatchObject({ chargedDays: 30, monthlyUnits: 1, baseRentalCents: 150_000 }));
  it("uses weekly rates when they beat daily rates", () => expect(quoteRental({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-08-27T08:00:00.000Z" }, rates)).toMatchObject({ weeklyUnits: 1, baseRentalCents: 45_000 }));
  it("rejects an impossible rental period", () => expect(() => chargedRentalDays({ pickupAt: "2026-08-21T08:00:00.000Z", expectedReturnAt: "2026-08-20T08:00:00.000Z" })).toThrow("Expected return"));
  it("keeps payments and refunds in integer-cent balance calculations", () => expect(calculateBalance(100_00, 75_00, 10_00)).toBe(35_00));
});
describe("vehicle lifecycle", () => {
  it("allows only defined transitions", () => { expect(isValidVehicleTransition("reserved", "rented")).toBe(true); expect(isValidVehicleTransition("out_of_service", "rented")).toBe(false); });
});

describe("booking pickup window", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const hours = (count: number) => now + count * 3_600_000;
  it("takes an ordinary booking for a pickup ahead of now", () => expect(pickupWindowError({ pickupAtMs: hours(2), nowMs: now, backdated: false })).toBeNull());
  it("refuses an ordinary booking dated in the past", () => expect(pickupWindowError({ pickupAtMs: hours(-2), nowMs: now, backdated: false })).toContain("cannot be in the past"));
  it("takes a backdated booking for a hire that is already out", () => expect(pickupWindowError({ pickupAtMs: hours(-24 * 30), nowMs: now, backdated: true })).toBeNull());
  it("refuses a backdated booking dated in the future", () => expect(pickupWindowError({ pickupAtMs: hours(2), nowMs: now, backdated: true })).toContain("cannot be picked up in the future"));
  it("refuses a backdate beyond two years, which is a mistyped year", () => expect(pickupWindowError({ pickupAtMs: Date.parse("2016-09-21T12:00:00.000Z"), nowMs: now, backdated: true })).toContain("two years"));
  it("refuses an unparseable pickup", () => expect(pickupWindowError({ pickupAtMs: Number.NaN, nowMs: now, backdated: true })).toContain("valid pickup"));
});

describe("rent owed on a long hire", () => {
  const pickupAt = "2026-08-01T08:00:00.000Z";
  it("charges the next week of a hire paid a week up front", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-15T08:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(45_000));
  it("moves a hire onto the monthly rate once that is cheaper", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-22T08:00:00.000Z", throughAt: "2026-08-31T08:00:00.000Z", baseRentalCents: 135_000 }, rates)).toBe(15_000));
  it("charges a part day past the paid date as a full day", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-08T12:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(7_500));
  it("owes nothing for a date already paid for", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-05T08:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(0));
});
