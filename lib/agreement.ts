/*
 * The rental agreement printed for every hire.
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

/** Charge defaults, quoted in the terms below. */
export const AGREEMENT_RATES = {
  /** Fuel clause: "$25 per ¼ tank". */
  fuelPerQuarterTankCents: 2_500,

  /** Cleaning clause: "a cleaning fee of $150". */
  detailingCents: 15_000,

  /** Young driver clause: "$15 per day" for drivers under 25. */
  underAgeInsurancePerDayCents: 1_500,

  /** Printed on the form as a fixed figure. */
  depositCents: 25_000,

  /** Insurance clauses: the collision deductible. */
  collisionDeductibleCents: 100_000,
} as const;

export const AGREEMENT_NOTICES = {
  property:
    "PLEASE TREAT THIS VEHICLE AS YOUR OWN. YOU ARE RESPONSIBLE FOR ITS CARE WHILE IT IS IN YOUR POSSESSION.",

  territory:
    "The vehicle may not be taken outside the permitted operating area, including by ferry or other transport, without written consent.",

  traffic: "Obey all local traffic laws.",

  acknowledgement:
    "I have read and understood the terms and conditions of this agreement and agree to be bound by them.",
} as const;

/*
 * Sample terms and conditions for demonstration. Each operator
 * should replace these with terms reviewed for their own
 * jurisdiction; the figures quoted here come from
 * AGREEMENT_RATES above and must be kept in step with it.
 */
export const AGREEMENT_TERMS: readonly string[] = [
  "The vehicle is covered by third-party liability insurance and collision insurance subject to a $1,000.00 deductible. The renter is responsible for any damage to the vehicle, and any claim against the owner, not covered by that insurance.",

  "Only drivers named on this agreement may operate the vehicle. Allowing an unlisted driver to operate it may void the insurance cover, and the renter is then responsible for all resulting damage and claims.",

  "The renter is responsible for the insurance deductible and for any damage not covered by insurance, including damage caused by driving off paved roads, on beaches or trails, through flood water, or by misuse of the vehicle, and for any resulting towing or recovery charges.",

  "The renter confirms that every authorised driver holds a valid driving licence and is fit to drive.",

  "The renter is responsible for all loss, damage, injury or death arising from the renter's or any driver's operation of the vehicle or negligence, and agrees to indemnify the rental company against any resulting claim, suit or expense.",

  "The renter and any driver act on their own behalf and are not agents or employees of the rental company.",

  "The vehicle must be returned at the agreed date, time and place. A vehicle not returned as agreed may be reported as stolen, and additional days' rent will be charged.",

  "The renter must inspect the vehicle before departure and report any existing damage or defect, which will be recorded on this agreement.",

  "The vehicle must be returned with the same fuel level as at checkout. Otherwise a refuelling charge of $25 per ¼ tank applies.",

  "A cleaning fee of $150 may apply if the vehicle is returned excessively dirty, including sand, mud, pet hair or evidence of smoking.",

  "The rental company is not responsible for personal belongings left in the vehicle after its return.",

  "The renter is responsible for the cost of replacing lost keys and any charges for recovering keys locked inside the vehicle.",

  "Drivers under 25 years of age are subject to a young driver insurance charge of $15 per day.",

  "The renter is responsible for all traffic fines, parking charges and tolls incurred during the rental.",
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
