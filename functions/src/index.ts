import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  HttpsError,
  onCall,
} from "firebase-functions/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/scheduler";
import { onObjectFinalized } from "firebase-functions/storage";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";

import { db } from "./services/firebase";
import { audit } from "./services/audit";

import {
  addExpense,
  createVehicle,
  changeRates,
  checkoutRental,
  createReservation as createReservationRecord,
  extendRental as extendRentalRecord,
  recordInspection,
  recordPayment,
  recordService,
  returnRental as returnRentalRecord,
  updateVehicleDetails as updateVehicleDetailsRecord,
  updateVehicleStatus,
} from "./services/rentals";

import {
  customerSchema,
  customerLicenseDocumentSchema,
  reservationSignatureSchema,
  sendReservationContractSchema,
  expenseSchema,
  extensionSchema,
  financialOverviewSchema,
  inspectionSchema,
  paymentSchema,
  rateSchema,
  refundSchema,
  returnSchema,
  checkoutSchema,
  serviceSchema,
  vehicleStatusSchema,
  staffRegistrationSchema,
} from "./services/schemas";

import { financialOverview } from "./services/reporting";
import { sendReservationContractEmail } from "./services/contracts";
import {
  requireAdmin,
  requireRole,
  safeError,
} from "./services/security";

/**
 * App Check:
 * - Local Firebase Functions emulator: disabled
 * - Production: enabled
 *
 * The Firebase Functions emulator sets FUNCTIONS_EMULATOR=true.
 */
const enforceAppCheck =
  process.env.FUNCTIONS_EMULATOR !== "true";

const resendApiKey = defineSecret("RESEND_API_KEY");

/**
 * Existing reservation schema + vehicle evidence.
 *
 * The frontend can upload the vehicle evidence to
 * Cloudinary first and then send only the returned
 * metadata to this callable.
 */
const reservationWorkflowSchema =
  reservationSignatureSchema.extend({
    bookingMedia: z
      .array(
        z.record(
          z.string(),
          z.unknown(),
        ),
      )
      .max(20)
      .default([]),
  });

/**
 * Existing return schema + return vehicle evidence.
 */
const returnWorkflowSchema =
  returnSchema.extend({
    returnMedia: z
      .array(
        z.record(
          z.string(),
          z.unknown(),
        ),
      )
      .max(20)
      .default([]),
  });

/**
 * Vehicle editing schema.
 *
 * This is intentionally kept here so index.ts does not
 * depend on a missing vehicleUpdateSchema export from
 * schemas.ts.
 */
const vehicleUpdateSchema =
  z.object({
    vehicleId: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{8,128}$/,
        "Invalid vehicle identifier",
      ),

    registrationNumber: z
      .string()
      .trim()
      .min(1)
      .max(40),

    make: z
      .string()
      .trim()
      .min(1)
      .max(80),

    model: z
      .string()
      .trim()
      .min(1)
      .max(120),

    year: z
      .number()
      .int()
      .min(1886)
      .max(
        new Date().getUTCFullYear() + 1,
      )
      .nullable(),

    color: z
      .string()
      .trim()
      .max(60)
      .nullable(),

    vin: z
      .string()
      .trim()
      .length(17)
      .toUpperCase()
      .nullable(),

    registrationExpiresAt: z
      .string()
      .date()
      .nullable(),

    insuranceExpiresAt: z
      .string()
      .date()
      .nullable(),

    lastServiceAt: z
      .string()
      .date()
      .nullable(),

    nextServiceDueAt: z
      .string()
      .date()
      .nullable(),

    dailyCents: z
      .number()
      .int()
      .nonnegative()
      .max(10_000_000)
      .nullable(),

    weeklyCents: z
      .number()
      .int()
      .nonnegative()
      .max(10_000_000)
      .nullable(),

    monthlyCents: z
      .number()
      .int()
      .nonnegative()
      .max(10_000_000)
      .nullable(),

    notes: z
      .string()
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

const createVehicleSchema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .min(1)
    .max(40),

  make: z
    .string()
    .trim()
    .min(1)
    .max(80),

  model: z
    .string()
    .trim()
    .min(1)
    .max(120),

  year: z
    .number()
    .int()
    .min(1886)
    .max(
      new Date().getUTCFullYear() + 1,
    )
    .nullable(),

  color: z
    .string()
    .trim()
    .max(60)
    .nullable(),

  vin: z
    .string()
    .trim()
    .length(17)
    .toUpperCase()
    .nullable(),

  registrationExpiresAt: z
    .string()
    .date()
    .nullable(),

  insuranceExpiresAt: z
    .string()
    .date()
    .nullable(),

  lastServiceAt: z
    .string()
    .date()
    .nullable(),

  nextServiceDueAt: z
    .string()
    .date()
    .nullable(),

  dailyCents: z
    .number()
    .int()
    .nonnegative()
    .max(10_000_000)
    .nullable(),

  weeklyCents: z
    .number()
    .int()
    .nonnegative()
    .max(10_000_000)
    .nullable(),

  monthlyCents: z
    .number()
    .int()
    .nonnegative()
    .max(10_000_000)
    .nullable(),

  notes: z
    .string()
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

const callable = <T extends z.ZodType>(
  schema: T,
  roles: Array<
    "admin" | "operations"
  >,
  handler: (
    actor: {
      uid: string;
      role:
        | "admin"
        | "operations";
    },
    input: z.infer<T>,
  ) => Promise<unknown>,
) =>
  onCall(
    {
      enforceAppCheck,
      region: "us-central1",
    },
    async (request) => {
      try {
        const actor = await requireRole(
          request,
          ...roles,
        );

        const parsed =
          schema.safeParse(
            request.data,
          );

        if (!parsed.success) {
          throw new HttpsError(
            "invalid-argument",
            "Invalid request data.",
            parsed.error.flatten(),
          );
        }

        return await handler(
          actor,
          parsed.data,
        );
      } catch (error) {
        return safeError(error);
      }
    },
  );

/* =========================================================
   CUSTOMER
   ========================================================= */

export const createOrUpdateCustomer =
  callable(
    customerSchema,
    ["admin", "operations"],
    async (actor, input) => {
      const customerRef =
        input.customerId
          ? db
              .collection("customers")
              .doc(input.customerId)
          : db
              .collection("customers")
              .doc();

      const payload = {
        fullName: input.fullName,
        telephone: input.telephone,
        email: input.email,
        address: input.address,
        licenceNumber:
          input.licenceNumber,
        licenceCountry:
          input.licenceCountry,
        licenceExpiresAt:
          input.licenceExpiresAt,
        dateOfBirth:
          input.dateOfBirth,
        notes: input.notes,
        licenceStoragePath:
          input.licenceStoragePath,
        updatedAt:
          FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      };

      await db.runTransaction(
        async (transaction) => {
          const current =
            await transaction.get(
              customerRef,
            );

          if (current.exists) {
            transaction.update(
              customerRef,
              payload,
            );
          } else {
            transaction.create(
              customerRef,
              {
                ...payload,
                createdAt:
                  FieldValue.serverTimestamp(),
                createdBy: actor.uid,
              },
            );
          }

          audit(
            transaction,
            actor.uid,
            current.exists
              ? "customer.updated"
              : "customer.created",
            {
              collection:
                "customers",
              id: customerRef.id,
            },
            {
              fields:
                Object.keys(
                  payload,
                ).filter(
                  (key) =>
                    ![
                      "licenceNumber",
                      "address",
                    ].includes(
                      key,
                    ),
                ),
            },
          );
        },
      );

      return {
        customerId:
          customerRef.id,
      };
    },
  );

/* =========================================================
   CUSTOMER LICENCE DOCUMENT
   ========================================================= */

export const updateCustomerLicenceDocument =
  callable(
    customerLicenseDocumentSchema,
    ["admin", "operations"],
    async (actor, input) => {
      const customerRef =
        db
          .collection("customers")
          .doc(input.customerId);

      await db.runTransaction(
        async (transaction) => {
          const customer =
            await transaction.get(
              customerRef,
            );

          if (!customer.exists) {
            throw new HttpsError(
              "not-found",
              "Customer could not be found.",
            );
          }

          transaction.update(
            customerRef,
            {
              licenceStoragePath:
                input.licenceStoragePath,
              updatedAt:
                FieldValue.serverTimestamp(),
              updatedBy: actor.uid,
            },
          );

          audit(
            transaction,
            actor.uid,
            "customer.licence.document.updated",
            {
              collection: "customers",
              id: input.customerId,
            },
            {
              fields: [
                "licenceStoragePath",
              ],
            },
          );
        },
      );

      return {
        customerId:
          input.customerId,
        licenceStoragePath:
          input.licenceStoragePath,
      };
    },
  );

/* =========================================================
   RESERVATIONS
   ========================================================= */

export const createReservation =
  callable(
    reservationWorkflowSchema,
    ["admin", "operations"],
    async (actor, input) =>
      createReservationWorkflow(
        actor.uid,
        input,
      ),
  );

async function createReservationWorkflow(
  actorUid: string,
  input: z.infer<
    typeof reservationWorkflowSchema
  >,
) {
  return createReservationRecord(
    actorUid,
    input,
  );
}

export const sendReservationContract =
  onCall(
    {
      enforceAppCheck,
      region: "us-central1",
      secrets: [resendApiKey],
    },
    async (request) => {
      try {
        const actor = await requireRole(
          request,
          "admin",
          "operations",
        );

        const parsed = sendReservationContractSchema.safeParse(request.data);
        if (!parsed.success) {
          throw new HttpsError(
            "invalid-argument",
            "Invalid request data.",
            parsed.error.flatten(),
          );
        }

        const key = resendApiKey.value();
        if (!key) {
          throw new HttpsError(
            "failed-precondition",
            "Contract email is not configured on the server.",
          );
        }

        const fromEmail =
          process.env.CONTRACT_EMAIL_FROM?.trim();

        if (!fromEmail) {
          throw new HttpsError(
            "failed-precondition",
            "Contract sender email is not configured on the server.",
          );
        }

        return await sendReservationContractEmail({
          reservationId: parsed.data.reservationId,
          actorUid: actor.uid,
          resendApiKey: key,
          fromEmail,
          signatureDataUrl: null,
        });
      } catch (error) {
        return safeError(error);
      }
    },
  );

/* =========================================================
   CHECKOUT
   ========================================================= */

export const checkoutReservation =
  callable(
    checkoutSchema,
    ["admin", "operations"],
    async (actor, input) =>
      checkoutRental(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   RETURN
   ========================================================= */

export const returnRental =
  callable(
    returnWorkflowSchema,
    ["admin", "operations"],
    async (actor, input) =>
      returnRentalWorkflow(
        actor.uid,
        input,
      ),
  );

async function returnRentalWorkflow(
  actorUid: string,
  input: z.infer<
    typeof returnWorkflowSchema
  >,
) {
  return returnRentalRecord(
    actorUid,
    input,
  );
}

/* =========================================================
   EXTENSION
   ========================================================= */

export const extendRental =
  callable(
    extensionSchema,
    ["admin", "operations"],
    async (actor, input) =>
      extendRentalWorkflow(
        actor.uid,
        input,
      ),
  );

async function extendRentalWorkflow(
  actorUid: string,
  input: z.infer<
    typeof extensionSchema
  >,
) {
  return extendRentalRecord(
    actorUid,
    input,
  );
}

/* =========================================================
   PAYMENTS
   ========================================================= */

export const recordRentalPayment =
  callable(
    paymentSchema,
    ["admin", "operations"],
    async (actor, input) =>
      recordPayment(
        actor.uid,
        input,
      ),
  );

export const issueRefund =
  callable(
    refundSchema,
    ["admin"],
    async (actor, input) =>
      recordPayment(
        actor.uid,
        {
          rentalId:
            input.rentalId,

          amountCents:
            input.amountCents,

          kind: input.source,

          method: "other",

          externalReference:
            null,

          idempotencyKey:
            input.idempotencyKey,
        },
        true,
        input.reason,
      ),
  );

/* =========================================================
   VEHICLE CREATION
   ========================================================= */

export const createVehicleRecord =
  callable(
    createVehicleSchema,
    ["admin", "operations"],
    async (actor, input) =>
      createVehicle(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE RATES
   ========================================================= */

export const updateVehicleRates =
  callable(
    rateSchema,
    ["admin"],
    async (actor, input) =>
      changeRates(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE EXPENSES
   ========================================================= */

export const recordVehicleExpense =
  callable(
    expenseSchema,
    ["admin", "operations"],
    async (actor, input) =>
      addExpense(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE INSPECTION
   ========================================================= */

export const recordRentalInspection =
  callable(
    inspectionSchema,
    ["admin", "operations"],
    async (actor, input) =>
      recordInspection(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE STATUS
   ========================================================= */

export const changeVehicleStatus =
  callable(
    vehicleStatusSchema,
    ["admin", "operations"],
    async (actor, input) =>
      updateVehicleStatus(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE DETAILS / EDIT
   ========================================================= */

export const updateVehicleDetails =
  callable(
    vehicleUpdateSchema,
    ["admin", "operations"],
    async (actor, input) =>
      updateVehicleDetailsRecord(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   VEHICLE SERVICE
   ========================================================= */

export const recordVehicleService =
  callable(
    serviceSchema,
    ["admin", "operations"],
    async (actor, input) =>
      recordService(
        actor.uid,
        input,
      ),
  );

/* =========================================================
   FINANCIAL REPORTING
   ========================================================= */

export const getFinancialOverview =
  callable(
    financialOverviewSchema,
    ["admin"],
    async (_actor, input) =>
      financialOverview(input),
  );

/* =========================================================
   USER ROLES
   ========================================================= */

const roleSchema = z.object({
  uid: z
    .string()
    .min(8)
    .max(128),

  role: z.enum([
    "admin",
    "operations",
  ]),
});

export const setUserRole =
  onCall(
    {
      enforceAppCheck,
      region: "us-central1",
    },
    async (request) => {
      try {
        const actor =
          await requireAdmin(request);

        const input =
          roleSchema.parse(
            request.data,
          );

        await getAuth().setCustomUserClaims(
          input.uid,
          {
            role: input.role,
          },
        );

        await db
          .collection("users")
          .doc(input.uid)
          .set(
            {
              role: input.role,

              updatedAt:
                FieldValue.serverTimestamp(),

              updatedBy:
                actor.uid,
            },
            {
              merge: true,
            },
          );

        await db.runTransaction(
          async (transaction) =>
            audit(
              transaction,
              actor.uid,
              "user.role_changed",
              {
                collection:
                  "users",
                id: input.uid,
              },
              {
                role: input.role,
              },
            ),
        );

        return {
          uid: input.uid,
          role: input.role,
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

/* =========================================================
   OPERATIONAL DASHBOARD
   ========================================================= */

export const getOperationalDashboard =
  onCall(
    {
      enforceAppCheck,
      region: "us-central1",
    },
    async (request) => {
      try {
        await requireRole(
          request,
          "admin",
          "operations",
        );

        const now =
          Timestamp.now();

        const today =
          new Date();

        today.setHours(
          0,
          0,
          0,
          0,
        );

        const tomorrow =
          new Date(today);

        tomorrow.setDate(
          tomorrow.getDate() + 1,
        );

        const inSevenDays =
          new Date(today);

        inSevenDays.setDate(
          inSevenDays.getDate() + 7,
        );

        const inThirtyDays =
          new Date(today);

        inThirtyDays.setDate(
          inThirtyDays.getDate() +
            30,
        );

        const [
          totalFleet,
          available,
          reserved,
          todayPickups,
          todayReturns,
          overdue,
          maintenanceDue,
          insurance,
          registration,
          upcoming,
          activeRentals,
        ] = await Promise.all([
          db
            .collection("vehicles")
            .count()
            .get(),

          db
            .collection("vehicles")
            .where(
              "status",
              "==",
              "available",
            )
            .count()
            .get(),

          db
            .collection("vehicles")
            .where(
              "status",
              "==",
              "reserved",
            )
            .count()
            .get(),

          db
            .collection(
              "reservations",
            )
            .where(
              "status",
              "==",
              "confirmed",
            )
            .where(
              "pickupAt",
              ">=",
              Timestamp.fromDate(
                today,
              ),
            )
            .where(
              "pickupAt",
              "<",
              Timestamp.fromDate(
                tomorrow,
              ),
            )
            .count()
            .get(),

          db
            .collection("rentals")
            .where(
              "status",
              "==",
              "active",
            )
            .where(
              "expectedReturnAt",
              ">=",
              Timestamp.fromDate(
                today,
              ),
            )
            .where(
              "expectedReturnAt",
              "<",
              Timestamp.fromDate(
                tomorrow,
              ),
            )
            .count()
            .get(),

          db
            .collection("rentals")
            .where(
              "status",
              "in",
              [
                "active",
                "overdue",
              ],
            )
            .where(
              "expectedReturnAt",
              "<",
              now,
            )
            .count()
            .get(),

          db
            .collection("vehicles")
            .where(
              "nextServiceDueAt",
              "<=",
              inThirtyDays.toISOString(),
            )
            .count()
            .get(),

          db
            .collection("vehicles")
            .where(
              "insuranceExpiresAt",
              "<=",
              inThirtyDays.toISOString(),
            )
            .limit(500)
            .get(),

          db
            .collection("vehicles")
            .where(
              "registrationExpiresAt",
              "<=",
              inThirtyDays.toISOString(),
            )
            .limit(500)
            .get(),

          db
            .collection(
              "reservations",
            )
            .where(
              "status",
              "==",
              "confirmed",
            )
            .where(
              "pickupAt",
              ">=",
              now,
            )
            .where(
              "pickupAt",
              "<",
              Timestamp.fromDate(
                inSevenDays,
              ),
            )
            .orderBy(
              "pickupAt",
            )
            .limit(10)
            .get(),

          db
            .collection("rentals")
            .where(
              "status",
              "in",
              ["active", "overdue"],
            )
            .orderBy(
              "expectedReturnAt",
            )
            .limit(20)
            .get(),
        ]);

        const expiringIds =
          new Set([
            ...insurance.docs,
            ...registration.docs,
          ].map(
            (item) => item.id,
          ));

        return {
          totalFleet:
            totalFleet
              .data()
              .count,

          available:
            available
              .data()
              .count,

          reserved:
            reserved
              .data()
              .count,

          todayPickups:
            todayPickups
              .data()
              .count,

          todayReturns:
            todayReturns
              .data()
              .count,

          overdue:
            overdue
              .data()
              .count,

          maintenanceDue:
            maintenanceDue
              .data()
              .count,

          expiringDocuments:
            expiringIds.size,

          upcomingReservations:
            upcoming.docs.map(
              (item) => ({
                id: item.id,

                pickupAt:
                  item
                    .get(
                      "pickupAt",
                    )
                    .toDate()
                    .toISOString(),

                customerName:
                  item.get(
                    "customerNameSnapshot",
                  ),

                vehicleRegistration:
                  item.get(
                    "vehicleRegistrationSnapshot",
                  ),
              }),
            ),

          activeRentals:
            activeRentals.docs.map(
              (item) => ({
                id: item.id,
                customerName:
                  item.get(
                    "customerNameSnapshot",
                  ) ??
                  "Unknown customer",
                vehicleRegistration:
                  item.get(
                    "vehicleRegistrationSnapshot",
                  ) ??
                  "Unknown vehicle",
                expectedReturnAt:
                  item
                    .get(
                      "expectedReturnAt",
                    )
                    .toDate()
                    .toISOString(),
                checkedOutBy:
                  item.get(
                    "checkedOutByNameSnapshot",
                  ) ??
                  "—",
                status:
                  item.get("status") ===
                  "overdue"
                    ? "overdue"
                    : "active",
              }),
            ),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

/* =========================================================
   OVERDUE RENTALS SCHEDULER
   ========================================================= */

export const markOverdueRentals =
  onSchedule(
    {
      schedule:
        "every 60 minutes",

      region:
        "us-central1",

      timeZone:
        "America/Port_of_Spain",
    },

    async () => {
      const overdue =
        await db
          .collection("rentals")
          .where(
            "status",
            "==",
            "active",
          )
          .where(
            "expectedReturnAt",
            "<",
            Timestamp.now(),
          )
          .limit(400)
          .get();

      if (overdue.empty) {
        return;
      }

      const batch =
        db.batch();

      overdue.docs.forEach(
        (rental) => {
          batch.update(
            rental.ref,
            {
              status: "overdue",

              updatedAt:
                FieldValue.serverTimestamp(),
            },
          );

          batch.update(
            db
              .collection(
                "vehicles",
              )
              .doc(
                rental.get(
                  "vehicleId",
                ),
              ),
            {
              status: "overdue",

              updatedAt:
                FieldValue.serverTimestamp(),
            },
          );
        },
      );

      await batch.commit();

      logger.info(
        "Marked rentals overdue",
        {
          count: overdue.size,
        },
      );
    },
  );

/* =========================================================
   STORAGE VALIDATION
   ========================================================= */

function hasAllowedUploadPath(
  name: string,
): boolean {
  return /^(customer-documents|vehicle-photos|inspection-photos|rental-documents)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
    name,
  );
}

function hasExpectedFileSignature(
  bytes: Buffer,
  contentType: string,
): boolean {
  if (
    contentType ===
    "application/pdf"
  ) {
    return (
      bytes
        .subarray(0, 5)
        .toString("ascii") ===
      "%PDF-"
    );
  }

  if (
    contentType ===
    "image/jpeg"
  ) {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (
    contentType ===
    "image/png"
  ) {
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
          ]),
        )
    );
  }

  if (
    contentType ===
    "image/webp"
  ) {
    return (
      bytes.length >= 12 &&
      bytes
        .subarray(0, 4)
        .toString("ascii") ===
        "RIFF" &&
      bytes
        .subarray(8, 12)
        .toString("ascii") ===
        "WEBP"
    );
  }

  return false;
}

/**
 * Secondary validation for direct Storage uploads;
 * removes spoofed MIME types and unexpected paths.
 */
export const validateUploadedEvidence =
  onObjectFinalized(
    {
      region: "us-central1",
    },
    async (event) => {
      const object =
        event.data;

      if (
        !object.name ||
        !object.bucket ||
        !object.contentType
      ) {
        return;
      }

      const size = Number(
        object.size ?? 0,
      );

      const allowed =
        hasAllowedUploadPath(
          object.name,
        ) &&
        size > 0 &&
        size <=
          10 * 1024 * 1024;

      const bucket =
        getStorage().bucket(
          object.bucket,
        );

      const file =
        bucket.file(
          object.name,
        );

      if (!allowed) {
        await file.delete({
          ignoreNotFound: true,
        });

        logger.warn(
          "Removed unexpected upload",
          {
            name: object.name,
          },
        );

        return;
      }

      const [bytes] =
        await file.download();

      if (
        !hasExpectedFileSignature(
          bytes,
          object.contentType,
        )
      ) {
        await file.delete({
          ignoreNotFound: true,
        });

        logger.warn(
          "Removed upload with invalid signature",
          {
            name: object.name,

            contentType:
              object.contentType,
          },
        );
      }
    },
  );

export const registerStaffProfile =
  onCall(
    {
      enforceAppCheck: true,
      region: "us-central1",
    },
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError(
            "unauthenticated",
            "Sign-in is required.",
          );
        }

        const parsed =
          staffRegistrationSchema.safeParse(
            request.data,
          );

        if (!parsed.success) {
          throw new HttpsError(
            "invalid-argument",
            "Invalid staff registration data.",
            parsed.error.flatten(),
          );
        }

        const uid =
          request.auth.uid;

        const email =
          request.auth.token.email ??
          null;

        await db
          .collection("users")
          .doc(uid)
          .set(
            {
              fullName:
                parsed.data.fullName,

              mobile:
                parsed.data.mobile,

              age:
                parsed.data.age,

              email,

              requestedRole:
                parsed.data.requestedRole,

              role: null,

              status: "pending",

              emailVerified: false,

              createdAt:
                FieldValue.serverTimestamp(),

              updatedAt:
                FieldValue.serverTimestamp(),
            },
            {
              merge: true,
            },
          );

        return {
          uid,
          status: "pending",
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );