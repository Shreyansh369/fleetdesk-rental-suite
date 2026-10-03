import { z } from "zod";

export const MAX_MONEY_CENTS =
  10_000_000;

export const cents =
  z.number()
    .int()
    .nonnegative()
    .max(MAX_MONEY_CENTS);

export const isoDateTime =
  z.string().datetime({
    offset: true,
  });

export const id =
  z.string().regex(
    /^[A-Za-z0-9_-]{8,128}$/,
    "Invalid identifier",
  );

export const requestId =
  z.string().uuid();

export const fuelLevel =
  z.enum([
    "one_eighth",
    "quarter",
    "three_eighths",
    "half",
    "five_eighths",
    "three_quarters",
    "seven_eighths",
    "full",

    // Retained for backwards compatibility
    // with existing records.
    "empty",
  ]);

export const customerLicenseDocumentSchema =
  z.object({
    customerId:
      id,

    licenceStoragePath:
      z.string()
        .regex(
          /^customer-documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
          "Invalid licence storage path",
        ),
  })
  .strict();

export const customerSchema =
  z.object({
    customerId: id.optional(),

    fullName:
      z.string()
        .trim()
        .min(2)
        .max(160),

    telephone:
      z.string()
        .trim()
        .min(5)
        .max(40),

    email:
      z.string()
        .trim()
        .email()
        .max(254)
        .nullable(),

    address:
      z.string()
        .trim()
        .min(5)
        .max(500)
        .nullable(),

    licenceNumber:
      z.string()
        .trim()
        .min(3)
        .max(80),

    licenceCountry:
      z.string()
        .trim()
        .length(2)
        .toUpperCase(),

    licenceExpiresAt:
      z.string()
        .date()
        .refine(
          (value) =>
            value >
            new Date()
              .toISOString()
              .slice(
                0,
                10,
              ),
          {
            message:
              "Licence expiry must be after today.",
          },
        ),

    dateOfBirth:
      z.string()
        .date()
        .nullable(),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable(),

    licenceStoragePath:
      z.string()
        .regex(
          /^customer-documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
        )
        .nullable(),
  })
  .strict();

export const reservationSchema =
  z.object({
    customerId:
      id,

    vehicleId:
      id,

    pickupAt:
      isoDateTime,

    expectedReturnAt:
      isoDateTime,

    /*
     * Optional pickup and drop-off locations.
     *
     * Nullable/defaulted so existing booking
     * records and callers remain compatible.
     */
    pickupLocation:
      z.string()
        .trim()
        .max(300)
        .nullable()
        .default(null),

    dropoffLocation:
      z.string()
        .trim()
        .max(300)
        .nullable()
        .default(null),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),
  })
  .strict();

export const reservationSignatureSchema =
  reservationSchema.extend({
    customerSignatureDataUrl:
      z.string()
        .regex(
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/,
          "Invalid customer signature image",
        )
        .max(600_000),
  })
  .strict();

export const sendReservationContractSchema =
  z.object({
    reservationId:
      id,
  })
  .strict();

export const checkoutSchema =
  z.object({
    reservationId:
      id,

    pickupFuelLevel:
      fuelLevel,

    pickupOdometer:
      z.object({
        value:
          z.number()
            .int()
            .nonnegative()
            .max(10_000_000),

        unit:
          z.enum([
            "km",
            "mi",
          ]),
      })
      .strict(),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),
  })
  .strict();

export const adjustmentSchema =
  z.object({
    type:
      z.enum([
        "discount",
        "late_fee",
        "fuel",
        "cleaning",
        "damage",
        "car_seat",
        "pickup_dropoff",
        "insurance",
        "other",
      ]),

    amountCents:
      cents,

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),
  })
  .strict();

export const returnSchema =
  z.object({
    rentalId:
      id,

    actualReturnAt:
      isoDateTime,

    returnFuelLevel:
      fuelLevel,

    returnOdometer:
      z.object({
        value:
          z.number()
            .int()
            .nonnegative()
            .max(10_000_000),

        unit:
          z.enum([
            "km",
            "mi",
          ]),
      })
      .strict(),

    adjustments:
      z.array(
        adjustmentSchema,
      )
      .max(30)
      .default([]),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    returnMedia:
      z.array(
        z.record(
          z.string(),
          z.unknown(),
        ),
      )
      .max(20)
      .default([]),
  })
  .strict();

export const extensionSchema =
  z.object({
    rentalId:
      id,

    expectedReturnAt:
      isoDateTime,

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),

    idempotencyKey:
      requestId,
  })
  .strict();

export const paymentFeeSchema =
  z.object({
    type:
      z.enum([
        "car_seat",
        "insurance",
        "cleaning",
        "smoke_fee",
        "refueling",
      ]),

    amountCents:
      cents.refine(
        (value) =>
          value > 0,
        "Fee amount must be positive",
      ),
  })
  .strict();

export const paymentSchema =
  z.object({
    rentalId:
      id,

    amountCents:
      cents.refine(
        (value) =>
          value > 0,
        "Amount must be positive",
      ),

    kind:
      z.enum([
        "payment",
        "deposit",
      ])
      .default("payment"),

    method:
      z.enum([
        "cash",
        "card",
        "bank_transfer",
        "other",
      ]),

    externalReference:
      z.string()
        .trim()
        .max(200)
        .nullable()
        .default(null),

    additionalFees:
      z.array(
        paymentFeeSchema,
      )
      .max(5)
      .default([])
      .superRefine(
        (fees, ctx) => {
          const types =
            new Set(
              fees.map(
                (fee) =>
                  fee.type,
              ),
            );

          if (
            types.size !==
            fees.length
          ) {
            ctx.addIssue({
              code:
                z.ZodIssueCode.custom,

              message:
                "Each additional fee can only be selected once.",
            });
          }
        },
      ),

    idempotencyKey:
      requestId,
  })
  .strict();

export const refundSchema =
  z.object({
    rentalId:
      id,

    amountCents:
      cents.refine(
        (value) =>
          value > 0,
        "Amount must be positive",
      ),

    source:
      z.enum([
        "payment",
        "deposit",
      ])
      .default("payment"),

    reason:
      z.string()
        .trim()
        .min(3)
        .max(500),

    idempotencyKey:
      requestId,
  })
  .strict();

export const rateSchema =
  z.object({
    vehicleId:
      id,

    dailyCents:
      cents.nullable(),

    weeklyCents:
      cents.nullable(),

    monthlyCents:
      cents.nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.dailyCents !== null ||
      data.weeklyCents !== null ||
      data.monthlyCents !== null,

    "At least one rate is required",
  );

export const vehicleStatusSchema =
  z.object({
    vehicleId:
      id,

    status:
      z.enum([
        "available",
        "reserved",
        "rented",
        "overdue",
        "cleaning",
        "maintenance",
        "out_of_service",
      ]),

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),
  })
  .strict();

export const vehicleUpdateSchema =
  z.object({
    vehicleId:
      id,

    registrationNumber:
      z.string()
        .trim()
        .min(1)
        .max(40),

    make:
      z.string()
        .trim()
        .min(1)
        .max(80),

    model:
      z.string()
        .trim()
        .min(1)
        .max(120),

    year:
      z.number()
        .int()
        .min(1886)
        .max(
          new Date().getUTCFullYear() +
            1,
        )
        .nullable(),

    color:
      z.string()
        .trim()
        .max(60)
        .nullable(),

    vin:
      z.string()
        .trim()
        .length(17)
        .toUpperCase()
        .nullable(),

    registrationExpiresAt:
      z.string()
        .date()
        .nullable(),

    insuranceExpiresAt:
      z.string()
        .date()
        .nullable(),

    lastServiceAt:
      z.string()
        .date()
        .nullable(),

    nextServiceDueAt:
      z.string()
        .date()
        .nullable(),

    dailyCents:
      cents.nullable(),

    weeklyCents:
      cents.nullable(),

    monthlyCents:
      cents.nullable(),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.dailyCents !== null ||
      data.weeklyCents !== null ||
      data.monthlyCents !== null,

    "At least one rate is required",
  );

export const serviceSchema =
  z.object({
    vehicleId:
      id,

    completedAt:
      isoDateTime,

    nextServiceDueAt:
      isoDateTime.nullable(),

    description:
      z.string()
        .trim()
        .min(3)
        .max(1_000),

    odometerKm:
      z.number()
        .int()
        .nonnegative()
        .max(10_000_000)
        .nullable()
        .default(null),
  })
  .strict();

export const expenseSchema =
  z.object({
    vehicleId:
      id,

    category:
      z.enum([
        "repair",
        "service",
        "maintenance",
        "parts",
        "other",
      ]),

    amountCents:
      cents.refine(
        (value) =>
          value > 0,
      ),

    occurredAt:
      isoDateTime,

    vendor:
      z.string()
        .trim()
        .min(2)
        .max(160)
        .nullable()
        .default(null),

    note:
      z.string()
        .trim()
        .min(1)
        .max(1_000),

    idempotencyKey:
      requestId,
  })
  .strict();

export const inspectionSchema =
  z.object({
    rentalId:
      id,

    stage:
      z.enum([
        "pickup",
        "return",
      ]),

    conditionNotes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    damageNotes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    photoPaths:
      z.array(
        z.string()
          .min(1)
          .max(500),
      )
      .max(20)
      .default([]),
  })
  .strict();

export const financialOverviewSchema =
  z.object({
    from:
      z.string()
        .date(),

    to:
      z.string()
        .date(),
  })
  .strict();

export const staffRegistrationSchema =
  z.object({
    fullName:
      z.string()
        .trim()
        .min(2)
        .max(160),

    mobile:
      z.string()
        .trim()
        .min(5)
        .max(40),

    age:
      z.number()
        .int()
        .min(18)
        .max(100),

    requestedRole:
      z.enum([
        "admin",
        "operations",
      ]),
  })
  .strict();