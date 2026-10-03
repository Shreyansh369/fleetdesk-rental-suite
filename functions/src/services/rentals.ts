import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import {
  calculateBalance,
  quoteRental,
} from "../../../packages/domain/src/pricing";
import type { VehicleDocument } from "../../../packages/domain/src/types";
import { isValidVehicleTransition } from "../../../packages/domain/src/lifecycle";
import { audit } from "./audit";
import { db } from "./firebase";
import { getStorage } from "firebase-admin/storage";
import { MAX_MONEY_CENTS } from "./schemas";

function asIso(value: string): string {
  return new Date(value).toISOString();
}

function asTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

function odometerToKm(value: number, unit: "km" | "mi"): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new HttpsError(
      "invalid-argument",
      "Odometer reading must be a non-negative number.",
    );
  }

  const km = unit === "mi" ? value * 1.609344 : value;

  if (!Number.isFinite(km) || km > 10_000_000) {
    throw new HttpsError(
      "invalid-argument",
      "Odometer reading is outside the permitted range.",
    );
  }

  return km;
}

function finiteTotal(
  adjustments: Array<{
    amountCents: number;
    type: string;
  }>,
): {
  credits: number;
  charges: number;
} {
  return adjustments.reduce(
    (total, adjustment) =>
      adjustment.type === "discount"
        ? {
            ...total,
            credits:
              total.credits +
              adjustment.amountCents,
          }
        : {
            ...total,
            charges:
              total.charges +
              adjustment.amountCents,
          },
    {
      credits: 0,
      charges: 0,
    },
  );
}


export async function createVehicle(
  actorUid: string,
  input: {
    registrationNumber: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
    registrationExpiresAt: string | null;
    insuranceExpiresAt: string | null;
    lastServiceAt: string | null;
    nextServiceDueAt: string | null;
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
    notes: string | null;
  },
) {
  const vehicleRef =
    db.collection("vehicles").doc();

  const registrationNumber =
    input.registrationNumber
      .trim()
      .toUpperCase();

  const vin =
    input.vin
      ?.trim()
      .toUpperCase() ||
    null;

  if (!registrationNumber) {
    throw new HttpsError(
      "invalid-argument",
      "Registration number is required.",
    );
  }

  if (!input.make.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "Vehicle make is required.",
    );
  }

  if (!input.model.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "Vehicle model is required.",
    );
  }

  if (
    input.dailyCents === null &&
    input.weeklyCents === null &&
    input.monthlyCents === null
  ) {
    throw new HttpsError(
      "invalid-argument",
      "At least one vehicle rate is required.",
    );
  }

  if (
    vin !== null &&
    vin.length !== 17
  ) {
    throw new HttpsError(
      "invalid-argument",
      "VIN must contain exactly 17 characters.",
    );
  }

  const rates = {
    currency: "USD" as const,
    dailyCents:
      input.dailyCents,
    weeklyCents:
      input.weeklyCents,
    monthlyCents:
      input.monthlyCents,
  };

  return db.runTransaction(
    async (transaction) => {
      const duplicateRegistrationSnapshot =
        await transaction.get(
          db
            .collection("vehicles")
            .where(
              "registrationNumber",
              "==",
              registrationNumber,
            )
            .limit(1),
        );

      if (
        !duplicateRegistrationSnapshot.empty
      ) {
        throw new HttpsError(
          "already-exists",
          `Registration number ${registrationNumber} is already assigned to another vehicle.`,
        );
      }

      if (vin !== null) {
        const duplicateVinSnapshot =
          await transaction.get(
            db
              .collection("vehicles")
              .where(
                "vin",
                "==",
                vin,
              )
              .limit(1),
          );

        if (
          !duplicateVinSnapshot.empty
        ) {
          throw new HttpsError(
            "already-exists",
            `VIN ${vin} is already assigned to another vehicle.`,
          );
        }
      }

      const payload = {
        registrationNumber,

        make:
          input.make
            .trim()
            .toUpperCase(),

        model:
          input.model.trim(),

        year:
          input.year,

        color:
          input.color?.trim() ||
          null,

        vin,

        registrationExpiresAt:
          input.registrationExpiresAt,

        insuranceExpiresAt:
          input.insuranceExpiresAt,

        lastServiceAt:
          input.lastServiceAt,

        nextServiceDueAt:
          input.nextServiceDueAt,

        rates,

        notes:
          input.notes?.trim() ||
          null,

        status:
          "available" as const,

        createdBy:
          actorUid,

        createdAt:
          FieldValue.serverTimestamp(),

        updatedAt:
          FieldValue.serverTimestamp(),
      };

      transaction.create(
        vehicleRef,
        payload,
      );

      audit(
        transaction,
        actorUid,
        "vehicle.created",
        {
          collection:
            "vehicles",
          id: vehicleRef.id,
        },
        {
          registrationNumber,
          vin,
        },
      );

      return {
        vehicleId:
          vehicleRef.id,

        registrationNumber,
      };
    },
  );
}

export async function createReservation(
  actorUid: string,
  input: {
    customerId: string;
    vehicleId: string;
    pickupAt: string;
    expectedReturnAt: string;
    pickupLocation: string | null;
    dropoffLocation: string | null;
    notes: string | null;
    bookingMedia: Array<Record<string, unknown>>;
    customerSignatureDataUrl: string;
  },
) {
  const pickupAt = asTimestamp(
    input.pickupAt,
  );

  const expectedReturnAt = asTimestamp(
    input.expectedReturnAt,
  );

  if (
    expectedReturnAt.toMillis() <=
    pickupAt.toMillis()
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Expected return must be after pickup.",
    );
  }

  const reservationRef = db
    .collection("reservations")
    .doc();

  const vehicleRef = db
    .collection("vehicles")
    .doc(input.vehicleId);

  const customerRef = db
    .collection("customers")
    .doc(input.customerId);

  return db.runTransaction(
    async (transaction) => {
      const actorRef = db.collection("users").doc(actorUid);
      const [
        vehicleSnapshot,
        customerSnapshot,
        actorSnapshot,
      ] = await transaction.getAll(
        vehicleRef,
        customerRef,
        actorRef,
      );

      if (!vehicleSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      if (!customerSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Customer was not found.",
        );
      }

      const vehicle =
        vehicleSnapshot.data() as VehicleDocument;

      if (
        !["available", "reserved"].includes(
          vehicle.status,
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Vehicle cannot be reserved in its current status.",
        );
      }

      const pickupMillis =
        pickupAt.toMillis();

      if (
        pickupMillis <
        Timestamp.now().toMillis()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Pickup time cannot be in the past.",
        );
      }

      if (
        !vehicle.insuranceExpiresAt ||
        Date.parse(
          vehicle.insuranceExpiresAt,
        ) < pickupMillis ||
        !vehicle.registrationExpiresAt ||
        Date.parse(
          vehicle.registrationExpiresAt,
        ) < pickupMillis
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Vehicle registration and insurance must be recorded and valid through pickup.",
        );
      }

      const licenceExpiresAt = Date.parse(
        customerSnapshot.get(
          "licenceExpiresAt",
        ),
      );

      if (
        !Number.isFinite(
          licenceExpiresAt,
        ) ||
        licenceExpiresAt < pickupMillis
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Customer licence is missing or expires before pickup.",
        );
      }

      const actorProfile = actorSnapshot.data() ?? {};
      const staffNameSnapshot =
        typeof actorProfile.fullName === "string" && actorProfile.fullName.trim()
          ? actorProfile.fullName.trim()
          : typeof actorProfile.email === "string" && actorProfile.email.trim()
            ? actorProfile.email.trim()
            : actorUid;

      const conflictQuery = db
        .collection("reservations")
        .where(
          "vehicleId",
          "==",
          input.vehicleId,
        )
        .where("status", "in", [
          "confirmed",
          "checked_out",
        ])
        .where(
          "pickupAt",
          "<",
          expectedReturnAt,
        );

      const conflicts =
        await transaction.get(
          conflictQuery,
        );

      const overlaps =
        conflicts.docs.some(
          (doc) =>
            (
              doc.get(
                "expectedReturnAt",
              ) as Timestamp
            ).toMillis() >
            pickupAt.toMillis(),
        );

      if (overlaps) {
        throw new HttpsError(
          "already-exists",
          "Vehicle has an overlapping reservation.",
        );
      }

      const quote = quoteRental(
        {
          pickupAt: input.pickupAt,
          expectedReturnAt:
            input.expectedReturnAt,
        },
        vehicle.rates,
      );

      const signatureDataUrl = input.customerSignatureDataUrl;
      const signatureMatch = signatureDataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!signatureMatch) {
        throw new HttpsError(
          "invalid-argument",
          "Customer signature must be a PNG image.",
        );
      }

      const signatureBytes = Buffer.from(signatureMatch[1], "base64");
      if (signatureBytes.length === 0 || signatureBytes.length > 600_000) {
        throw new HttpsError(
          "invalid-argument",
          "Customer signature is invalid or too large.",
        );
      }

      const signaturePath = `rental-documents/${reservationRef.id}/customer-signature-${reservationRef.id}.png`;
      await getStorage().bucket().file(signaturePath).save(signatureBytes, {
        resumable: false,
        metadata: {
          contentType: "image/png",
          cacheControl: "private, max-age=3600, no-store",
        },
      });

      transaction.create(
        reservationRef,
        {
          bookingMedia:
            input.bookingMedia,

          customerSignatureStoragePath: signaturePath,
          customerSignatureCapturedAt: FieldValue.serverTimestamp(),

          customerId:
            input.customerId,

          customerNameSnapshot:
            customerSnapshot.get(
              "fullName",
            ),

          vehicleId: input.vehicleId,

          vehicleRegistrationSnapshot:
            vehicle.registrationNumber,

          pickupAt,
          expectedReturnAt,

          pickupLocation: input.pickupLocation,
          dropoffLocation: input.dropoffLocation,

          status: "confirmed",

          rateSnapshot: {
            ...vehicle.rates,
            quotedAt:
              new Date().toISOString(),
            vehicleId: vehicleRef.id,
            vehicleRegistration:
              vehicle.registrationNumber,
          },

          quote,

          notes: input.notes,

          createdBy: actorUid,
          createdByNameSnapshot: staffNameSnapshot,

          createdAt:
            FieldValue.serverTimestamp(),

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(vehicleRef, {
        status: "reserved",
        updatedAt:
          FieldValue.serverTimestamp(),
      });

      audit(
        transaction,
        actorUid,
        "reservation.created",
        {
          collection: "reservations",
          id: reservationRef.id,
        },
        {
          vehicleId: vehicleRef.id,
          customerId: customerRef.id,
          pickupAt: input.pickupAt,
        },
      );

      return {
        reservationId:
          reservationRef.id,
        quote,
      };
    },
  );
}

export async function checkoutRental(
  actorUid: string,
  input: {
    reservationId: string;
    pickupFuelLevel: string;
    pickupOdometer: { value: number; unit: "km" | "mi" };
    notes: string | null;
  },
) {
  const reservationRef = db
    .collection("reservations")
    .doc(input.reservationId);

  const rentalRef = db
    .collection("rentals")
    .doc();

  return db.runTransaction(
    async (transaction) => {
      const reservationSnapshot =
        await transaction.get(
          reservationRef,
        );

      if (!reservationSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Reservation was not found.",
        );
      }

      if (
        reservationSnapshot.get(
          "status",
        ) !== "confirmed"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Reservation cannot be checked out.",
        );
      }

      const vehicleRef = db
        .collection("vehicles")
        .doc(
          reservationSnapshot.get(
            "vehicleId",
          ),
        );

      const actorRef = db.collection("users").doc(actorUid);
      const [vehicleSnapshot, actorSnapshot] =
        await transaction.getAll(
          vehicleRef,
          actorRef,
        );

      if (!vehicleSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      if (
        vehicleSnapshot.get(
          "status",
        ) !== "reserved"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Vehicle is no longer ready for checkout.",
        );
      }

      const reservation =
        reservationSnapshot.data()!;
      const pickupOdometerKm = odometerToKm(
        input.pickupOdometer.value,
        input.pickupOdometer.unit,
      );
      const actorProfile = actorSnapshot.data() ?? {};
      const checkedOutByNameSnapshot =
        typeof actorProfile.fullName === "string" && actorProfile.fullName.trim()
          ? actorProfile.fullName.trim()
          : typeof actorProfile.email === "string" && actorProfile.email.trim()
            ? actorProfile.email.trim()
            : actorUid;

      transaction.create(
        rentalRef,
        {
          ...reservation,

          reservationId:
            reservationRef.id,

          status: "active",

          pickupFuelLevel:
            input.pickupFuelLevel,

          pickupOdometerKm,
          pickupOdometerValue:
            input.pickupOdometer.value,
          pickupOdometerUnit:
            input.pickupOdometer.unit,

          checkoutNotes:
            input.notes,

          actualReturnAt: null,

          createdAt:
            FieldValue.serverTimestamp(),

          updatedAt:
            FieldValue.serverTimestamp(),

          checkedOutBy: actorUid,
          checkedOutByNameSnapshot,

        },
      );

      transaction.create(
        db
          .collection(
            "rentalFinancials",
          )
          .doc(rentalRef.id),
        {
          rentalId: rentalRef.id,

          vehicleId:
            reservation.vehicleId,

          vehicleRegistration:
            reservation.vehicleRegistrationSnapshot,

          customerId:
            reservation.customerId,

          rentalStatus: "active",

          pickupAt:
            reservation.pickupAt,

          baseRentalCents:
            reservation.quote
              .baseRentalCents,

          adjustmentCents: 0,

          totalCents:
            reservation.quote
              .baseRentalCents,

          paidCents: 0,

          refundedCents: 0,

          refundedPaymentCents: 0,

          depositHeldCents: 0,

          refundedDepositCents: 0,

          outstandingCents:
            reservation.quote
              .baseRentalCents,

          currency: "USD",

          createdAt:
            FieldValue.serverTimestamp(),

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.create(
        db
          .collection(
            "financialLedger",
          )
          .doc(),
        {
          rentalId: rentalRef.id,

          vehicleId:
            reservation.vehicleId,

          vehicleRegistration:
            reservation.vehicleRegistrationSnapshot,

          customerId:
            reservation.customerId,

          entryType:
            "rental_charge",

          amountCents:
            reservation.quote
              .baseRentalCents,

          occurredAt:
            FieldValue.serverTimestamp(),

          recordedBy: actorUid,
        },
      );

      transaction.update(
        reservationRef,
        {
          status: "checked_out",

          rentalId:
            rentalRef.id,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(
        vehicleRef,
        {
          status: "rented",

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "rental.checked_out",
        {
          collection: "rentals",
          id: rentalRef.id,
        },
        {
          reservationId:
            reservationRef.id,

          vehicleId:
            vehicleRef.id,
        },
      );

      return {
        rentalId: rentalRef.id,
      };
    },
  );
}

export async function returnRental(
  actorUid: string,
  input: {
    rentalId: string;
    actualReturnAt: string;
    returnFuelLevel: string;
    returnOdometer: { value: number; unit: "km" | "mi" };

    adjustments: Array<{
      amountCents: number;
      type: string;
      note: string;
    }>;

    notes: string | null;

    returnMedia: Array<
      Record<string, unknown>
    >;
  },
) {
  const rentalRef = db
    .collection("rentals")
    .doc(input.rentalId);

  const financialRef = db
    .collection("rentalFinancials")
    .doc(input.rentalId);

  return db.runTransaction(
    async (transaction) => {
      const [
        rentalSnapshot,
        financialSnapshot,
      ] = await transaction.getAll(
        rentalRef,
        financialRef,
      );

      if (
        !rentalSnapshot.exists ||
        !financialSnapshot.exists
      ) {
        throw new HttpsError(
          "not-found",
          "Active rental was not found.",
        );
      }

      if (
        !["active", "overdue"].includes(
          rentalSnapshot.get(
            "status",
          ),
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Rental has already been returned or closed.",
        );
      }

      if (
        asTimestamp(
          input.actualReturnAt,
        ).toMillis() <
        (
          rentalSnapshot.get(
            "pickupAt",
          ) as Timestamp
        ).toMillis()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Actual return cannot be before pickup.",
        );
      }

      const returnOdometerKm = odometerToKm(
        input.returnOdometer.value,
        input.returnOdometer.unit,
      );

      if (
        returnOdometerKm <
        Number(
          rentalSnapshot.get("pickupOdometerKm") ?? 0,
        )
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Return odometer cannot be lower than pickup odometer.",
        );
      }

      const totalAdjustments =
        finiteTotal(
          input.adjustments,
        );

      const financial =
        financialSnapshot.data()!;

      const adjustmentCents =
        financial.adjustmentCents +
        totalAdjustments.charges -
        totalAdjustments.credits;

      const totalCents =
        financial.baseRentalCents +
        adjustmentCents;

      if (
        totalCents < 0 ||
        totalCents > MAX_MONEY_CENTS
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Adjustments produce an invalid rental total.",
        );
      }

      const outstandingCents =
        calculateBalance(
          totalCents,
          financial.paidCents,
          financial.refundedCents,
        );

      const vehicleRef = db
        .collection("vehicles")
        .doc(
          rentalSnapshot.get(
            "vehicleId",
          ),
        );

      transaction.update(
        rentalRef,
        {
          status: "returned",

          actualReturnAt:
            asTimestamp(
              input.actualReturnAt,
            ),

          returnFuelLevel:
            input.returnFuelLevel,

          returnOdometerKm,
          returnOdometerValue:
            input.returnOdometer.value,
          returnOdometerUnit:
            input.returnOdometer.unit,

          returnNotes:
            input.notes,

          adjustments:
            input.adjustments,

          // Persist return photos.
          returnMedia:
            input.returnMedia,

          returnedBy: actorUid,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          adjustmentCents,

          totalCents,

          outstandingCents,

          rentalStatus: "returned",

          actualReturnAt:
            asTimestamp(
              input.actualReturnAt,
            ),

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      input.adjustments
        .filter(
          (adjustment) =>
            adjustment.amountCents > 0,
        )
        .forEach(
          (adjustment) =>
            transaction.create(
              db
                .collection(
                  "financialLedger",
                )
                .doc(),
              {
                rentalId:
                  rentalRef.id,

                vehicleId:
                  rentalSnapshot.get(
                    "vehicleId",
                  ),

                vehicleRegistration:
                  rentalSnapshot.get(
                    "vehicleRegistrationSnapshot",
                  ),

                customerId:
                  rentalSnapshot.get(
                    "customerId",
                  ),

                entryType:
                  adjustment.type ===
                  "discount"
                    ? "rental_discount"
                    : "rental_adjustment",

                adjustmentType:
                  adjustment.type,

                amountCents:
                  adjustment.type ===
                  "discount"
                    ? -adjustment.amountCents
                    : adjustment.amountCents,

                note:
                  adjustment.note,

                occurredAt:
                  FieldValue.serverTimestamp(),

                recordedBy: actorUid,
              },
            ),
        );

      transaction.update(
        vehicleRef,
        {
          status: "cleaning",

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "rental.returned",
        {
          collection: "rentals",
          id: rentalRef.id,
        },
        {
          vehicleId:
            vehicleRef.id,

          adjustments:
            input.adjustments.map(
              (item) => ({
                type: item.type,
                amountCents:
                  item.amountCents,
              }),
            ),

          returnMediaCount:
            input.returnMedia.length,
        },
      );

      return {
        outstandingCents,
      };
    },
  );
}

export async function extendRental(
  actorUid: string,
  input: {
    rentalId: string;
    expectedReturnAt: string;
    note: string;
    idempotencyKey: string;
  },
) {
  const operationRef = db
    .collection("idempotencyKeys")
    .doc(
      `extension_${input.idempotencyKey}`,
    );

  const rentalRef = db
    .collection("rentals")
    .doc(input.rentalId);

  const financialRef = db
    .collection("rentalFinancials")
    .doc(input.rentalId);

  return db.runTransaction(
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists) {
        return previous.get(
          "response",
        );
      }

      const [
        rentalSnapshot,
        financialSnapshot,
      ] = await transaction.getAll(
        rentalRef,
        financialRef,
      );

      if (
        !rentalSnapshot.exists ||
        !financialSnapshot.exists
      ) {
        throw new HttpsError(
          "not-found",
          "Rental was not found.",
        );
      }

      if (
        !["active", "overdue"].includes(
          rentalSnapshot.get(
            "status",
          ),
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Only active or overdue rentals can be extended.",
        );
      }

      const currentExpectedReturn =
        rentalSnapshot.get(
          "expectedReturnAt",
        ) as Timestamp;

      const newExpectedReturn =
        asTimestamp(
          input.expectedReturnAt,
        );

      if (
        newExpectedReturn.toMillis() <=
        currentExpectedReturn.toMillis()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "The extension must be later than the current expected return.",
        );
      }

      const vehicleId =
        rentalSnapshot.get(
          "vehicleId",
        ) as string;

      const conflictingReservations =
        await transaction.get(
          db
            .collection("reservations")
            .where(
              "vehicleId",
              "==",
              vehicleId,
            )
            .where(
              "status",
              "==",
              "confirmed",
            )
            .where(
              "pickupAt",
              "<",
              newExpectedReturn,
            ),
        );

      const reservationOverlap =
        conflictingReservations.docs.some(
          (reservation) =>
            (
              reservation.get(
                "expectedReturnAt",
              ) as Timestamp
            ).toMillis() >
            currentExpectedReturn.toMillis(),
        );

      if (reservationOverlap) {
        throw new HttpsError(
          "already-exists",
          "The vehicle has a reservation that conflicts with this extension.",
        );
      }

      const updatedQuote =
        quoteRental(
          {
            pickupAt: (
              rentalSnapshot.get(
                "pickupAt",
              ) as Timestamp
            )
              .toDate()
              .toISOString(),

            expectedReturnAt:
              input.expectedReturnAt,
          },

          rentalSnapshot.get(
            "rateSnapshot",
          ),
        );

      const financial =
        financialSnapshot.data()!;

      const extensionCents =
        updatedQuote.baseRentalCents -
        financial.baseRentalCents;

      if (extensionCents <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "The extension does not change the rental total.",
        );
      }

      const totalCents =
        financial.totalCents +
        extensionCents;

      if (
        totalCents >
        MAX_MONEY_CENTS
      ) {
        throw new HttpsError(
          "invalid-argument",
          "The extension exceeds the permitted rental total.",
        );
      }

      const outstandingCents =
        calculateBalance(
          totalCents,
          financial.paidCents,
          financial.refundedCents,
        );

      const response = {
        extensionCents,
        totalCents,
        outstandingCents,
        expectedReturnAt:
          input.expectedReturnAt,
      };

      transaction.update(
        rentalRef,
        {
          expectedReturnAt:
            newExpectedReturn,

          quote: updatedQuote,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(
        db
          .collection("reservations")
          .doc(
            rentalSnapshot.get(
              "reservationId",
            ),
          ),
        {
          expectedReturnAt:
            newExpectedReturn,

          quote: updatedQuote,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.create(
        rentalRef
          .collection("extensions")
          .doc(),
        {
          previousExpectedReturnAt:
            currentExpectedReturn,

          expectedReturnAt:
            newExpectedReturn,

          extensionCents,

          note: input.note,

          recordedBy: actorUid,

          recordedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          baseRentalCents:
            updatedQuote.baseRentalCents,

          totalCents,

          outstandingCents,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.create(
        db
          .collection(
            "financialLedger",
          )
          .doc(),
        {
          rentalId: rentalRef.id,

          vehicleId,

          vehicleRegistration:
            rentalSnapshot.get(
              "vehicleRegistrationSnapshot",
            ),

          customerId:
            rentalSnapshot.get(
              "customerId",
            ),

          entryType:
            "rental_extension",

          amountCents:
            extensionCents,

          note: input.note,

          occurredAt:
            FieldValue.serverTimestamp(),

          recordedBy: actorUid,
        },
      );

      transaction.create(
        operationRef,
        {
          response,

          actorUid,

          createdAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "rental.extended",
        {
          collection: "rentals",
          id: rentalRef.id,
        },
        {
          expectedReturnAt:
            input.expectedReturnAt,

          extensionCents,
        },
      );

      return response;
    },
  );
}

export async function getPayableRentals() {
  const financialSnapshot = await db
    .collection("rentalFinancials")
    .where("outstandingCents", ">", 0)
    .limit(200)
    .get();

  if (financialSnapshot.empty) {
    return [];
  }

  const rentalsSnapshot = await db.getAll(
    ...financialSnapshot.docs.map((snapshot) =>
      db.collection("rentals").doc(snapshot.id),
    ),
  );

  return financialSnapshot.docs
    .map((financialDoc) => {
      const rental = rentalsSnapshot.find(
        (snapshot) => snapshot.id === financialDoc.id,
      );
      const financial = financialDoc.data();
      const data = rental?.data();

      if (!data || !["active", "overdue", "returned"].includes(String(data.status))) {
        return null;
      }

      return {
        id: financialDoc.id,
        customerName:
          financial.customerName ??
          data.customerNameSnapshot ??
          "Unknown customer",
        vehicleRegistration:
          financial.vehicleRegistration ??
          data.vehicleRegistrationSnapshot ??
          "Unknown vehicle",
        status: String(data.status),
        outstandingCents: Number(financial.outstandingCents ?? 0),
      };
    })
    .filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )
    .sort((a, b) => a.outstandingCents - b.outstandingCents);
}

export async function recordPayment(
  actorUid: string,
  input: {
    rentalId: string;
    amountCents: number;
    kind: "payment" | "deposit";
    method: string;
    externalReference:
      | string
      | null;
    idempotencyKey: string;
    additionalFees?: Array<{
      type:
        | "car_seat"
        | "insurance"
        | "cleaning"
        | "smoke_fee"
        | "refueling";
      amountCents: number;
    }>;
  },
  isRefund = false,
  refundReason?: string,
) {
  const operationRef = db
    .collection("idempotencyKeys")
    .doc(
      `${
        isRefund
          ? "refund"
          : "payment"
      }_${input.idempotencyKey}`,
    );

  const paymentRef = db
    .collection(
      isRefund
        ? "refunds"
        : "payments",
    )
    .doc();

  const financialRef = db
    .collection("rentalFinancials")
    .doc(input.rentalId);

  return db.runTransaction(
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists) {
        return previous.get(
          "response",
        );
      }

      const [
        financialSnapshot,
        rentalSnapshot,
      ] = await transaction.getAll(
        financialRef,
        db
          .collection("rentals")
          .doc(input.rentalId),
      );

      if (
        !financialSnapshot.exists ||
        !rentalSnapshot.exists
      ) {
        throw new HttpsError(
          "not-found",
          "Rental financial record was not found.",
        );
      }

      const financial =
        financialSnapshot.data()!;

      const additionalFees =
        !isRefund && input.kind === "payment"
          ? input.additionalFees ?? []
          : [];

      const feeTypes = new Set(
        additionalFees.map(
          (fee) => fee.type,
        ),
      );

      if (
        feeTypes.size !==
        additionalFees.length
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Each additional fee can only be selected once.",
        );
      }

      const additionalFeesCents =
        additionalFees.reduce(
          (sum, fee) =>
            sum + fee.amountCents,
          0,
        );

      if (
        additionalFees.some(
          (fee) =>
            !Number.isInteger(
              fee.amountCents,
            ) ||
            fee.amountCents <= 0 ||
            fee.amountCents >
              MAX_MONEY_CENTS,
        ) ||
        additionalFeesCents >
          MAX_MONEY_CENTS
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Additional fee amounts are invalid.",
        );
      }

      const refundedPaymentCents =
        financial.refundedPaymentCents ??
        financial.refundedCents ??
        0;

      const refundedDepositCents =
        financial.refundedDepositCents ??
        0;

      const depositHeldCents =
        financial.depositHeldCents ??
        0;

      if (
        isRefund &&
        input.kind === "payment" &&
        input.amountCents >
          financial.paidCents -
            refundedPaymentCents
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Refund exceeds rental payments received.",
        );
      }

      if (
        isRefund &&
        input.kind === "deposit" &&
        input.amountCents >
          depositHeldCents -
            refundedDepositCents
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Refund exceeds the deposit currently held.",
        );
      }

      const paidCents =
        isRefund ||
        input.kind === "deposit"
          ? financial.paidCents
          : financial.paidCents +
            input.amountCents;

      const nextRefundedPaymentCents =
        isRefund &&
        input.kind === "payment"
          ? refundedPaymentCents +
            input.amountCents
          : refundedPaymentCents;

      const nextRefundedDepositCents =
        isRefund &&
        input.kind === "deposit"
          ? refundedDepositCents +
            input.amountCents
          : refundedDepositCents;

      const nextDepositHeldCents =
        !isRefund &&
        input.kind === "deposit"
          ? depositHeldCents +
            input.amountCents
          : depositHeldCents;

      const refundedCents =
        nextRefundedPaymentCents +
        nextRefundedDepositCents;

      const nextAdjustmentCents =
        financial.adjustmentCents +
        additionalFeesCents;

      const nextTotalCents =
        financial.totalCents +
        additionalFeesCents;

      if (
        nextTotalCents >
        MAX_MONEY_CENTS
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Additional fees exceed the permitted rental total.",
        );
      }

      const outstandingCents =
        calculateBalance(
          nextTotalCents,
          paidCents,
          nextRefundedPaymentCents,
        );

      const response = {
        paymentId:
          paymentRef.id,

        outstandingCents,

        depositHeldCents:
          nextDepositHeldCents -
          nextRefundedDepositCents,
      };

      const entryType = isRefund
        ? input.kind === "deposit"
          ? "refund_deposit"
          : "refund"
        : input.kind;

      transaction.create(
        paymentRef,
        {
          rentalId:
            input.rentalId,

          amountCents:
            input.amountCents,

          kind: input.kind,

          additionalFees,

          method: isRefund
            ? "refund"
            : input.method,

          externalReference:
            input.externalReference,

          reason:
            refundReason ?? null,

          idempotencyKey:
            input.idempotencyKey,

          recordedBy: actorUid,

          recordedAt:
            FieldValue.serverTimestamp(),
        },
      );

      additionalFees.forEach(
        (fee) => {
          transaction.create(
            db
              .collection(
                "financialLedger",
              )
              .doc(),
            {
              rentalId:
                input.rentalId,

              vehicleId:
                financial.vehicleId ??
                rentalSnapshot.get(
                  "vehicleId",
                ),

              vehicleRegistration:
                financial.vehicleRegistration ??
                rentalSnapshot.get(
                  "vehicleRegistrationSnapshot",
                ),

              customerId:
                financial.customerId ??
                rentalSnapshot.get(
                  "customerId",
                ),

              entryType:
                "rental_fee",

              feeType:
                fee.type,

              amountCents:
                fee.amountCents,

              paymentId:
                paymentRef.id,

              occurredAt:
                FieldValue.serverTimestamp(),

              recordedBy: actorUid,
            },
          );
        },
      );

      transaction.create(
        db
          .collection(
            "financialLedger",
          )
          .doc(),
        {
          rentalId:
            input.rentalId,

          vehicleId:
            financial.vehicleId ??
            rentalSnapshot.get(
              "vehicleId",
            ),

          vehicleRegistration:
            financial.vehicleRegistration ??
            rentalSnapshot.get(
              "vehicleRegistrationSnapshot",
            ),

          customerId:
            financial.customerId ??
            rentalSnapshot.get(
              "customerId",
            ),

          entryType,

          amountCents: isRefund
            ? -input.amountCents
            : input.amountCents,

          paymentId:
            paymentRef.id,

          occurredAt:
            FieldValue.serverTimestamp(),

          recordedBy: actorUid,
        },
      );

      transaction.update(
        financialRef,
        {
          paidCents,

          refundedCents,

          adjustmentCents:
            nextAdjustmentCents,

          totalCents:
            nextTotalCents,

          refundedPaymentCents:
            nextRefundedPaymentCents,

          depositHeldCents:
            nextDepositHeldCents,

          refundedDepositCents:
            nextRefundedDepositCents,

          outstandingCents,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.create(
        operationRef,
        {
          response,

          actorUid,

          createdAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        isRefund
          ? "payment.refunded"
          : "payment.recorded",
        {
          collection: isRefund
            ? "refunds"
            : "payments",

          id: paymentRef.id,
        },
        {
          rentalId:
            input.rentalId,

          amountCents:
            input.amountCents,

          kind: input.kind,
        },
      );

      return response;
    },
  );
}

export async function changeRates(
  actorUid: string,
  input: {
    vehicleId: string;
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
  },
) {
  const vehicleRef = db
    .collection("vehicles")
    .doc(input.vehicleId);

  return db.runTransaction(
    async (transaction) => {
      const vehicle =
        await transaction.get(
          vehicleRef,
        );

      if (!vehicle.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      const rates = {
        currency: "USD" as const,
        dailyCents:
          input.dailyCents,
        weeklyCents:
          input.weeklyCents,
        monthlyCents:
          input.monthlyCents,
      };

      transaction.update(
        vehicleRef,
        {
          rates,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "vehicle.rates_changed",
        {
          collection: "vehicles",
          id: vehicleRef.id,
        },
        {
          previousRates:
            vehicle.get("rates"),

          newRates: rates,
        },
      );

      return {
        vehicleId:
          vehicleRef.id,
        rates,
      };
    },
  );
}

export async function addExpense(
  actorUid: string,
  input: {
    vehicleId: string;
    category: string;
    amountCents: number;
    occurredAt: string;
    vendor: string | null;
    note: string;
    idempotencyKey: string;
  },
) {
  const opRef = db
    .collection("idempotencyKeys")
    .doc(
      `expense_${input.idempotencyKey}`,
    );

  const expenseRef = db
    .collection("vehicleExpenses")
    .doc();

  return db.runTransaction(
    async (transaction) => {
      const existing =
        await transaction.get(opRef);

      if (existing.exists) {
        return existing.get(
          "response",
        );
      }

      const vehicle =
        await transaction.get(
          db
            .collection("vehicles")
            .doc(input.vehicleId),
        );

      if (!vehicle.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      const response = {
        expenseId:
          expenseRef.id,
      };

      transaction.create(
        expenseRef,
        {
          ...input,

          occurredAt:
            asTimestamp(
              input.occurredAt,
            ),

          recordedBy: actorUid,

          recordedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.create(
        db
          .collection(
            "financialLedger",
          )
          .doc(),
        {
          vehicleId:
            input.vehicleId,

          vehicleRegistration:
            vehicle.get(
              "registrationNumber",
            ),

          entryType:
            "expense",

          amountCents:
            -input.amountCents,

          expenseId:
            expenseRef.id,

          occurredAt:
            FieldValue.serverTimestamp(),

          recordedBy: actorUid,
        },
      );

      transaction.create(
        opRef,
        {
          response,

          createdAt:
            FieldValue.serverTimestamp(),

          actorUid,
        },
      );

      audit(
        transaction,
        actorUid,
        "vehicle.expense_recorded",
        {
          collection:
            "vehicleExpenses",

          id: expenseRef.id,
        },
        {
          vehicleId:
            input.vehicleId,

          category:
            input.category,

          amountCents:
            input.amountCents,
        },
      );

      return response;
    },
  );
}

export async function recordInspection(
  actorUid: string,
  input: {
    rentalId: string;
    stage: string;
    conditionNotes: string | null;
    damageNotes: string | null;
    photoPaths: string[];
  },
) {
  const rentalRef = db
    .collection("rentals")
    .doc(input.rentalId);

  const recordRef = rentalRef
    .collection("inspections")
    .doc();

  return db.runTransaction(
    async (transaction) => {
      const rental =
        await transaction.get(
          rentalRef,
        );

      if (!rental.exists) {
        throw new HttpsError(
          "not-found",
          "Rental was not found.",
        );
      }

      const prefix = `inspection-photos/${input.rentalId}/`;

      if (
        !input.photoPaths.every(
          (path) =>
            path.startsWith(prefix),
        )
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Inspection photos must belong to this rental.",
        );
      }

      transaction.create(
        recordRef,
        {
          ...input,

          recordedBy: actorUid,

          recordedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "rental.inspection_recorded",
        {
          collection: "rentals",
          id: rentalRef.id,
        },
        {
          stage: input.stage,

          photoCount:
            input.photoPaths.length,
        },
      );

      return {
        inspectionId:
          recordRef.id,
      };
    },
  );
}

export async function updateVehicleStatus(
  actorUid: string,
  input: {
    vehicleId: string;
    status: VehicleDocument["status"];
    note: string;
  },
) {
  const vehicleRef = db
    .collection("vehicles")
    .doc(input.vehicleId);

  return db.runTransaction(
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      const vehicle =
        snapshot.data() as VehicleDocument;

      if (
        !isValidVehicleTransition(
          vehicle.status,
          input.status,
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          `Vehicle cannot transition from ${vehicle.status} to ${input.status}.`,
        );
      }

      if (
        input.status === "available"
      ) {
        const now = Date.now();

        if (
          !vehicle.insuranceExpiresAt ||
          !vehicle.registrationExpiresAt ||
          Date.parse(
            vehicle.insuranceExpiresAt,
          ) <= now ||
          Date.parse(
            vehicle.registrationExpiresAt,
          ) <= now
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Cannot make a vehicle available with expired or missing compliance documents.",
          );
        }
      }

      transaction.update(
        vehicleRef,
        {
          status: input.status,

          statusNote: input.note,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "vehicle.status_changed",
        {
          collection: "vehicles",
          id: vehicleRef.id,
        },
        {
          from: vehicle.status,
          to: input.status,
          note: input.note,
        },
      );

      return {
        vehicleId:
          vehicleRef.id,

        status: input.status,
      };
    },
  );
}

export async function updateVehicleDetails(
  actorUid: string,
  input: {
    vehicleId: string;
    registrationNumber: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
    registrationExpiresAt: string | null;
    insuranceExpiresAt: string | null;
    lastServiceAt: string | null;
    nextServiceDueAt: string | null;
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
    notes: string | null;
  },
) {
  const vehicleRef = db
    .collection("vehicles")
    .doc(input.vehicleId);

  return db.runTransaction(
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      const current =
        snapshot.data() as VehicleDocument;

      const nextRegistration =
        input.registrationNumber
          .trim()
          .toUpperCase();

      if (
        nextRegistration !==
        current.registrationNumber
      ) {
        const duplicateSnapshot =
          await transaction.get(
            db
              .collection("vehicles")
              .where(
                "registrationNumber",
                "==",
                nextRegistration,
              )
              .limit(1),
          );

        const duplicate =
          duplicateSnapshot.docs.find(
            (document) =>
              document.id !==
              vehicleRef.id,
          );

        if (duplicate) {
          throw new HttpsError(
            "already-exists",
            `Registration number ${nextRegistration} is already assigned to another vehicle.`,
          );
        }
      }

      if (
        input.vin !== null &&
        input.vin !== current.vin
      ) {
        const duplicateVinSnapshot =
          await transaction.get(
            db
              .collection("vehicles")
              .where(
                "vin",
                "==",
                input.vin,
              )
              .limit(1),
          );

        const duplicateVin =
          duplicateVinSnapshot.docs.find(
            (document) =>
              document.id !==
              vehicleRef.id,
          );

        if (duplicateVin) {
          throw new HttpsError(
            "already-exists",
            `VIN ${input.vin} is already assigned to another vehicle.`,
          );
        }
      }

      const rates = {
        currency: "USD" as const,
        dailyCents:
          input.dailyCents,
        weeklyCents:
          input.weeklyCents,
        monthlyCents:
          input.monthlyCents,
      };

      transaction.update(
        vehicleRef,
        {
          registrationNumber:
            nextRegistration,

          make:
            input.make
              .trim()
              .toUpperCase(),

          model:
            input.model.trim(),

          year: input.year,

          color:
            input.color?.trim() ||
            null,

          vin:
            input.vin
              ?.trim()
              .toUpperCase() ||
            null,

          registrationExpiresAt:
            input.registrationExpiresAt,

          insuranceExpiresAt:
            input.insuranceExpiresAt,

          lastServiceAt:
            input.lastServiceAt,

          nextServiceDueAt:
            input.nextServiceDueAt,

          rates,

          notes:
            input.notes?.trim() ||
            null,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "vehicle.details_updated",
        {
          collection: "vehicles",
          id: vehicleRef.id,
        },
        {
          registrationNumber:
            nextRegistration,

          previousRegistrationNumber:
            current.registrationNumber,

          vehicleId: vehicleRef.id,
        },
      );

      return {
        vehicleId:
          vehicleRef.id,

        registrationNumber:
          nextRegistration,
      };
    },
  );
}

export async function recordService(
  actorUid: string,
  input: {
    vehicleId: string;
    completedAt: string;
    nextServiceDueAt: string | null;
    description: string;
    odometerKm: number | null;
  },
) {
  const vehicleRef = db
    .collection("vehicles")
    .doc(input.vehicleId);

  const recordRef = vehicleRef
    .collection("serviceRecords")
    .doc();

  return db.runTransaction(
    async (transaction) => {
      const vehicle =
        await transaction.get(
          vehicleRef,
        );

      if (!vehicle.exists) {
        throw new HttpsError(
          "not-found",
          "Vehicle was not found.",
        );
      }

      transaction.create(
        recordRef,
        {
          ...input,

          completedAt:
            asTimestamp(
              input.completedAt,
            ),

          nextServiceDueAt:
            input.nextServiceDueAt
              ? asTimestamp(
                  input.nextServiceDueAt,
                )
              : null,

          recordedBy: actorUid,

          recordedAt:
            FieldValue.serverTimestamp(),
        },
      );

      transaction.update(
        vehicleRef,
        {
          lastServiceAt:
            asIso(
              input.completedAt,
            ),

          nextServiceDueAt:
            input.nextServiceDueAt
              ? asIso(
                  input.nextServiceDueAt,
                )
              : null,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
      );

      audit(
        transaction,
        actorUid,
        "vehicle.service_recorded",
        {
          collection: "vehicles",
          id: vehicleRef.id,
        },
        {
          serviceRecordId:
            recordRef.id,

          nextServiceDueAt:
            input.nextServiceDueAt,
        },
      );

      return {
        serviceRecordId:
          recordRef.id,
      };
    },
  );
}