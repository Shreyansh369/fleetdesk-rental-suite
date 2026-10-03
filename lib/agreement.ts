/*
 * The rental agreement the office already uses on paper.
 *
 * The wording below is sample legal text for demonstration.
 * Replace it with the operator's own agreement before going live:
 * what the renter signs has to be what the business wrote.
 *
 * The figures below are quoted inside those clauses, so they
 * live beside them rather than being typed a second time into
 * the pricing code and drifting apart.
 */
export const COMPANY = {
  name: "Demo Car Rental",
  telephone: "+1 (555) 010-0100",
  email: "bookings@example.com",
  address:
    "100 Example Street, Springfield, 00000",
} as const;

/** Charge defaults, taken from the terms overleaf. */
export const AGREEMENT_RATES = {
  /** Clause 9: "$20 per ¼ tank of fuel". */
  fuelPerQuarterTankCents: 2_000,

  /** Clause 10: "A detailing fee of $120". */
  detailingCents: 12_000,

  /** Clause 13: "$10 per day" for drivers under 25. */
  underAgeInsurancePerDayCents: 1_000,

  /** Printed on the form as a fixed figure. */
  depositCents: 30_000,

  /** Clauses 1 and 3: the collision deductible. */
  collisionDeductibleCents: 150_000,
} as const;

export const AGREEMENT_NOTICES = {
  property:
    "THE MONEY YOU PAY GIVES YOU THE PRIVILEGE OF THE USE OF OUR PROPERTY AND NOT THE RIGHT TO ABUSE OR DISREGARD IT.",

  ocean:
    "It is a violation to transport vehicle across the ocean",

  keepLeft: "ALWAYS KEEP LEFT!",

  acknowledgement:
    "I have read and understood the terms and conditions of this agreement and the overleaf and agree thereto.",
} as const;

/*
 * Reproduced verbatim from the second page of the agreement.
 * Do not correct the spelling: this is the text the renter is
 * agreeing to, and it has to match the paper copy word for word.
 */
export const AGREEMENT_TERMS: readonly string[] = [
  "This vehicle has LIABILITY INSURANCE coverage, and $1,500.00 deductible COLLISION INSURANCE. The renter assumes responsibility for all damages to the vehicle, and claims against the owner not covered by this insurance.",

  "No one under 25 years of age may drive this vehicle unless covered by this insurance. This would invalidate insurance coverage. In the event the renter permits anyone under 25 to drive the vehicle he/she, the renter, assumes responsibility for all damages to the car and all claims against the owner of the vehicle rented.",

  "Renter assumes responsibility for all damage to the vehicle not covered by insurance, such as the $1,500.00 deductible, as well as any damages to top or windsheild caused by removing the top or opening the windsheild. In addition, renter is responsible for towing charges incurred by driving the vehicle on washed-out roads, walking trails, beaches, flat tires, traffic violations, etc...",

  "Renter also certifies that all persons who will drive this vehicle have no defect to vision, hearing, nor physical disabilities.",

  "Renter/driver shall be responsible for all damages, injuries or death, resulting from his/her operation of the vehicle or his/her negligence, and shall hold and indemnify Demo Car Rental of and from any claim, suit or expensive arising therefrom.",

  "It is expressly understood and agreed that the renter/driver is not the agent, employee or servant of Demo Car Rentals in any manner whatsoever.",

  "If the vehicle is not returned at the specific time and place it will be deemed converted and treated as theft of the vehicle and/or is subject to an additional day(s) rent.",

  "The renter / driver agrees to personally check the vehicle he/she is about to use, and refuse any vehicle with damage or functional defects.",

  "Vehicle must be returned on gas level it was rented on. If not the renter will be charged $20 per ¼ tank of fuel.",

  "A detailing fee of $120 may apply in circumstances including, but not limited to, where the vehicle is returned with evidence of sand, dirt, mud, and smoking.",

  "Renter / driver must remove all items from said vehicle upon return, Demo Car Rentals would not be liable for items left in vehicle after return date.",

  "It is agreed that in the even the keys for the said vehicle is lost or locked in the vehicle the renter / driver is responsible for the replacement cost or any fees related to retrieving of the keys.",

  "Drivers under the age of 25 are subject to an insurance premium of $10 per day.",

  "The Renter will be liable for any parking charges incurred.",
];

/** The gas levels the form prints, in the order it prints them. */
export const GAS_LEVELS = [
  { value: "empty", label: "Empty" },
  { value: "quarter", label: "¼ tank" },
  { value: "half", label: "½ tank" },
  { value: "three_quarters", label: "¾ tank" },
  { value: "full", label: "Full" },
] as const;

export type GasLevel =
  (typeof GAS_LEVELS)[number]["value"];

/** The charge rows, in the order the form prints them. */
export const CHARGE_ROWS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "extraHours", label: "Extra hours" },
  { key: "fuel", label: "Fuel (units = ¼)" },
  { key: "detailing", label: "Detailing / cleaning" },
  {
    key: "liabilityWaiver",
    label: "Liability waiver",
  },
  {
    key: "windscreenWaiver",
    label: "Windscreen waiver",
  },
  { key: "insurance", label: "Insurance" },
  { key: "carSeat", label: "Car seat(s)" },
  { key: "other", label: "Other" },
] as const;

export type ChargeKey =
  (typeof CHARGE_ROWS)[number]["key"];

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  /* A credit card — not "on credit". The money is still
     taken at the counter or later on the Payment tab. */
  { value: "credit", label: "Credit card" },
] as const;

export type AgreementPaymentMethod =
  (typeof PAYMENT_METHODS)[number]["value"];
