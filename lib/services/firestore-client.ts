

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  calculateBalance,
  chargedRentalDays,
  quoteRental,
} from "@/packages/domain/src/pricing";
import type {
  VehicleDocument,
  VehicleStatus,
} from "@/packages/domain/src/types";
import { isValidVehicleTransition } from "@/packages/domain/src/lifecycle";
import { pickupWindowError } from "@/packages/domain/src/booking";
import {
  sanitizeDamageMarks,
  type DamageMark,
} from "@/lib/damage";

/* =========================================================
   Shared types
   ========================================================= */

export type DashboardSummary = {
  totalFleet: number;
  available: number;
  reserved: number;
  todayPickups: number;
  todayReturns: number;
  overdue: number;
  maintenanceDue: number;
  expiringDocuments: number;
  upcomingReservations: Array<{
    id: string;
    pickupAt: string;
    customerName: string;
    vehicleRegistration: string;
  }>;
  activeRentals: Array<{
    id: string;
    customerName: string;
    vehicleRegistration: string;
    expectedReturnAt: string;
    checkedOutBy: string;
    status: "active" | "overdue";
  }>;
};
export type PayableRental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  status: string;
  outstandingCents: number;
  /*
   * Only set while the vehicle is still out. The expected
   * return is the date the rent has been charged up to, so a
   * long hire that has run past it owes rent from there, and
   * the rate and base rental let the payment screen price
   * that rent the same way an extension does.
   */
  pickupAt: string | null;
  paidThroughAt: string | null;
  /* Still out past the date its rent was charged to. */
  rentOverdue: boolean;
  baseRentalCents: number;
  rates: {
    currency: "USD";
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
  } | null;
};
export type FinancialOverview = {
  from: string;
  to: string;
  vehicleId: string | null;
  invoicedCents: number;
  receivedCents: number;
  refundedCents: number;
  expensesCents: number;
  netCashCents: number;
  operatingMarginCents: number;
  outstandingCents: number;
  outstandingRentals: number;
  vehiclePerformance: Array<{
    vehicleId: string;
    vehicleRegistration: string;
    invoicedCents: number;
    expensesCents: number;
    receivedCents: number;
    operatingMarginCents: number;
  }>;
  recentEntries: Array<{
    id: string;
    entryType: string;
    vehicleRegistration: string;
    customerName: string | null;
    amountCents: number;
    occurredAt: string;
  }>;
};

/*
 * Firestore documents returned by the Web SDK are intentionally
 * represented as flexible records in this migration layer.
 *
 * The UI-level data remains strongly typed.
 */
type FirestoreDoc = {
  id: string;
  [key: string]: any;
};

/* =========================================================
   Helpers
   ========================================================= */

function getActorUid(): string {
  const user = getFirebaseClient().auth.currentUser;

  if (!user) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  return user.uid;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function asTimestamp(value: string): Timestamp {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error("Invalid date.");
  }

  return Timestamp.fromDate(date);
}

function nowTimestamp() {
  return serverTimestamp();
}

/*
 * The browser is the only writer now that the workflows run
 * directly against Firestore, so every value is validated
 * here before it reaches a document. Firestore rejects an
 * undefined field outright, and a NaN would silently corrupt
 * a monetary total, so both are refused explicitly.
 */
const MAX_MONEY_CENTS = 10_000_000;

const FUEL_LEVELS = [
  "empty",
  "one_eighth",
  "quarter",
  "three_eighths",
  "half",
  "five_eighths",
  "three_quarters",
  "seven_eighths",
  "full",
] as const;

function assertMoneyCents(
  value: unknown,
  label: string,
): number {
  const cents = Number(value);

  if (
    !Number.isInteger(cents) ||
    cents < 0 ||
    cents > MAX_MONEY_CENTS
  ) {
    throw new Error(
      `${label} must be a whole amount between $0 and $${(
        MAX_MONEY_CENTS / 100
      ).toLocaleString("en-US")}.`,
    );
  }

  return cents;
}

function assertFuelLevel(
  value: unknown,
): (typeof FUEL_LEVELS)[number] {
  const level = String(value ?? "").trim();

  if (
    !(FUEL_LEVELS as readonly string[]).includes(
      level,
    )
  ) {
    throw new Error(
      "Select a valid fuel level.",
    );
  }

  return level as (typeof FUEL_LEVELS)[number];
}

function odometerToKm(
  reading: unknown,
): {
  km: number;
  value: number;
  unit: "km" | "mi";
} {
  const source =
    (reading ?? {}) as {
      value?: unknown;
      unit?: unknown;
    };

  const value = Number(source.value);
  const unit = source.unit;

  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(
      "Odometer reading must be a non-negative number.",
    );
  }

  if (unit !== "km" && unit !== "mi") {
    throw new Error(
      "Odometer unit must be km or mi.",
    );
  }

  const km =
    unit === "mi"
      ? value * 1.609344
      : value;

  if (
    !Number.isFinite(km) ||
    km > 10_000_000
  ) {
    throw new Error(
      "Odometer reading is outside the permitted range.",
    );
  }

  return { km, value, unit };
}

/*
 * Firestore rejects a write containing undefined anywhere in
 * the document, including inside a nested object, and the
 * whole transaction fails with it. Media records arrive from
 * an external upload response, so every entry is stripped of
 * undefined before it is stored.
 */
function sanitizeMediaList(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) &&
        typeof item === "object",
    )
    .map((item) =>
      Object.fromEntries(
        Object.entries(item).filter(
          ([, entry]) =>
            entry !== undefined,
        ),
      ),
    );
}

/*
 * Date.parse returns NaN for an unparseable string, and every
 * comparison against NaN is false, so an expiry of "soon" would
 * slip past an `expiry < pickup` guard as though it were valid.
 * Compliance dates are therefore parsed through here, where a
 * non-finite result is an error rather than a silent pass.
 */
function complianceDateMs(
  value: unknown,
  label: string,
): number {
  const parsed = Date.parse(
    String(value ?? ""),
  );

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `${label} is missing or is not a valid date.`,
    );
  }

  return parsed;
}

/*
 * The same check for a value that is allowed to be absent, used
 * when a date is being stored rather than enforced.
 */
function optionalDateOrNull(
  value: unknown,
  label: string,
): string | null {
  const raw = trimmedOrNull(value);

  if (raw === null) {
    return null;
  }

  if (
    !Number.isFinite(
      Date.parse(raw),
    )
  ) {
    throw new Error(
      `${label} is not a valid date.`,
    );
  }

  return raw;
}

/*
 * Registration numbers and VINs have to be unique across the
 * fleet, but a query cannot be made part of a Firestore
 * transaction from the browser, and two vehicle creations share
 * no document, so neither would ever be forced to retry. The
 * uniqueness is therefore claimed as a document whose id is
 * derived from the value: both attempts then contend on the
 * same document and exactly one of them wins.
 */
function vehicleKeyRef(
  kind: "reg" | "vin",
  value: string,
) {
  const { db } = getFirebaseClient();

  return doc(
    db,
    "vehicleRegistry",
    `${kind}_${value.replaceAll("/", "%2F")}`,
  );
}

type VehicleKeyClaim = {
  ref: ReturnType<typeof vehicleKeyRef>;
  heldBy: string | null;
};

/*
 * Reads a claim. Firestore requires every read in a transaction
 * to happen before the first write, so claims are resolved up
 * front and written later.
 */
async function readVehicleKeyClaim(
  transaction: {
    get: (
      reference: ReturnType<typeof doc>,
    ) => Promise<{
      exists: () => boolean;
      get: (field: string) => unknown;
    }>;
  },
  kind: "reg" | "vin",
  value: string,
  claimantId: string,
): Promise<VehicleKeyClaim> {
  const { db } = getFirebaseClient();

  const ref = vehicleKeyRef(kind, value);

  const snapshot =
    await transaction.get(ref);

  if (!snapshot.exists()) {
    return { ref, heldBy: null };
  }

  const owner = String(
    snapshot.get("vehicleId") ?? "",
  );

  if (!owner || owner === claimantId) {
    return { ref, heldBy: null };
  }

  /*
   * A claim left behind by a vehicle that has since been
   * removed, or renamed away from this value, must not block a
   * legitimate reuse of the registration.
   */
  const ownerSnapshot =
    await transaction.get(
      doc(db, "vehicles", owner),
    );

  if (!ownerSnapshot.exists()) {
    return { ref, heldBy: null };
  }

  const field =
    kind === "reg"
      ? "registrationNumber"
      : "vin";

  const stillHeld =
    String(
      ownerSnapshot.get(field) ?? "",
    ) === value;

  return {
    ref,
    heldBy: stillHeld ? owner : null,
  };
}

const CONFLICT_PAGE_SIZE = 200;

/*
 * Finds a confirmed or checked-out booking for the vehicle that
 * overlaps the given window.
 *
 * A booking that starts at or after the window ends cannot
 * overlap it, so the search is bounded by the window rather
 * than by an arbitrary row count, and it pages to the end: a
 * vehicle with a long history would otherwise push the
 * conflicting booking out of a capped result set.
 */
async function overlappingReservation(
  input: {
    vehicleId: string;
    from: Timestamp;
    to: Timestamp;
    ignoreReservationId?: string;
  },
): Promise<string | null> {
  const { db } = getFirebaseClient();

  let cursor:
    | Awaited<
        ReturnType<typeof getDocs>
      >["docs"][number]
    | undefined;

  for (;;) {
    const page = await getDocs(
      query(
        collection(
          db,
          "reservations",
        ),
        where(
          "vehicleId",
          "==",
          input.vehicleId,
        ),
        where(
          "status",
          "in",
          [
            "confirmed",
            "checked_out",
          ],
        ),
        where(
          "pickupAt",
          "<",
          input.to,
        ),
        orderBy("pickupAt"),
        ...(cursor
          ? [startAfter(cursor)]
          : []),
        limit(CONFLICT_PAGE_SIZE),
      ),
    );

    for (const candidate of page.docs) {
      if (
        candidate.id ===
        input.ignoreReservationId
      ) {
        continue;
      }

      const existingReturn =
        asTimestamp(
          toIso(
            candidate.get(
              "expectedReturnAt",
            ),
          ),
        ).toMillis();

      if (
        existingReturn <=
        input.from.toMillis()
      ) {
        continue;
      }

      /*
       * A booking whose rental has already been handed back
       * is not holding the vehicle, whatever the reservation
       * still says. Returns now close the reservation, but
       * bookings taken before that was true are still sitting
       * at "checked_out" with a future expected return, and
       * those would otherwise block the vehicle for the rest
       * of the original window.
       */
      if (
        String(candidate.get("status")) ===
        "checked_out"
      ) {
        const rentalId = trimmedOrNull(
          candidate.get("rentalId"),
        );

        if (rentalId) {
          const rental = await getDoc(
            doc(db, "rentals", rentalId),
          );

          if (
            rental.exists() &&
            String(rental.get("status")) ===
              "returned"
          ) {
            continue;
          }
        }
      }

      return candidate.id;
    }

    if (
      page.size < CONFLICT_PAGE_SIZE
    ) {
      return null;
    }

    cursor =
      page.docs[page.docs.length - 1];
  }
}

function trimmedOrNull(
  value: unknown,
): string | null {
  if (value == null) {
    return null;
  }

  return String(value).trim() || null;
}

/*
 * Last resort for a staff name. A profile seeded by hand in
 * the Firestore console often carries only a role and a
 * status, and a raw user id printed on a rental agreement
 * tells the reader nothing, so the signed-in account's own
 * name or address is preferred over it.
 */
function signedInAccountName(
  actorUid: string,
): string {
  const user =
    getFirebaseClient().auth.currentUser;

  if (user && user.uid === actorUid) {
    return (
      trimmedOrNull(user.displayName) ??
      trimmedOrNull(user.email) ??
      actorUid
    );
  }

  return actorUid;
}

/*
 * The staff name shown on rentals and contracts comes from
 * the signed-in user's own profile document, never from the
 * form, so it cannot be spoofed by the browser.
 */
async function actorNameSnapshot(
  transaction: {
    get: (
      reference: ReturnType<typeof doc>,
    ) => Promise<{
      data: () => Record<string, unknown> | undefined;
    }>;
  },
  actorUid: string,
): Promise<string> {
  const { db } = getFirebaseClient();

  const snapshot = await transaction.get(
    doc(db, "users", actorUid),
  );

  const profile = snapshot.data() ?? {};

  const fullName = trimmedOrNull(
    profile.fullName,
  );

  if (fullName) {
    return fullName;
  }

  return (
    trimmedOrNull(profile.email) ??
    signedInAccountName(actorUid)
  );
}

/* =========================================================
   Dashboard
   ========================================================= */

async function getOperationalDashboard(): Promise<DashboardSummary> {
  const { db } =
    getFirebaseClient();

  const [
    vehicleSnapshot,
    reservationSnapshot,
    rentalSnapshot,
  ] = await Promise.all([
    getDocs(
      query(
        collection(db, "vehicles"),
        orderBy("registrationNumber"),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(db, "reservations"),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(db, "rentals"),
        limit(500),
      ),
    ),
  ]);

  const vehicles: FirestoreDoc[] =
    vehicleSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const reservations: FirestoreDoc[] =
    reservationSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const rentals: FirestoreDoc[] =
    rentalSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const now = new Date();

  const startOfToday =
    new Date(now);

  startOfToday.setHours(
    0,
    0,
    0,
    0,
  );

  const endOfToday =
    new Date(now);

  endOfToday.setHours(
    23,
    59,
    59,
    999,
  );

  const nextSevenDays =
    new Date(now);

  nextSevenDays.setDate(
    nextSevenDays.getDate() + 7,
  );

  const available =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "available",
    ).length;

  const reserved =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "reserved",
    ).length;

  const todayPickups =
    reservations.filter(
      (reservation) => {
        if (!reservation.pickupAt) {
          return false;
        }

        const pickup =
          new Date(
            toIso(
              reservation.pickupAt,
            ),
          );

        return (
          pickup >=
            startOfToday &&
          pickup <=
            endOfToday
        );
      },
    ).length;

  const todayReturns =
    rentals.filter(
      (rental) => {
        if (!rental.actualReturnAt) {
          return false;
        }

        const returned =
          new Date(
            toIso(
              rental.actualReturnAt,
            ),
          );

        return (
          returned >=
            startOfToday &&
          returned <=
            endOfToday
        );
      },
    ).length;

  /*
   * Overdue is worked out from the expected return time every
   * time it is asked for, rather than stamped onto the rental
   * by a nightly job. There is no scheduled function in this
   * deployment, so a stored flag would simply be wrong until
   * something happened to touch the record.
   */
  function isOverdue(
    rental: FirestoreDoc,
  ): boolean {
    if (rental.status === "overdue") {
      return true;
    }

    if (
      ![
        "active",
        "overdue",
      ].includes(String(rental.status))
    ) {
      return false;
    }

    if (!rental.expectedReturnAt) {
      return false;
    }

    return (
      new Date(
        toIso(rental.expectedReturnAt),
      ).getTime() < Date.now()
    );
  }

  const overdue =
    rentals.filter(
      (rental) => {
        if (
          rental.status ===
          "overdue"
        ) {
          return true;
        }

        if (
          ![
            "active",
            "overdue",
          ].includes(
            String(
              rental.status,
            ),
          )
        ) {
          return false;
        }

        if (
          !rental.expectedReturnAt
        ) {
          return false;
        }

        return (
          new Date(
            toIso(
              rental.expectedReturnAt,
            ),
          ).getTime() <
          now.getTime()
        );
      },
    ).length;

  const maintenanceDue =
    vehicles.filter(
      (vehicle) => {
        if (
          !vehicle.nextServiceDueAt
        ) {
          return false;
        }

        return (
          new Date(
            toIso(
              vehicle.nextServiceDueAt,
            ),
          ).getTime() <=
          now.getTime()
        );
      },
    ).length;

  const expiringDocuments =
    vehicles.filter(
      (vehicle) => {
        const threshold =
          now.getTime() +
          30 *
            24 *
            60 *
            60 *
            1000;

        const registrationExpiry =
          vehicle.registrationExpiresAt
            ? new Date(
                toIso(
                  vehicle.registrationExpiresAt,
                ),
              ).getTime()
            : 0;

        const insuranceExpiry =
          vehicle.insuranceExpiresAt
            ? new Date(
                toIso(
                  vehicle.insuranceExpiresAt,
                ),
              ).getTime()
            : 0;

        return (
          (registrationExpiry >
            0 &&
            registrationExpiry <=
              threshold) ||
          (insuranceExpiry >
            0 &&
            insuranceExpiry <=
              threshold)
        );
      },
    ).length;

  const activeRentals =
    rentals
      .filter((rental) =>
        ["active", "overdue"].includes(
          String(rental.status),
        ),
      )
      .filter((rental) => Boolean(rental.expectedReturnAt))
      .sort(
        (a, b) =>
          new Date(
            toIso(a.expectedReturnAt),
          ).getTime() -
          new Date(
            toIso(b.expectedReturnAt),
          ).getTime(),
      )
      .slice(0, 20)
      .map((rental) => ({
        id: rental.id,
        customerName: String(
          rental.customerNameSnapshot ??
            "Unknown customer",
        ),
        vehicleRegistration: String(
          rental.vehicleRegistrationSnapshot ??
            "Unknown vehicle",
        ),
        expectedReturnAt: toIso(
          rental.expectedReturnAt,
        ),
        checkedOutBy: String(
          rental.checkedOutByNameSnapshot ??
            "—",
        ),
        /* Same derivation as the overdue count above, so the
           badge on a rental and the number in the header can
           never disagree. */
        status: isOverdue(rental)
          ? "overdue"
          : "active",
      })) as DashboardSummary["activeRentals"];

  const upcomingReservations =
    reservations
      .filter(
        (reservation) => {
          if (
            reservation.status !==
            "confirmed"
          ) {
            return false;
          }

          if (
            !reservation.pickupAt
          ) {
            return false;
          }

          const pickup =
            new Date(
              toIso(
                reservation.pickupAt,
              ),
            );

          return (
            pickup >= now &&
            pickup <=
              nextSevenDays
          );
        },
      )
      .sort(
        (a, b) =>
          new Date(
            toIso(a.pickupAt),
          ).getTime() -
          new Date(
            toIso(b.pickupAt),
          ).getTime(),
      )
      .slice(0, 10)
      .map(
        (
          reservation,
        ) => ({
          id:
            reservation.id,
          pickupAt:
            toIso(
              reservation.pickupAt,
            ),
          customerName:
            String(
              reservation.customerNameSnapshot ??
                "Unknown customer",
            ),
          vehicleRegistration:
            String(
              reservation.vehicleRegistrationSnapshot ??
                "Unknown vehicle",
            ),
        }),
      );

  return {
    totalFleet:
      vehicles.length,
    available,
    reserved,
    todayPickups,
    todayReturns,
    overdue,
    maintenanceDue,
    expiringDocuments,
    upcomingReservations,
    activeRentals,
  };
}
/*
 * Everything the payment screen can take money against: any
 * rental with a balance, and every rental still out whether
 * it owes anything yet or not. A long hire that was paid up
 * front has no balance until more rent is charged, and it
 * used to drop off this list entirely, so the next week's
 * rent could not be taken at all.
 */
async function getPayableRentals(): Promise<PayableRental[]> {
  const { db } = getFirebaseClient();

  const [owing, out] = await Promise.all([
    getDocs(
      query(
        collection(db, "rentalFinancials"),
        where("outstandingCents", ">", 0),
        limit(500),
      ),
    ),
    getDocs(
      query(
        collection(db, "rentals"),
        where("status", "in", [
          "active",
          "overdue",
        ]),
        limit(500),
      ),
    ),
  ]);

  const financials = new Map<
    string,
    Record<string, any>
  >();

  for (const snapshot of owing.docs) {
    const data = snapshot.data();

    financials.set(
      String(data.rentalId ?? snapshot.id),
      data,
    );
  }

  /*
   * A rental that is out but settled is not in the balance
   * query, so its financial record is read on its own.
   */
  const settled = out.docs.filter(
    (snapshot) =>
      !financials.has(snapshot.id),
  );

  const settledFinancials = await Promise.all(
    settled.map((snapshot) =>
      getDoc(
        doc(
          db,
          "rentalFinancials",
          snapshot.id,
        ),
      ),
    ),
  );

  for (const snapshot of settledFinancials) {
    if (snapshot.exists()) {
      financials.set(
        snapshot.id,
        snapshot.data(),
      );
    }
  }

  const outRentals = new Map(
    out.docs.map((snapshot) => [
      snapshot.id,
      snapshot.data(),
    ]),
  );

  function centsOrNull(
    value: unknown,
  ): number | null {
    const cents = Number(value);

    return value === null ||
      value === undefined ||
      !Number.isSafeInteger(cents) ||
      cents < 0
      ? null
      : cents;
  }

  return [...financials.entries()]
    .map(([id, data]) => {
      const rental = outRentals.get(id);

      const rates = rental?.rateSnapshot as
        | Record<string, unknown>
        | undefined;

      return {
        id,
        customerName: String(
          data.customerNameSnapshot ??
            data.customerName ??
            rental?.customerNameSnapshot ??
            "Unknown customer",
        ),
        vehicleRegistration: String(
          data.vehicleRegistration ??
            data.vehicleRegistrationSnapshot ??
            rental?.vehicleRegistrationSnapshot ??
            "Unknown vehicle",
        ),
        status: String(
          rental?.status ??
            data.rentalStatus ??
            "active",
        ),
        outstandingCents: Number(
          data.outstandingCents ?? 0,
        ),
        pickupAt:
          rental?.pickupAt
            ? toIso(rental.pickupAt)
            : null,
        paidThroughAt:
          rental?.expectedReturnAt
            ? toIso(rental.expectedReturnAt)
            : null,
        rentOverdue: Boolean(
          rental?.expectedReturnAt &&
            Date.parse(
              toIso(rental.expectedReturnAt),
            ) < Date.now(),
        ),
        baseRentalCents: Number(
          data.baseRentalCents ?? 0,
        ),
        rates: rates
          ? {
              currency: "USD" as const,
              dailyCents: centsOrNull(
                rates.dailyCents,
              ),
              weeklyCents: centsOrNull(
                rates.weeklyCents,
              ),
              monthlyCents: centsOrNull(
                rates.monthlyCents,
              ),
            }
          : null,
        updatedAt:
          data.updatedAt instanceof Timestamp
            ? data.updatedAt.toMillis()
            : 0,
      };
    })
    .filter(
      (rental) =>
        Number.isFinite(
          rental.outstandingCents,
        ) &&
        (rental.outstandingCents > 0 ||
          outRentals.has(rental.id)),
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt,
    )
    .map(
      ({
        updatedAt: _updatedAt,
        ...rental
      }) => rental,
    );
}
/* =========================================================
   Customer
   ========================================================= */

/*
 * A date of birth is printed on the rental agreement and is
 * what an under-25 insurance premium is judged from, so a
 * typo that lands in the future or a century ago has to be
 * refused rather than quietly stored.
 */
const MIN_RENTER_AGE_YEARS = 16;
const MAX_RENTER_AGE_YEARS = 120;

function assertDateOfBirth(
  value: unknown,
): string | null {
  const text =
    trimmedOrNull(value);

  if (!text) {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text,
    )
  ) {
    throw new Error(
      "Enter the date of birth as a calendar date.",
    );
  }

  const born =
    new Date(
      `${text}T00:00:00`,
    );

  if (
    Number.isNaN(
      born.getTime(),
    )
  ) {
    throw new Error(
      "Enter a valid date of birth.",
    );
  }

  const today =
    new Date();

  today.setHours(0, 0, 0, 0);

  if (
    born.getTime() >
    today.getTime()
  ) {
    throw new Error(
      "Date of birth cannot be in the future.",
    );
  }

  const years =
    (today.getTime() -
      born.getTime()) /
    (365.2425 * 86_400_000);

  if (
    years < MIN_RENTER_AGE_YEARS
  ) {
    throw new Error(
      `A customer must be at least ${MIN_RENTER_AGE_YEARS} years old.`,
    );
  }

  if (
    years > MAX_RENTER_AGE_YEARS
  ) {
    throw new Error(
      "Check the date of birth: that age is not plausible.",
    );
  }

  return text;
}

async function createOrUpdateCustomer(
  input: Record<string, unknown>,
): Promise<{
  customerId: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  /*
   * An explicit customerId means the employee opened an
   * existing record from the Customers screen and pressed
   * Edit. That record is updated in place; creating a second
   * document here would silently duplicate the customer and
   * detach their existing bookings.
   */
  const existingCustomerId =
    trimmedOrNull(
      input.customerId,
    );

  const customerRef =
    existingCustomerId
      ? doc(
          db,
          "customers",
          existingCustomerId,
        )
      : doc(
          collection(
            db,
            "customers",
          ),
        );

  const fullName =
    String(
      input.fullName ?? "",
    ).trim();

  const telephone =
    String(
      input.telephone ?? "",
    ).trim();

  const licenceNumber =
    String(
      input.licenceNumber ?? "",
    )
      .trim()
      .toUpperCase();

  const licenceCountry =
    String(
      input.licenceCountry ?? "",
    )
      .trim()
      .toUpperCase();

  if (
    !fullName ||
    !telephone ||
    !licenceNumber
  ) {
    throw new Error(
      "Complete all required customer details.",
    );
  }

  if (licenceCountry.length !== 2) {
    throw new Error(
      "Select a valid licence issuing country.",
    );
  }

  const licenceExpiresAt =
    input.licenceExpiresAt
      ? String(
          input.licenceExpiresAt,
        )
      : null;

  if (licenceExpiresAt) {
    const today =
      new Date();

    today.setHours(
      0,
      0,
      0,
      0,
    );

    const expiryDate =
      new Date(
        `${licenceExpiresAt}T00:00:00`,
      );

    expiryDate.setHours(
      0,
      0,
      0,
      0,
    );

    if (
      Number.isNaN(
        expiryDate.getTime(),
      ) ||
      expiryDate.getTime() <=
        today.getTime()
    ) {
      throw new Error(
        "Licence expiry must be after today.",
      );
    }
  }

  const details: Record<string, unknown> = {
    fullName,

    telephone,

    email:
      trimmedOrNull(
        input.email,
      ),

    address:
      trimmedOrNull(
        input.address,
      ),

    /* Printed on the agreement beside the address. */
    state:
      trimmedOrNull(
        input.state,
      ),

    localAddress:
      trimmedOrNull(
        input.localAddress,
      ),

    licenceNumber,

    licenceCountry,

    licenceExpiresAt,

    dateOfBirth:
      assertDateOfBirth(
        input.dateOfBirth,
      ),

    notes:
      trimmedOrNull(
        input.notes,
      ),

    licenceStoragePath:
      input.licenceStoragePath ==
      null
        ? null
        : String(
            input.licenceStoragePath,
          ),
  };

  /*
   * An update is a patch, not a replacement. A screen that
   * edits the contact details does not know about the date
   * of birth, the internal note or the licence image, and
   * sending those back as null would quietly erase them, so
   * only the fields the caller actually supplied are written.
   */
  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(details)) {
    if (
      Object.prototype.hasOwnProperty.call(
        input,
        key,
      ) &&
      input[key] !== undefined
    ) {
      patch[key] = details[key];
    }
  }

  await runTransaction(
    db,
    async (transaction) => {
      const existing =
        existingCustomerId
          ? await transaction.get(
              customerRef,
            )
          : null;

      if (
        existing &&
        !existing.exists()
      ) {
        throw new Error(
          "Customer was not found.",
        );
      }

      if (existing) {
        transaction.update(
          customerRef,
          {
            ...patch,

            updatedBy:
              actorUid,

            updatedAt:
              nowTimestamp(),
          },
        );

        return;
      }

      transaction.set(
        customerRef,
        {
          ...details,

          createdBy:
            actorUid,

          updatedBy:
            actorUid,

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    customerId:
      customerRef.id,
  };
}

async function updateCustomerLicenceDocument(
  input: {
    customerId: string;
    licenceStoragePath: string;
  },
): Promise<{
  customerId: string;
  licenceStoragePath: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const customerId =
    trimmedOrNull(
      input.customerId,
    );

  const licenceStoragePath =
    trimmedOrNull(
      input.licenceStoragePath,
    );

  if (
    !customerId ||
    !licenceStoragePath
  ) {
    throw new Error(
      "A customer and a licence image are both required.",
    );
  }

  const customerRef =
    doc(
      db,
      "customers",
      customerId,
    );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          customerRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
          "Customer was not found.",
        );
      }

      transaction.update(
        customerRef,
        {
          licenceStoragePath,

          licenceCapturedAt:
            nowTimestamp(),

          updatedBy:
            actorUid,

          updatedAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    customerId,
    licenceStoragePath,
  };
}

export type ReservationContract = {
  reservationId: string;
  status: string;
  createdAt: string;
  customer: {
    fullName: string;
    telephone: string;
    email: string | null;
    address: string | null;
    licenceNumber: string;
    licenceCountry: string;
    licenceExpiresAt: string | null;
  };
  vehicle: {
    registration: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
  };
  pickupAt: string;
  expectedReturnAt: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  notes: string | null;
  preparedBy: string;
  chargedDays: number;
  baseRentalCents: number;
  rateSnapshot: {
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
  };
  customerSignatureDataUrl: string | null;
  customerSignatureName: string | null;
  customerSignatureMethod: "drawn" | "typed" | null;
};

/*
 * The rental agreement is rebuilt from the stored reservation
 * snapshot rather than from whatever is currently on screen,
 * so a contract can never show a stale price or a vehicle the
 * booking was not made against.
 */
async function getReservationContract(
  input: { reservationId: string },
): Promise<ReservationContract> {
  const { db } =
    getFirebaseClient();

  const reservationSnapshot =
    await getDoc(
      doc(
        db,
        "reservations",
        String(
          input.reservationId,
        ),
      ),
    );

  if (!reservationSnapshot.exists()) {
    throw new Error(
      "Booking was not found.",
    );
  }

  const reservation =
    reservationSnapshot.data();

  const [
    customerSnapshot,
    vehicleSnapshot,
  ] = await Promise.all([
    getDoc(
      doc(
        db,
        "customers",
        String(
          reservation.customerId,
        ),
      ),
    ),

    getDoc(
      doc(
        db,
        "vehicles",
        String(
          reservation.vehicleId,
        ),
      ),
    ),
  ]);

  const customer =
    customerSnapshot.data() ?? {};

  const vehicle =
    vehicleSnapshot.data() ?? {};

  const rateSnapshot =
    (reservation.rateSnapshot ??
      {}) as Record<string, unknown>;

  const quote =
    (reservation.quote ??
      {}) as Record<string, unknown>;

  return {
    reservationId:
      reservationSnapshot.id,

    status:
      String(
        reservation.status ??
          "confirmed",
      ),

    createdAt:
      toIso(
        reservation.createdAt,
      ),

    customer: {
      fullName:
        String(
          customer.fullName ??
            reservation.customerNameSnapshot ??
            "Unknown customer",
        ),

      telephone:
        String(
          customer.telephone ?? "",
        ),

      email:
        trimmedOrNull(
          customer.email,
        ),

      address:
        trimmedOrNull(
          customer.address,
        ),

      licenceNumber:
        String(
          customer.licenceNumber ?? "",
        ),

      licenceCountry:
        String(
          customer.licenceCountry ?? "",
        ),

      licenceExpiresAt:
        trimmedOrNull(
          customer.licenceExpiresAt,
        ),
    },

    vehicle: {
      /*
       * The registration captured at booking time wins over the
       * fleet record, so renaming a vehicle later cannot change
       * what an already-signed agreement says it was for.
       */
      registration:
        String(
          reservation.vehicleRegistrationSnapshot ??
            vehicle.registrationNumber ??
            "Unknown vehicle",
        ),

      make:
        String(
          vehicle.make ?? "",
        ),

      model:
        String(
          vehicle.model ?? "",
        ),

      year:
        vehicle.year == null
          ? null
          : Number(
              vehicle.year,
            ),

      color:
        trimmedOrNull(
          vehicle.color,
        ),

      vin:
        trimmedOrNull(
          vehicle.vin,
        ),
    },

    pickupAt:
      toIso(
        reservation.pickupAt,
      ),

    expectedReturnAt:
      toIso(
        reservation.expectedReturnAt,
      ),

    pickupLocation:
      trimmedOrNull(
        reservation.pickupLocation,
      ),

    dropoffLocation:
      trimmedOrNull(
        reservation.dropoffLocation,
      ),

    notes:
      trimmedOrNull(
        reservation.notes,
      ),

    preparedBy:
      String(
        reservation.createdByNameSnapshot ??
          "—",
      ),

    chargedDays:
      Number(
        quote.chargedDays ?? 0,
      ),

    baseRentalCents:
      Number(
        quote.baseRentalCents ?? 0,
      ),

    rateSnapshot: {
      dailyCents:
        rateSnapshot.dailyCents == null
          ? null
          : Number(
              rateSnapshot.dailyCents,
            ),

      weeklyCents:
        rateSnapshot.weeklyCents == null
          ? null
          : Number(
              rateSnapshot.weeklyCents,
            ),

      monthlyCents:
        rateSnapshot.monthlyCents == null
          ? null
          : Number(
              rateSnapshot.monthlyCents,
            ),
    },

    customerSignatureDataUrl:
      typeof reservation.customerSignatureDataUrl ===
      "string"
        ? reservation.customerSignatureDataUrl
        : null,

    customerSignatureName: trimmedOrNull(
      reservation.customerSignatureName,
    ),

    /*
     * Bookings taken before the typed-name option existed
     * carry no method, and every one of those was drawn.
     */
    customerSignatureMethod:
      reservation.customerSignatureMethod ===
      "typed"
        ? "typed"
        : reservation.customerSignatureDataUrl
          ? "drawn"
          : null,
  };
}

export type RentalAgreementView = {
  rentalId: string;
  reservationId: string;
  status: string;
  createdAt: string;
  renter: {
    fullName: string;
    address: string | null;
    state: string | null;
    localAddress: string | null;
    dateOfBirth: string | null;
    licenceNumber: string;
    licenceCountry: string;
    licenceExpiresAt: string | null;
    telephone: string;
    email: string | null;
  };
  additionalDriver: {
    fullName: string;
    address: string | null;
    state: string | null;
    localAddress: string | null;
    dateOfBirth: string | null;
    licenceNumber: string | null;
    licenceExpiresAt: string | null;
    telephone: string | null;
  } | null;
  vehicle: {
    registration: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
  };
  dateOut: string;
  dateIn: string;
  actualTimeIn: string | null;
  extraHours: number;
  odometerOut: {
    value: number;
    unit: string;
  } | null;
  odometerIn: {
    value: number;
    unit: string;
  } | null;
  totalDistance: number | null;
  gasOut: string | null;
  gasIn: string | null;
  waivers: {
    liabilityWaiver: boolean;
    windscreenWaiver: boolean;
    personalAccidentInsurance: boolean;
  };
  depositCents: number;
  payment: {
    method: string | null;
    referenceLast4: string | null;
    cardHolder: string | null;
  };
  charges: Record<string, number>;
  chargeTotalCents: number;
  specialInstructions: string | null;
  preparedBy: string;
  checkedOutBy: string;
  customerSignatureDataUrl: string | null;
  customerSignatureName: string | null;
  customerSignatureMethod: "drawn" | "typed" | null;
  additionalDriverSignatureDataUrl: string | null;
  additionalDriverSignatureName: string | null;
  media: Array<Record<string, unknown>>;
  /* Marked on the drawings when the vehicle went out. */
  damageMarks: DamageMark[];
  /* As it came back; null until the vehicle is returned. */
  returnDamageMarks: DamageMark[] | null;
};

function fuelToGas(
  value: unknown,
): string | null {
  /*
   * The workshop records fuel in eighths; the printed form has
   * five boxes. The reading is mapped to the nearest box the
   * form actually offers rather than inventing a sixth.
   */
  const map: Record<string, string> = {
    empty: "empty",
    one_eighth: "quarter",
    quarter: "quarter",
    three_eighths: "half",
    half: "half",
    five_eighths: "half",
    three_quarters: "three_quarters",
    seven_eighths: "full",
    full: "full",
  };

  const key = trimmedOrNull(value);

  return key ? (map[key] ?? null) : null;
}

/*
 * The agreement is rebuilt from the rental every time it is
 * opened. It is issued at checkout, so the rental — not the
 * booking — is what holds the signature, the condition photos
 * and the charge rows the renter agreed to.
 */
async function getRentalAgreement(
  input: { rentalId: string },
): Promise<RentalAgreementView> {
  const { db } = getFirebaseClient();

  const rentalId = trimmedOrNull(
    input.rentalId,
  );

  if (!rentalId) {
    throw new Error(
      "A rental reference is required.",
    );
  }

  const rentalSnapshot = await getDoc(
    doc(db, "rentals", rentalId),
  );

  if (!rentalSnapshot.exists()) {
    throw new Error("Rental was not found.");
  }

  const rental = rentalSnapshot.data();

  const [customerSnapshot, vehicleSnapshot] =
    await Promise.all([
      getDoc(
        doc(
          db,
          "customers",
          String(rental.customerId),
        ),
      ),

      getDoc(
        doc(
          db,
          "vehicles",
          String(rental.vehicleId),
        ),
      ),
    ]);

  const customer = customerSnapshot.data() ?? {};
  const vehicle = vehicleSnapshot.data() ?? {};

  const agreement = (rental.agreement ??
    {}) as Record<string, unknown>;

  const driver = (agreement.additionalDriver ??
    null) as Record<string, unknown> | null;

  const waivers = (agreement.waivers ??
    {}) as Record<string, unknown>;

  const chargeInput = (agreement.charges ??
    {}) as Record<string, unknown>;

  const charges: Record<string, number> = {};

  for (const key of CHARGE_KEYS) {
    charges[key] = Number(
      chargeInput[key] ?? 0,
    );
  }

  const odometerOutValue =
    rental.pickupOdometerValue == null
      ? null
      : Number(rental.pickupOdometerValue);

  const odometerInValue =
    rental.returnOdometerValue == null
      ? null
      : Number(rental.returnOdometerValue);

  return {
    rentalId: rentalSnapshot.id,

    reservationId: String(
      rental.reservationId ?? "",
    ),

    status: String(rental.status ?? "active"),

    createdAt: toIso(rental.createdAt),

    renter: {
      fullName: String(
        customer.fullName ??
          rental.customerNameSnapshot ??
          "",
      ),
      address: trimmedOrNull(customer.address),
      state: trimmedOrNull(customer.state),
      localAddress: trimmedOrNull(
        customer.localAddress,
      ),
      dateOfBirth: trimmedOrNull(
        customer.dateOfBirth,
      ),
      licenceNumber: String(
        customer.licenceNumber ?? "",
      ),
      licenceCountry: String(
        customer.licenceCountry ?? "",
      ),
      licenceExpiresAt: trimmedOrNull(
        customer.licenceExpiresAt,
      ),
      telephone: String(
        customer.telephone ?? "",
      ),
      email: trimmedOrNull(customer.email),
    },

    additionalDriver: driver
      ? {
          fullName: String(
            driver.fullName ?? "",
          ),
          address: trimmedOrNull(driver.address),
          state: trimmedOrNull(driver.state),
          localAddress: trimmedOrNull(
            driver.localAddress,
          ),
          dateOfBirth: trimmedOrNull(
            driver.dateOfBirth,
          ),
          licenceNumber: trimmedOrNull(
            driver.licenceNumber,
          ),
          licenceExpiresAt: trimmedOrNull(
            driver.licenceExpiresAt,
          ),
          telephone: trimmedOrNull(
            driver.telephone,
          ),
        }
      : null,

    vehicle: {
      registration: String(
        rental.vehicleRegistrationSnapshot ??
          vehicle.registrationNumber ??
          "",
      ),
      make: String(vehicle.make ?? ""),
      model: String(vehicle.model ?? ""),
      year:
        vehicle.year == null
          ? null
          : Number(vehicle.year),
      color: trimmedOrNull(vehicle.color),
    },

    dateOut: toIso(rental.pickupAt),

    dateIn: toIso(rental.expectedReturnAt),

    actualTimeIn:
      rental.actualReturnAt == null
        ? null
        : toIso(rental.actualReturnAt),

    extraHours: Number(
      agreement.extraHours ?? 0,
    ),

    odometerOut:
      odometerOutValue == null
        ? null
        : {
            value: odometerOutValue,
            unit: String(
              rental.pickupOdometerUnit ?? "km",
            ),
          },

    odometerIn:
      odometerInValue == null
        ? null
        : {
            value: odometerInValue,
            unit: String(
              rental.returnOdometerUnit ?? "km",
            ),
          },

    totalDistance:
      rental.returnOdometerKm == null
        ? null
        : Number(rental.returnOdometerKm) -
          Number(rental.pickupOdometerKm ?? 0),

    gasOut: fuelToGas(rental.pickupFuelLevel),

    gasIn: fuelToGas(rental.returnFuelLevel),

    waivers: {
      liabilityWaiver:
        waivers.liabilityWaiver === true,
      windscreenWaiver:
        waivers.windscreenWaiver === true,
      personalAccidentInsurance:
        waivers.personalAccidentInsurance ===
        true,
    },

    depositCents: Number(
      agreement.depositCents ?? 0,
    ),

    payment: {
      method: trimmedOrNull(
        agreement.paymentMethod,
      ),
      referenceLast4: trimmedOrNull(
        agreement.paymentReferenceLast4,
      ),
      cardHolder: trimmedOrNull(
        agreement.paymentCardHolder,
      ),
    },

    charges,

    chargeTotalCents: Number(
      agreement.chargeTotalCents ?? 0,
    ),

    specialInstructions: trimmedOrNull(
      agreement.specialInstructions ??
        rental.checkoutNotes,
    ),

    preparedBy: String(
      rental.createdByNameSnapshot ?? "",
    ),

    checkedOutBy: String(
      rental.checkedOutByNameSnapshot ?? "",
    ),

    customerSignatureDataUrl:
      typeof agreement.customerSignatureDataUrl ===
      "string"
        ? agreement.customerSignatureDataUrl
        : null,

    customerSignatureName: trimmedOrNull(
      agreement.customerSignatureName,
    ),

    customerSignatureMethod:
      agreement.customerSignatureMethod ===
      "typed"
        ? "typed"
        : agreement.customerSignatureDataUrl
          ? "drawn"
          : null,

    additionalDriverSignatureDataUrl:
      typeof agreement.additionalDriverSignatureDataUrl ===
      "string"
        ? agreement.additionalDriverSignatureDataUrl
        : null,

    additionalDriverSignatureName: trimmedOrNull(
      agreement.additionalDriverSignatureName,
    ),

    media: sanitizeMediaList(
      rental.checkoutMedia,
    ) as Array<Record<string, unknown>>,

    damageMarks: sanitizeDamageMarks(
      rental.checkoutDamageMarks,
    ),

    returnDamageMarks: Array.isArray(
      rental.returnDamageMarks,
    )
      ? sanitizeDamageMarks(
          rental.returnDamageMarks,
        )
      : null,
  };
}

/* =========================================================
   Reservation
   ========================================================= */

async function createReservation(
  input: {
    customerId: string;
    vehicleId: string;
    pickupAt: string;
    expectedReturnAt: string;
    pickupLocation: string | null;
    dropoffLocation: string | null;
    notes: string | null;
    bookingMedia: Array<Record<string, unknown>>;
    /*
     * The rental is already running and is being written down
     * after the fact, so its pickup is behind us rather than
     * ahead. Everything else about it is an ordinary booking.
     */
    backdated?: boolean;
  },
): Promise<{
  reservationId: string;
  quote: {
    baseRentalCents: number;
    chargedDays: number;
  };
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const pickupAt =
    asTimestamp(
      input.pickupAt,
    );

  const expectedReturnAt =
    asTimestamp(
      input.expectedReturnAt,
    );

  if (
    expectedReturnAt.toMillis() <=
    pickupAt.toMillis()
  ) {
    throw new Error(
      "Expected return must be after pickup.",
    );
  }

  /*
   * The agreement is signed at checkout, when the customer is
   * at the counter and the car is in front of them, so a
   * booking no longer captures a signature. Taking one here
   * meant signing for a vehicle nobody had inspected yet.
   */

  const bookingMedia =
    sanitizeMediaList(
      input.bookingMedia,
    );

  const reservationRef =
    doc(
      collection(
        db,
        "reservations",
      ),
    );

  const vehicleRef =
    doc(
      db,
      "vehicles",
      String(
        input.vehicleId,
      ),
    );

  const customerRef =
    doc(
      db,
      "customers",
      String(
        input.customerId,
      ),
    );

  let quote: ReturnType<typeof quoteRental>;

  await runTransaction(
    db,
    async (transaction) => {
      const [
        vehicleSnapshot,
        customerSnapshot,
      ] = await Promise.all([
        transaction.get(
          vehicleRef,
        ),

        transaction.get(
          customerRef,
        ),
      ]);

      const staffNameSnapshot =
        await actorNameSnapshot(
          transaction,
          actorUid,
        );

      if (!vehicleSnapshot.exists()) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      if (!customerSnapshot.exists()) {
        throw new Error(
          "Customer was not found.",
        );
      }

      const vehicle =
        vehicleSnapshot.data() as VehicleDocument;

      if (
        ![
          "available",
          "reserved",
        ].includes(
          String(
            vehicle.status,
          ),
        )
      ) {
        throw new Error(
          "Vehicle cannot be reserved in its current status.",
        );
      }

      const pickupMillis =
        pickupAt.toMillis();

      const backdated =
        input.backdated === true;

      const windowError =
        pickupWindowError({
          pickupAtMs: pickupMillis,

          nowMs:
            Timestamp.now().toMillis(),

          backdated,
        });

      if (windowError) {
        throw new Error(windowError);
      }

      /*
       * Papers are checked against the pickup instant, so a
       * backdated booking is judged on what was valid when the
       * vehicle actually went out rather than on what is valid
       * today. That is the same latitude a past booking is
       * given: the hire already happened, and refusing to
       * write it down does not un-hire the car.
       */
      if (
        complianceDateMs(
          vehicle.insuranceExpiresAt,
          "Vehicle insurance expiry",
        ) < pickupMillis ||
        complianceDateMs(
          vehicle.registrationExpiresAt,
          "Vehicle registration expiry",
        ) < pickupMillis
      ) {
        throw new Error(
          "Vehicle registration and insurance must be recorded and valid through pickup.",
        );
      }

      const licenceExpiresAt =
        Date.parse(
          String(
            customerSnapshot.get(
              "licenceExpiresAt",
            ) ?? "",
          ),
        );

      if (
        !Number.isFinite(
          licenceExpiresAt,
        ) ||
        licenceExpiresAt < pickupMillis
      ) {
        throw new Error(
          "Customer licence is missing or expires before pickup.",
        );
      }

      /*
       * The browser SDK cannot run a query through the
       * transaction, so this is an ordinary read. Running it
       * inside the callback is still what makes the check
       * sound: every reservation also writes its vehicle
       * document, so a competing booking forces this
       * transaction to retry, and the retry re-runs this
       * search and sees the reservation that was just
       * committed.
       */
      const conflictId =
        await overlappingReservation({
          vehicleId: vehicleRef.id,
          from: pickupAt,
          to: expectedReturnAt,
        });

      if (conflictId) {
        throw new Error(
          "Vehicle has an overlapping reservation.",
        );
      }

      quote = quoteRental(
        {
          pickupAt:
            input.pickupAt,

          expectedReturnAt:
            input.expectedReturnAt,
        },

        vehicle.rates,
      );

      transaction.set(
        reservationRef,
        {
          bookingMedia,

          customerId:
            customerRef.id,

          customerNameSnapshot:
            String(
              customerSnapshot.get(
                "fullName",
              ) ?? "",
            ),

          vehicleId:
            vehicleRef.id,

          vehicleRegistrationSnapshot:
            vehicle.registrationNumber,

          pickupAt,

          expectedReturnAt,

          pickupLocation:
            trimmedOrNull(
              input.pickupLocation,
            ),

          dropoffLocation:
            trimmedOrNull(
              input.dropoffLocation,
            ),

          status:
            "confirmed",

          /*
           * Says the record was written after its pickup had
           * passed, so a booking dated last month is read as
           * one the office caught up on rather than as a
           * mistyped date.
           *
           * It is deliberately not `isHistorical`: that flag
           * marks a rental that is over and takes it out of
           * the live listings, and this one is still out.
           */
          backdated,

          rateSnapshot: {
            ...vehicle.rates,

            quotedAt:
              new Date().toISOString(),

            vehicleId:
              vehicleRef.id,

            vehicleRegistration:
              vehicle.registrationNumber,
          },

          quote,

          notes:
            trimmedOrNull(
              input.notes,
            ),

          createdBy:
            actorUid,

          createdByNameSnapshot:
            staffNameSnapshot,

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        vehicleRef,
        {
          status:
            "reserved",

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.set(
        doc(
          collection(
            db,
            "auditLogs",
          ),
        ),
        {
          actorUid,

          action:
            "reservation.created",

          resource: {
            collection:
              "reservations",

            id:
              reservationRef.id,
          },

          details: {
            vehicleId:
              vehicleRef.id,

            customerId:
              customerRef.id,

            pickupAt:
              input.pickupAt,

            backdated,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    reservationId:
      reservationRef.id,

    quote: quote!,
  };
}

/*
 * A booking that is no longer wanted has to be removable, or
 * the vehicle it holds stays unbookable for that window with
 * nothing the desk can do about it.
 *
 * It is cancelled rather than deleted: the record of what was
 * promised, to whom, and who called it off is worth keeping,
 * and a cancelled booking holds no vehicle because the
 * conflict search only counts "confirmed" and "checked_out".
 * Deleting the document outright stays an administrator's
 * action through the console.
 */
async function cancelReservation(
  input: {
    reservationId: string;
    reason: string;
  },
): Promise<{
  reservationId: string;
  vehicleReleased: boolean;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const reservationId = trimmedOrNull(
    input.reservationId,
  );

  if (!reservationId) {
    throw new Error(
      "Select a booking to cancel.",
    );
  }

  const reason = trimmedOrNull(input.reason);

  /*
   * The cancelled list says why each booking was released, so
   * a cancellation without a reason is refused.
   */
  if (!reason) {
    throw new Error(
      "Give a reason for cancelling this booking.",
    );
  }

  if (reason.length > 500) {
    throw new Error(
      "Keep the cancellation reason under 500 characters.",
    );
  }

  const reservationRef = doc(
    db,
    "reservations",
    reservationId,
  );

  let vehicleReleased = false;

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          reservationRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
          "Booking was not found.",
        );
      }

      const status = String(
        snapshot.get("status"),
      );

      if (status === "cancelled") {
        throw new Error(
          "This booking has already been cancelled.",
        );
      }

      /*
       * Once the car has gone out the booking is no longer
       * the thing holding it — the rental is — so it is
       * returned, not cancelled.
       */
      if (status !== "confirmed") {
        throw new Error(
          status === "checked_out"
            ? "This booking has already been checked out. Complete the return instead."
            : "Only a confirmed booking can be cancelled.",
        );
      }

      const vehicleId = trimmedOrNull(
        snapshot.get("vehicleId"),
      );

      const vehicleRef = vehicleId
        ? doc(db, "vehicles", vehicleId)
        : null;

      const vehicleSnapshot = vehicleRef
        ? await transaction.get(vehicleRef)
        : null;

      const actorName =
        await actorNameSnapshot(
          transaction,
          actorUid,
        );

      transaction.update(reservationRef, {
        status: "cancelled",

        cancelledBy: actorUid,

        cancelledByNameSnapshot: actorName,

        cancelledAt: nowTimestamp(),

        cancellationReason: reason,

        updatedAt: nowTimestamp(),
      });

      /*
       * The vehicle only goes back on offer if this booking is
       * what took it off. A car already out on another rental,
       * in for maintenance or waiting to be cleaned keeps the
       * status it has.
       */
      if (
        vehicleRef &&
        vehicleSnapshot?.exists() &&
        String(vehicleSnapshot.get("status")) ===
          "reserved"
      ) {
        vehicleReleased = true;

        transaction.update(vehicleRef, {
          status: "available",

          statusNote: null,

          updatedAt: nowTimestamp(),
        });
      }

      transaction.set(
        doc(collection(db, "auditLogs")),
        {
          actorUid,

          action: "reservation.cancelled",

          resource: {
            collection: "reservations",
            id: reservationId,
          },

          details: {
            actorName,
            reason,
            vehicleId,
            vehicleReleased,

            customerNameSnapshot: String(
              snapshot.get(
                "customerNameSnapshot",
              ) ?? "",
            ),

            vehicleRegistrationSnapshot: String(
              snapshot.get(
                "vehicleRegistrationSnapshot",
              ) ?? "",
            ),
          },

          createdAt: nowTimestamp(),
        },
      );
    },
  );

  return { reservationId, vehicleReleased };
}

/* =========================================================
   Checkout
   ========================================================= */

export type AgreementInput = {
  /** Drawn signature, or null when the name was typed. */
  customerSignatureDataUrl: string | null;
  customerSignatureName: string | null;
  additionalDriverSignatureDataUrl: string | null;
  additionalDriverSignatureName: string | null;
  additionalDriver: Record<string, unknown> | null;
  waivers: Record<string, unknown> | null;
  depositCents: number | null;
  paymentMethod: string | null;
  /* Never the full number: only what is needed to identify a
     payment afterwards. The printed form leaves the rest to be
     completed by hand. */
  paymentReferenceLast4: string | null;
  paymentCardHolder: string | null;
  charges: Record<string, unknown> | null;
  specialInstructions: string | null;
  extraHours: number | null;
};

const WAIVER_KEYS = [
  "liabilityWaiver",
  "windscreenWaiver",
  "personalAccidentInsurance",
] as const;

const CHARGE_KEYS = [
  "daily",
  "weekly",
  "monthly",
  "extraHours",
  "fuel",
  "detailing",
  "liabilityWaiver",
  "windscreenWaiver",
  "insurance",
  "carSeat",
  "other",
] as const;

const PAYMENT_METHODS = [
  "cash",
  "check",
  "credit",
] as const;

/*
 * The agreement block captured at checkout. Everything is
 * normalised to a stored shape here, because it is printed on
 * a document the renter signs: an undefined or a stray string
 * would show up as a blank on a legal form.
 */
/*
 * What an approved contract records of the agreement the
 * renter signed at checkout. The signature images are left
 * on the rental: repeating two 400 KB data URLs in every
 * approved version would push the document towards the
 * Firestore size limit for no gain, so the snapshot keeps
 * who accepted it and how.
 */
function approvedAgreementSnapshot(
  rental: Record<string, unknown>,
): Record<string, unknown> {
  const agreement = (rental.agreement ??
    {}) as Record<string, unknown>;

  const waiverInput = (agreement.waivers ??
    {}) as Record<string, unknown>;

  const chargeInput = (agreement.charges ??
    {}) as Record<string, unknown>;

  const driver = (agreement.additionalDriver ??
    null) as Record<string, unknown> | null;

  const waivers: Record<string, boolean> = {};

  for (const key of WAIVER_KEYS) {
    waivers[key] = waiverInput[key] === true;
  }

  const charges: Record<string, number> = {};

  let chargeTotalCents = 0;

  for (const key of CHARGE_KEYS) {
    const cents = Number(
      chargeInput[key] ?? 0,
    );

    charges[key] = Number.isFinite(cents)
      ? cents
      : 0;

    chargeTotalCents += charges[key];
  }

  return {
    dateOut: toIso(rental.pickupAt),

    dateIn: toIso(rental.expectedReturnAt),

    actualTimeIn:
      rental.actualReturnAt == null
        ? null
        : toIso(rental.actualReturnAt),

    odometerOut:
      rental.pickupOdometerValue == null
        ? null
        : {
            value: Number(
              rental.pickupOdometerValue,
            ),
            unit: String(
              rental.pickupOdometerUnit ?? "km",
            ),
          },

    odometerIn:
      rental.returnOdometerValue == null
        ? null
        : {
            value: Number(
              rental.returnOdometerValue,
            ),
            unit: String(
              rental.returnOdometerUnit ?? "km",
            ),
          },

    gasOut: fuelToGas(rental.pickupFuelLevel),

    gasIn: fuelToGas(rental.returnFuelLevel),

    extraHours: Number(
      agreement.extraHours ?? 0,
    ),

    depositCents: Number(
      agreement.depositCents ?? 0,
    ),

    waivers,

    charges,

    chargeTotalCents,

    paymentMethod: trimmedOrNull(
      agreement.paymentMethod,
    ),

    paymentReferenceLast4: trimmedOrNull(
      agreement.paymentReferenceLast4,
    ),

    paymentHolderName: trimmedOrNull(
      agreement.paymentHolderName,
    ),

    specialInstructions: trimmedOrNull(
      rental.checkoutNotes,
    ),

    additionalDriver: driver
      ? {
          fullName: String(
            driver.fullName ?? "",
          ),
          address: trimmedOrNull(driver.address),
          state: trimmedOrNull(driver.state),
          localAddress: trimmedOrNull(
            driver.localAddress,
          ),
          dateOfBirth: trimmedOrNull(
            driver.dateOfBirth,
          ),
          licenceNumber: trimmedOrNull(
            driver.licenceNumber,
          ),
          licenceExpiresAt: trimmedOrNull(
            driver.licenceExpiresAt,
          ),
          telephone: trimmedOrNull(
            driver.telephone,
          ),
        }
      : null,

    checkedOutBy: String(
      rental.checkedOutByNameSnapshot ?? "",
    ),

    /* What the renter signed for, drawn on the outlines. */
    damageMarks: sanitizeDamageMarks(
      rental.checkoutDamageMarks,
    ),
  };
}

function agreementRecord(
  input: Partial<AgreementInput>,
): Record<string, unknown> {
  const signatureDataUrl = trimmedOrNull(
    input.customerSignatureDataUrl,
  );

  const signatureName = trimmedOrNull(
    input.customerSignatureName,
  );

  if (!signatureDataUrl && !signatureName) {
    throw new Error(
      "Capture the renter's signature, or type their name, before completing the checkout.",
    );
  }

  if (
    signatureDataUrl &&
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(
      signatureDataUrl,
    )
  ) {
    throw new Error(
      "The captured signature could not be read. Clear it and sign again.",
    );
  }

  if (
    signatureDataUrl &&
    signatureDataUrl.length > 400_000
  ) {
    throw new Error(
      "The captured signature is too large. Clear it and sign again.",
    );
  }

  const driverSignatureDataUrl = trimmedOrNull(
    input.additionalDriverSignatureDataUrl,
  );

  if (
    driverSignatureDataUrl &&
    (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(
      driverSignatureDataUrl,
    ) ||
      driverSignatureDataUrl.length > 400_000)
  ) {
    throw new Error(
      "The additional driver's signature could not be read. Clear it and sign again.",
    );
  }

  const driver = (input.additionalDriver ??
    {}) as Record<string, unknown>;

  const additionalDriverName = trimmedOrNull(
    driver.fullName,
  );

  const waiverInput = (input.waivers ??
    {}) as Record<string, unknown>;

  const waivers: Record<string, boolean> = {};

  for (const key of WAIVER_KEYS) {
    waivers[key] = waiverInput[key] === true;
  }

  const chargeInput = (input.charges ??
    {}) as Record<string, unknown>;

  const charges: Record<string, number> = {};

  let chargeTotalCents = 0;

  for (const key of CHARGE_KEYS) {
    const cents = assertMoneyCents(
      chargeInput[key] ?? 0,
      "Charge amount",
    );

    charges[key] = cents;
    chargeTotalCents += cents;
  }

  assertMoneyCents(
    chargeTotalCents,
    "Agreement total",
  );

  const method = trimmedOrNull(
    input.paymentMethod,
  );

  if (
    method &&
    !(PAYMENT_METHODS as readonly string[]).includes(
      method,
    )
  ) {
    throw new Error(
      "Select a valid payment method.",
    );
  }

  const last4 = trimmedOrNull(
    input.paymentReferenceLast4,
  );

  if (last4 && !/^[0-9]{4}$/.test(last4)) {
    throw new Error(
      "Record only the last four digits of the card or check number.",
    );
  }

  const extraHours = Number(
    input.extraHours ?? 0,
  );

  if (
    !Number.isFinite(extraHours) ||
    extraHours < 0 ||
    extraHours > 999
  ) {
    throw new Error(
      "Extra hours must be a whole number of hours.",
    );
  }

  return {
    customerSignatureDataUrl: signatureDataUrl,

    customerSignatureName: signatureName,

    customerSignatureMethod: signatureDataUrl
      ? "drawn"
      : "typed",

    additionalDriverSignatureDataUrl:
      driverSignatureDataUrl,

    additionalDriverSignatureName:
      trimmedOrNull(
        input.additionalDriverSignatureName,
      ),

    additionalDriver: additionalDriverName
      ? {
          fullName: additionalDriverName,
          address: trimmedOrNull(driver.address),
          state: trimmedOrNull(driver.state),
          dateOfBirth: trimmedOrNull(
            driver.dateOfBirth,
          ),
          licenceNumber: trimmedOrNull(
            driver.licenceNumber,
          ),
          licenceExpiresAt: trimmedOrNull(
            driver.licenceExpiresAt,
          ),
          telephone: trimmedOrNull(
            driver.telephone,
          ),
          localAddress: trimmedOrNull(
            driver.localAddress,
          ),
        }
      : null,

    waivers,

    depositCents: assertMoneyCents(
      input.depositCents ?? 0,
      "Deposit",
    ),

    paymentMethod: method,

    paymentReferenceLast4: last4,

    paymentCardHolder: trimmedOrNull(
      input.paymentCardHolder,
    ),

    charges,

    chargeTotalCents,

    specialInstructions: trimmedOrNull(
      input.specialInstructions,
    ),

    extraHours: Math.trunc(extraHours),

    capturedAt: nowTimestamp(),
  };
}

async function checkoutReservation(
  input: {
    reservationId: string;
    pickupFuelLevel: string;
    pickupOdometer: {
      value: number;
      unit: "km" | "mi";
    };
    notes: string | null;
    checkoutMedia?: Array<Record<string, unknown>>;
    /* Scratches, dents and the rest, marked on the drawings. */
    damageMarks?: unknown;
    /*
     * A discount offered at the counter. An administrator's
     * comes off the balance at once; anyone else's waits for
     * an administrator, exactly as it does on the Payment tab.
     */
    discount?: {
      amountCents: number;
      reason: string;
    } | null;
    /*
     * Money taken at the counter towards the rental, by the
     * method chosen on the agreement. Whatever is not taken
     * stays on the rental as its balance due.
     */
    paidNowCents?: number | null;
  } & Partial<AgreementInput>,
): Promise<{
  rentalId: string;
  outstandingCents: number;
  discountStatus: DiscountStatus | null;
  paidNowCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  /*
   * The signature and the condition photos are taken here now,
   * not at booking: this is the moment the renter is at the
   * counter with the car in front of them, and it is what the
   * agreement they sign has to describe.
   */
  const agreement = agreementRecord(input);

  /*
   * The daily, weekly and monthly rows restate the booking's
   * own quote, which the rental already carries as its base.
   * Only the rest of the table is new money, so only the rest
   * is added to the balance; counting the whole table would
   * charge the rental days twice.
   */
  const agreementCharges = agreement.charges as Record<
    string,
    number
  >;

  const agreementAdjustmentCents = [
    "extraHours",
    "fuel",
    "detailing",
    "liabilityWaiver",
    "windscreenWaiver",
    "insurance",
    "carSeat",
    "other",
  ].reduce(
    (sum, key) =>
      sum + Number(agreementCharges[key] ?? 0),
    0,
  );

  const checkoutMedia = sanitizeMediaList(
    input.checkoutMedia,
  );

  const damageMarks = sanitizeDamageMarks(
    input.damageMarks,
    { strict: true },
  );

  const discountCents = assertMoneyCents(
    input.discount?.amountCents ?? 0,
    "Discount amount",
  );

  const discountReason = trimmedOrNull(
    input.discount?.reason,
  );

  if (discountCents > 0 && !discountReason) {
    throw new Error(
      "Say why the discount is being offered.",
    );
  }

  if (
    discountReason &&
    discountReason.length > 500
  ) {
    throw new Error(
      "Keep the discount reason under 500 characters.",
    );
  }

  const paidNowCents = assertMoneyCents(
    input.paidNowCents ?? 0,
    "Amount paid now",
  );

  /*
   * The agreement's own Cash / Check / Credit card choice is
   * how the money was taken, so a payment needs one.
   */
  const paidNowMethod = (() => {
    switch (agreement.paymentMethod) {
      case "cash":
        return "cash";
      case "check":
        return "check";
      case "credit":
        return "card";
      default:
        return null;
    }
  })();

  if (paidNowCents > 0 && !paidNowMethod) {
    throw new Error(
      "Choose how the renter is paying — cash, check or credit card — before recording the amount paid now.",
    );
  }

  /*
   * The employee may record the odometer in kilometres or
   * miles. Only the converted kilometre value is treated as
   * canonical; the entered number and its unit are kept
   * alongside it so the reading can be shown exactly as it
   * was taken, and so the return comparison never converts
   * an already-converted value a second time.
   */
  const pickupOdometer =
    odometerToKm(
      input.pickupOdometer,
    );

  const pickupFuelLevel =
    assertFuelLevel(
      input.pickupFuelLevel,
    );

  const reservationRef =
    doc(
      db,
      "reservations",
      String(
        input.reservationId,
      ),
    );

  const rentalRef =
    doc(
      collection(
        db,
        "rentals",
      ),
    );

  const discountRef = doc(
    collection(db, "rentalDiscounts"),
  );

  const paymentRef = doc(
    collection(db, "payments"),
  );

  let outstandingAfterCheckout = 0;

  let discountStatus: DiscountStatus | null =
    null;

  await runTransaction(
    db,
    async (transaction) => {
      const reservationSnapshot =
        await transaction.get(
          reservationRef,
        );

      if (
        !reservationSnapshot.exists()
      ) {
        throw new Error(
          "Reservation was not found.",
        );
      }

      const reservation =
        reservationSnapshot.data();

      if (
        reservation.status !==
        "confirmed"
      ) {
        throw new Error(
          "Reservation cannot be checked out.",
        );
      }

      const vehicleRef =
        doc(
          db,
          "vehicles",
          String(
            reservation.vehicleId,
          ),
        );

      const vehicleSnapshot =
        await transaction.get(
          vehicleRef,
        );

      const checkedOutByNameSnapshot =
        await actorNameSnapshot(
          transaction,
          actorUid,
        );

      const actor =
        discountCents > 0
          ? await actorProfileSnapshot(
              transaction,
              actorUid,
            )
          : null;

      if (
        !vehicleSnapshot.exists()
      ) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      if (
        vehicleSnapshot.get(
          "status",
        ) !== "reserved"
      ) {
        throw new Error(
          "Vehicle is no longer ready for checkout.",
        );
      }

      const baseRentalCents =
        assertMoneyCents(
          reservation.quote
            ?.baseRentalCents,
          "Booking total",
        );

      const vehicleRegistration =
        String(
          reservation.vehicleRegistrationSnapshot ??
            vehicleSnapshot.get(
              "registrationNumber",
            ) ??
            "",
        );

      const financialRef =
        doc(
          db,
          "rentalFinancials",
          rentalRef.id,
        );

      const owedBeforeDiscountCents =
        baseRentalCents +
        agreementAdjustmentCents;

      /*
       * A discount can only forgive what is owed, and the
       * money taken now cannot be more than is left once it
       * is applied — a waiting discount included, or its
       * approval would find nothing left to forgive.
       */
      if (
        discountCents >
        owedBeforeDiscountCents
      ) {
        throw new Error(
          `The discount is more than the ${formatCents(
            owedBeforeDiscountCents,
          )} owed on this rental.`,
        );
      }

      if (
        paidNowCents >
        owedBeforeDiscountCents -
          discountCents
      ) {
        throw new Error(
          `The amount paid now is more than the ${formatCents(
            owedBeforeDiscountCents -
              discountCents,
          )} owed on this rental. The deposit is recorded separately.`,
        );
      }

      discountStatus =
        discountCents > 0
          ? actor?.role === "admin"
            ? "approved"
            : "pending"
          : null;

      const appliedDiscountCents =
        discountStatus === "approved"
          ? discountCents
          : 0;

      const openingAdjustmentCents =
        agreementAdjustmentCents -
        appliedDiscountCents;

      const openingTotalCents =
        baseRentalCents +
        openingAdjustmentCents;

      outstandingAfterCheckout =
        openingTotalCents - paidNowCents;

      transaction.set(
        rentalRef,
        {
          ...reservation,

          reservationId:
            reservationRef.id,

          status: "active",

          pickupFuelLevel,

          pickupOdometerKm:
            pickupOdometer.km,

          pickupOdometerValue:
            pickupOdometer.value,

          pickupOdometerUnit:
            pickupOdometer.unit,

          checkoutNotes:
            trimmedOrNull(
              input.notes,
            ),

          agreement,

          checkoutMedia,

          checkoutDamageMarks:
            damageMarks,

          actualReturnAt:
            null,

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),

          checkedOutBy:
            actorUid,

          checkedOutByNameSnapshot,
        },
      );

      transaction.set(
        financialRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            String(
              reservation.vehicleId,
            ),

          vehicleRegistration,

          customerId:
            String(
              reservation.customerId,
            ),

          customerNameSnapshot:
            String(
              reservation.customerNameSnapshot ??
                "",
            ),

          rentalStatus:
            "active",

          pickupAt:
            reservation.pickupAt,

          baseRentalCents,

          /*
           * The agreement's charge rows — waivers, insurance,
           * detailing and the rest — are part of what the
           * renter signs for, so they land on the balance as
           * adjustments rather than being printed on the form
           * and then forgotten by the till.
           */
          adjustmentCents:
            openingAdjustmentCents,

          totalCents:
            openingTotalCents,

          paidCents: paidNowCents,

          refundedCents: 0,

          refundedPaymentCents:
            0,

          /*
           * The renter pays the deposit at the counter, so
           * the record has to say what is being held. It is
           * refundable and therefore never part of the
           * rental total: it is tracked beside it, and the
           * balance the till collects is the total plus
           * whatever is still to be lodged as a deposit.
           */
          depositHeldCents:
            Number(
              agreement.depositCents ?? 0,
            ),

          refundedDepositCents:
            0,

          outstandingCents:
            outstandingAfterCheckout,

          currency:
            "USD",

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        reservationRef,
        {
          status:
            "checked_out",

          rentalId:
            rentalRef.id,

          updatedAt:
            nowTimestamp(),
        },
      );

      /*
       * The vehicle carries its damage from one hire to the
       * next, so the next checkout starts from what this one
       * recorded.
       */
      transaction.update(
        vehicleRef,
        {
          status:
            "rented",

          damageMarks,

          damageUpdatedAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            String(
              reservation.vehicleId,
            ),

          vehicleRegistration,

          customerId:
            String(
              reservation.customerId,
            ),

          entryType:
            "rental_checkout",

          amountCents:
            baseRentalCents,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      /*
       * A deposit is money held, not money earned, so it is
       * recorded at zero value against the period's revenue
       * and carries its own amount for the desk to refund
       * against.
       */
      const depositCents = Number(
        agreement.depositCents ?? 0,
      );

      if (depositCents > 0) {
        transaction.set(
          doc(
            collection(
              db,
              "financialLedger",
            ),
          ),
          {
            rentalId:
              rentalRef.id,

            vehicleId:
              String(
                reservation.vehicleId,
              ),

            vehicleRegistration,

            customerId:
              String(
                reservation.customerId,
              ),

            entryType:
              "deposit_held",

            amountCents: 0,

            depositCents,

            occurredAt:
              nowTimestamp(),

            recordedBy:
              actorUid,
          },
        );
      }

      if (discountStatus && actor) {
        transaction.set(discountRef, {
          rentalId: rentalRef.id,
          customerNameSnapshot: String(
            reservation.customerNameSnapshot ??
              "",
          ),
          vehicleRegistrationSnapshot:
            vehicleRegistration,
          amountCents: discountCents,
          reason: discountReason,
          status: discountStatus,
          offeredAt: "checkout",
          requestedBy: actorUid,
          requestedByNameSnapshot: actor.name,
          requestedAt: nowTimestamp(),

          /* An administrator's own discount is its own approval. */
          reviewedBy:
            discountStatus === "approved"
              ? actorUid
              : null,
          reviewedByNameSnapshot:
            discountStatus === "approved"
              ? actor.name
              : null,
          reviewedAt:
            discountStatus === "approved"
              ? nowTimestamp()
              : null,
          reviewNote: null,
          updatedAt: nowTimestamp(),
        });

        if (discountStatus === "approved") {
          transaction.set(
            doc(
              collection(
                db,
                "financialLedger",
              ),
            ),
            {
              rentalId: rentalRef.id,
              vehicleId: String(
                reservation.vehicleId,
              ),
              vehicleRegistration,
              customerId: String(
                reservation.customerId,
              ),
              entryType: "rental_discount",
              adjustmentType: "discount",
              amountCents: -discountCents,
              discountId: discountRef.id,
              note: discountReason,
              occurredAt: nowTimestamp(),
              recordedBy: actorUid,
            },
          );
        }

        transaction.set(
          doc(collection(db, "auditLogs")),
          {
            actorUid,
            action:
              discountStatus === "approved"
                ? "discount.applied"
                : "discount.requested",
            resource: {
              collection: "rentalDiscounts",
              id: discountRef.id,
            },
            details: {
              rentalId: rentalRef.id,
              amountCents: discountCents,
              offeredAt: "checkout",
            },
            createdAt: nowTimestamp(),
          },
        );
      }

      if (paidNowCents > 0) {
        transaction.set(paymentRef, {
          rentalId: rentalRef.id,

          amountCents: paidNowCents,

          additionalFees: [],

          method: paidNowMethod,

          externalReference:
            agreement.paymentReferenceLast4
              ? `Ending ${String(
                  agreement.paymentReferenceLast4,
                )}`
              : null,

          /* The checkout itself can only happen once. */
          idempotencyKey: `checkout_${rentalRef.id}`,

          takenAt: "checkout",

          recordedBy: actorUid,

          occurredAt: nowTimestamp(),
        });

        transaction.set(
          doc(
            collection(
              db,
              "financialLedger",
            ),
          ),
          {
            rentalId: rentalRef.id,

            vehicleId: String(
              reservation.vehicleId,
            ),

            vehicleRegistration,

            customerId: String(
              reservation.customerId,
            ),

            entryType: "payment",

            amountCents: paidNowCents,

            paymentId: paymentRef.id,

            occurredAt: nowTimestamp(),

            recordedBy: actorUid,
          },
        );
      }
    },
  );

  return {
    rentalId:
      rentalRef.id,

    outstandingCents:
      outstandingAfterCheckout,

    discountStatus,

    paidNowCents,
  };
}

/* =========================================================
   Extend rental
   ========================================================= */

async function extendRental(
  input: {
    rentalId: string;
    expectedReturnAt: string;
    note: string;
    idempotencyKey: string;
  },
): Promise<{
  extensionCents: number;
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const rentalRef =
    doc(
      db,
      "rentals",
      input.rentalId,
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      input.rentalId,
    );

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `extension_${input.idempotencyKey}`,
    );

  let response:
    | {
        extensionCents: number;
        outstandingCents: number;
      }
    | undefined;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists()) {
        response =
          previous.get(
            "response",
          ) as {
            extensionCents: number;
            outstandingCents: number;
          };

        return;
      }

      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      if (
        !rentalSnapshot.exists() ||
        !financialSnapshot.exists()
      ) {
        throw new Error(
          "Rental was not found.",
        );
      }

      const rental =
        rentalSnapshot.data();

      const financial =
        financialSnapshot.data();

      if (
        ![
          "active",
          "overdue",
        ].includes(
          String(
            rental.status,
          ),
        )
      ) {
        throw new Error(
          "Only active or overdue rentals can be extended.",
        );
      }

      const currentExpectedReturn =
        asTimestamp(
          toIso(
            rental.expectedReturnAt,
          ),
        );

      const newExpectedReturn =
        asTimestamp(
          input.expectedReturnAt,
        );

      if (
        newExpectedReturn.toMillis() <=
        currentExpectedReturn.toMillis()
      ) {
        throw new Error(
          "The extension must be later than the current expected return.",
        );
      }

      /*
       * Extending through a later booking would leave the next
       * checkout with a vehicle that is still out, so the same
       * overlap search the booking screen uses runs here too,
       * ignoring this rental's own reservation.
       */
      const conflictId =
        await overlappingReservation({
          vehicleId:
            String(
              rental.vehicleId,
            ),

          from: currentExpectedReturn,
          to: newExpectedReturn,

          ignoreReservationId:
            String(
              rental.reservationId ?? "",
            ),
        });

      if (conflictId) {
        throw new Error(
          "The vehicle is reserved again before that date. Shorten the extension or move the other booking.",
        );
      }

      const updatedQuote =
        quoteRental(
          {
            pickupAt:
              toIso(
                rental.pickupAt,
              ),

            expectedReturnAt:
              input.expectedReturnAt,
          },

          rental.rateSnapshot,
        );

      const extensionCents =
        updatedQuote.baseRentalCents -
        Number(
          financial.baseRentalCents ??
            0,
        );

      if (
        extensionCents <= 0
      ) {
        throw new Error(
          "The extension does not change the rental total.",
        );
      }

      const totalCents =
        Number(
          financial.totalCents ??
            0,
        ) +
        extensionCents;

      if (
        !Number.isFinite(totalCents) ||
        totalCents > MAX_MONEY_CENTS
      ) {
        throw new Error(
          "This extension would take the rental past the permitted total.",
        );
      }

      const outstandingCents =
        calculateBalance(
          Math.round(totalCents),

          assertMoneyCents(
            financial.paidCents ?? 0,
            "Amount received",
          ),

          assertMoneyCents(
            financial.refundedCents ??
              0,
            "Amount refunded",
          ),
        );

      response = {
        extensionCents,
        outstandingCents,
      };

      transaction.update(
        rentalRef,
        {
          expectedReturnAt:
            newExpectedReturn,

          quote:
            updatedQuote,

          updatedAt:
            nowTimestamp(),
        },
      );

      const reservationRef =
        doc(
          db,
          "reservations",
          String(
            rental.reservationId,
          ),
        );

      transaction.update(
        reservationRef,
        {
          expectedReturnAt:
            newExpectedReturn,

          quote:
            updatedQuote,

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.set(
        doc(
          db,
          "rentals",
          input.rentalId,
          "extensions",
          input.idempotencyKey,
        ),

        {
          previousExpectedReturnAt:
            currentExpectedReturn,

          expectedReturnAt:
            newExpectedReturn,

          extensionCents,

          note:
            input.note,

          recordedBy:
            actorUid,

          recordedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          baseRentalCents:
            updatedQuote
              .baseRentalCents,

          totalCents,

          outstandingCents,

          updatedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            rental.vehicleId,

          vehicleRegistration:
            rental.vehicleRegistrationSnapshot,

          customerId:
            rental.customerId,

          entryType:
            "rental_extension",

          amountCents:
            extensionCents,

          note:
            input.note,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response,

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return response!;
}

/* =========================================================
   Return
   ========================================================= */

async function returnRental(
  input: {
    rentalId: string;
    actualReturnAt: string;
    returnFuelLevel: string;
    returnOdometer: {
      value: number;
      unit: "km" | "mi";
    };
    adjustments: Array<{
      type: string;
      amountCents: number;
      note: string;
    }>;
    /*
     * The waivers taken and the hours run over are settled
     * when the vehicle comes back, so they are recorded here
     * and merged into the stored agreement rather than
     * guessed at the counter.
     */
    waivers?: Record<string, unknown> | null;
    extraHours?: number | null;
    notes: string | null;
    returnMedia: Array<Record<string, unknown>>;
    /*
     * The damage on the vehicle as it came back: what it went
     * out with, less anything found to be wrong, plus anything
     * new. Left out, the checkout's marks stand.
     */
    damageMarks?: unknown;
  },
): Promise<{
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  /*
   * Everything that can be judged without reading the rental
   * is validated before the transaction opens, so a bad entry
   * fails fast and never leaves a partially applied return.
   */
  const returnOdometer =
    odometerToKm(
      input.returnOdometer,
    );

  const returnFuelLevel =
    assertFuelLevel(
      input.returnFuelLevel,
    );

  const returnNotes =
    trimmedOrNull(
      input.notes,
    );

  const returnMedia =
    sanitizeMediaList(
      input.returnMedia,
    );

  const returnDamageMarks =
    input.damageMarks === undefined
      ? null
      : sanitizeDamageMarks(
          input.damageMarks,
          { strict: true },
        );

  const adjustments =
    (Array.isArray(
      input.adjustments,
    )
      ? input.adjustments
      : []
    ).map(
      (adjustment) => ({
        type:
          String(
            adjustment?.type ?? "",
          ).trim(),

        amountCents:
          assertMoneyCents(
            adjustment?.amountCents,
            "Adjustment amount",
          ),

        note:
          trimmedOrNull(
            adjustment?.note,
          ) ??
          "Return adjustment",
      }),
    );

  if (
    adjustments.some(
      (adjustment) =>
        !adjustment.type,
    )
  ) {
    throw new Error(
      "Select an adjustment type.",
    );
  }

  const waiverInput = (input.waivers ??
    {}) as Record<string, unknown>;

  const returnWaivers: Record<
    string,
    boolean
  > = {};

  for (const key of WAIVER_KEYS) {
    returnWaivers[key] =
      waiverInput[key] === true;
  }

  const extraHours = Number(
    input.extraHours ?? 0,
  );

  if (
    !Number.isFinite(extraHours) ||
    extraHours < 0 ||
    extraHours > 999
  ) {
    throw new Error(
      "Extra hours must be a whole number of hours.",
    );
  }

  const rentalRef =
    doc(
      db,
      "rentals",
      String(
        input.rentalId,
      ),
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      String(
        input.rentalId,
      ),
    );

  let outstandingCents = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      if (
        !rentalSnapshot.exists() ||
        !financialSnapshot.exists()
      ) {
        throw new Error(
          "Rental was not found.",
        );
      }

      const rental =
        rentalSnapshot.data();

      const financial =
        financialSnapshot.data();

      /*
       * Checkout marks the reservation "checked_out", and the
       * conflict search treats that as still holding the
       * vehicle. Nothing used to clear it, so once a car had
       * been rented its booking blocked that window for good:
       * returning a car early, in particular, left the vehicle
       * unbookable until the original expected return had
       * passed. The reservation is closed here, in the same
       * transaction that closes the rental.
       *
       * Read before any write, as a transaction requires.
       */
      const reservationId = trimmedOrNull(
        rental.reservationId,
      );

      const reservationRef = reservationId
        ? doc(
            db,
            "reservations",
            reservationId,
          )
        : null;

      const reservationSnapshot =
        reservationRef
          ? await transaction.get(
              reservationRef,
            )
          : null;

      /*
       * Re-reading the status inside the transaction is what
       * makes a repeated submission safe: the second attempt
       * sees "returned" and aborts instead of applying the
       * adjustments twice.
       */
      if (
        ![
          "active",
          "overdue",
        ].includes(
          String(
            rental.status,
          ),
        )
      ) {
        throw new Error(
          "Only active or overdue rentals can be returned.",
        );
      }

      /*
       * Read before any write: a Firestore transaction
       * refuses a read once it has started writing, and the
       * rental update below is the first one.
       */
      const returnedBy =
        await actorProfileSnapshot(
          transaction,
          actorUid,
        );

      const returnedByNameSnapshot =
        returnedBy.name;

      /*
       * A discount needs an administrator's say-so. Anyone
       * else offers one from the payment screen, where it
       * waits for approval instead of coming straight off.
       */
      if (
        returnedBy.role !== "admin" &&
        adjustments.some(
          (adjustment) =>
            adjustment.type === "discount" &&
            adjustment.amountCents > 0,
        )
      ) {
        throw new Error(
          "A discount needs an administrator's approval. Complete the return, then request it on the Payment tab.",
        );
      }

      const actualReturnAt =
        asTimestamp(
          input.actualReturnAt,
        );

      if (
        actualReturnAt.toMillis() <
        asTimestamp(
          toIso(
            rental.pickupAt,
          ),
        ).toMillis()
      ) {
        throw new Error(
          "Actual return cannot be before pickup.",
        );
      }

      if (
        returnOdometer.km <
        Number(
          rental.pickupOdometerKm ??
            0,
        )
      ) {
        throw new Error(
          "Return odometer cannot be lower than pickup odometer.",
        );
      }

      const totalAdjustment =
        adjustments.reduce(
          (
            total,
            adjustment,
          ) =>
            adjustment.type ===
            "discount"
              ? total -
                adjustment.amountCents
              : total +
                adjustment.amountCents,
          0,
        );

      const adjustmentCents =
        Number(
          financial.adjustmentCents ??
            0,
        ) +
        totalAdjustment;

      const totalCents =
        Number(
          financial.baseRentalCents ??
            0,
        ) +
        adjustmentCents;

      if (
        !Number.isFinite(
          totalCents,
        ) ||
        totalCents < 0 ||
        totalCents > MAX_MONEY_CENTS
      ) {
        throw new Error(
          "Adjustments produce an invalid rental total.",
        );
      }

      outstandingCents =
        calculateBalance(
          Math.round(
            totalCents,
          ),
          assertMoneyCents(
            financial.paidCents ?? 0,
            "Amount received",
          ),
          assertMoneyCents(
            financial.refundedCents ??
              0,
            "Amount refunded",
          ),
        );

      const vehicleId =
        trimmedOrNull(
          rental.vehicleId,
        );

      if (!vehicleId) {
        throw new Error(
          "This rental is not linked to a vehicle.",
        );
      }

      const vehicleRegistration =
        String(
          rental.vehicleRegistrationSnapshot ??
            financial.vehicleRegistration ??
            "",
        );

      const customerId =
        String(
          rental.customerId ??
            financial.customerId ??
            "",
        );

      const checkoutDamage =
        sanitizeDamageMarks(
          rental.checkoutDamageMarks,
        );

      const checkoutDamageIds = new Set(
        checkoutDamage.map(
          (mark) => mark.id,
        ),
      );

      const damageAtReturn: DamageMark[] =
        returnDamageMarks ?? checkoutDamage;

      /*
       * Every value below is explicitly defined or null.
       * Firestore rejects an undefined field outright, which
       * previously aborted the whole return.
       */
      transaction.update(
        rentalRef,
        {
          status:
            "returned",

          actualReturnAt,

          returnFuelLevel,

          returnOdometerKm:
            returnOdometer.km,

          returnOdometerValue:
            returnOdometer.value,

          returnOdometerUnit:
            returnOdometer.unit,

          returnNotes,

          returnMedia,

          returnDamageMarks:
            damageAtReturn,

          newDamageCount:
            damageAtReturn.filter(
              (mark) =>
                !checkoutDamageIds.has(
                  mark.id,
                ),
            ).length,

          adjustments,

          /*
           * The agreement is rebuilt from the rental every
           * time it is opened, so recording the waivers and
           * the overrun here puts them on the printed copy.
           * An approved contract snapshot is a separate,
           * immutable document and is untouched.
           */
          agreement: {
            ...((rental.agreement ??
              {}) as Record<
              string,
              unknown
            >),

            waivers: returnWaivers,

            extraHours:
              Math.trunc(extraHours),
          },

          returnedBy:
            actorUid,

          returnedByNameSnapshot,

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          adjustmentCents,

          totalCents,

          outstandingCents,

          rentalStatus:
            "returned",

          actualReturnAt,

          updatedAt:
            nowTimestamp(),
        },
      );

      if (
        reservationRef &&
        reservationSnapshot?.exists()
      ) {
        transaction.update(
          reservationRef,
          {
            status: "completed",

            completedAt: actualReturnAt,

            updatedAt: nowTimestamp(),
          },
        );
      }

      /*
       * A returned vehicle always goes to cleaning before it
       * can be offered again, which is also the only valid
       * transition out of rented or overdue.
       */
      transaction.update(
        doc(
          db,
          "vehicles",
          vehicleId,
        ),
        {
          status:
            "cleaning",

          statusNote:
            "Awaiting cleaning and detailing after return.",

          damageMarks:
            damageAtReturn,

          damageUpdatedAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      for (
        const adjustment of
        adjustments
      ) {
        if (
          adjustment.amountCents <=
          0
        ) {
          continue;
        }

        const ledgerRef =
          doc(
            collection(
              db,
              "financialLedger",
            ),
          );

        transaction.set(
          ledgerRef,
          {
            rentalId:
              rentalRef.id,

            vehicleId,

            vehicleRegistration,

            customerId,

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
              nowTimestamp(),

            recordedBy:
              actorUid,
          },
        );
      }
    },
  );

  return {
    outstandingCents,
  };
}

/* =========================================================
   Payment
   ========================================================= */

/*
 * What can be added to a payment on top of the rental.
 *
 * Which of them belong to which end of the hire is a matter
 * for the till — the insurance and the car seats are settled
 * at checkout, and an extension, the cleaning and the
 * refuelling at return — but all of them can legitimately be
 * collected late, so the list is not split here.
 *
 * The deposit is deliberately absent. It is taken at the
 * counter and held rather than earned, so it is recorded on
 * the agreement as `depositHeldCents` and never raises the
 * rental total; charging it here would turn refundable money
 * into revenue and count it twice.
 */
const ADDITIONAL_FEE_TYPES = [
  "car_seat",
  "insurance",
  "extension",
  "cleaning",
  "smoke_fee",
  "refueling",
] as const;

export type AdditionalFeeType =
  (typeof ADDITIONAL_FEE_TYPES)[number];

async function recordRentalPayment(
  input: {
    rentalId: string;
    amountCents: number;
    method: string;
    externalReference:
      | string
      | null;
    additionalFees?: Array<{
      type: string;
      amountCents: number;
    }>;
    idempotencyKey: string;
  },
): Promise<{
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const amountCents =
    assertMoneyCents(
      input.amountCents,
      "Payment amount",
    );

  if (amountCents <= 0) {
    throw new Error(
      "Payment amount must be greater than zero.",
    );
  }

  const additionalFees =
    (Array.isArray(
      input.additionalFees,
    )
      ? input.additionalFees
      : []
    ).map(
      (fee) => {
        const type =
          String(
            fee?.type ?? "",
          ).trim();

        if (
          !(
            ADDITIONAL_FEE_TYPES as readonly string[]
          ).includes(type)
        ) {
          throw new Error(
            "An unsupported additional fee was submitted.",
          );
        }

        const feeCents =
          assertMoneyCents(
            fee?.amountCents,
            "Additional fee amount",
          );

        if (feeCents <= 0) {
          throw new Error(
            "Additional fee amounts must be greater than zero.",
          );
        }

        return {
          type: type as AdditionalFeeType,
          amountCents: feeCents,
        };
      },
    );

  if (
    new Set(
      additionalFees.map(
        (fee) => fee.type,
      ),
    ).size !== additionalFees.length
  ) {
    throw new Error(
      "Each additional fee can only be selected once.",
    );
  }

  const additionalFeesCents =
    additionalFees.reduce(
      (sum, fee) =>
        sum + fee.amountCents,
      0,
    );

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `payment_${input.idempotencyKey}`,
    );

  const paymentRef =
    doc(
      collection(db, "payments"),
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      String(
        input.rentalId,
      ),
    );

  let outstandingCents = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      /*
       * A repeated submission replays the stored result
       * instead of charging the customer a second time.
       */
      if (previous.exists()) {
        const previousResponse =
          previous.get(
            "response",
          ) as {
            outstandingCents: number;
          };

        outstandingCents =
          Number(
            previousResponse
              ?.outstandingCents ?? 0,
          );

        return;
      }

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      const rentalRef =
        doc(
          db,
          "rentals",
          String(
            input.rentalId,
          ),
        );

      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      if (
        !financialSnapshot.exists() ||
        !rentalSnapshot.exists()
      ) {
        throw new Error(
          "Rental financial record was not found.",
        );
      }

      const financial =
        financialSnapshot.data();

      const rental =
        rentalSnapshot.data();

      const paidCents =
        assertMoneyCents(
          financial.paidCents ?? 0,
          "Amount received",
        ) + amountCents;

      /*
       * Additional fees raise what the rental is worth, so
       * they are added to the invoiced total once, here, and
       * nowhere else. The return workflow recomputes the
       * total from baseRentalCents plus adjustmentCents, so
       * keeping both in step prevents a fee being counted a
       * second time when the vehicle comes back.
       */
      const adjustmentCents =
        Number(
          financial.adjustmentCents ??
            0,
        ) + additionalFeesCents;

      const totalCents =
        Number(
          financial.totalCents ?? 0,
        ) + additionalFeesCents;

      if (
        !Number.isFinite(
          totalCents,
        ) ||
        totalCents > MAX_MONEY_CENTS
      ) {
        throw new Error(
          "Additional fees exceed the permitted rental total.",
        );
      }

      outstandingCents =
        calculateBalance(
          Math.round(
            totalCents,
          ),
          paidCents,
          assertMoneyCents(
            financial.refundedCents ??
              0,
            "Amount refunded",
          ),
        );

      const vehicleId =
        String(
          financial.vehicleId ??
            rental.vehicleId ??
            "",
        );

      const vehicleRegistration =
        String(
          financial.vehicleRegistration ??
            rental.vehicleRegistrationSnapshot ??
            "",
        );

      const customerId =
        String(
          financial.customerId ??
            rental.customerId ??
            "",
        );

      transaction.set(
        paymentRef,
        {
          rentalId:
            String(
              input.rentalId,
            ),

          amountCents,

          additionalFees,

          method:
            String(
              input.method ?? "other",
            ),

          externalReference:
            trimmedOrNull(
              input.externalReference,
            ),

          idempotencyKey:
            String(
              input.idempotencyKey,
            ),

          recordedBy:
            actorUid,

          occurredAt:
            nowTimestamp(),
        },
      );

      for (
        const fee of additionalFees
      ) {
        transaction.set(
          doc(
            collection(
              db,
              "financialLedger",
            ),
          ),
          {
            rentalId:
              String(
                input.rentalId,
              ),

            vehicleId,

            vehicleRegistration,

            customerId,

            entryType:
              "rental_fee",

            feeType:
              fee.type,

            amountCents:
              fee.amountCents,

            paymentId:
              paymentRef.id,

            occurredAt:
              nowTimestamp(),

            recordedBy:
              actorUid,
          },
        );
      }

      transaction.update(
        financialRef,
        {
          paidCents,

          adjustmentCents,

          totalCents,

          outstandingCents,

          updatedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            String(
              input.rentalId,
            ),

          vehicleId,

          vehicleRegistration,

          customerId,

          entryType:
            "payment",

          amountCents,

          paymentId:
            paymentRef.id,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response: {
            outstandingCents,
          },

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    outstandingCents,
  };
}

/* =========================================================
   Discounts
   ========================================================= */

/*
 * A discount is offered at the end of the hire, when the
 * balance is being settled. An administrator's discount
 * comes off the balance at once; anyone else's is a request
 * that waits, untouched, until an administrator approves it.
 * Either way the request is kept, so every discount on the
 * books names who offered it and who allowed it.
 */
export type DiscountStatus =
  | "pending"
  | "approved"
  | "rejected";

export type RentalDiscount = {
  id: string;
  rentalId: string;
  customerName: string;
  vehicleRegistration: string;
  amountCents: number;
  reason: string;
  status: DiscountStatus;
  requestedByName: string;
  requestedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

function discountStatusOf(
  value: unknown,
): DiscountStatus {
  return value === "approved" ||
    value === "rejected"
    ? value
    : "pending";
}

function rentalDiscountFrom(
  id: string,
  data: Record<string, unknown>,
): RentalDiscount {
  return {
    id,
    rentalId: String(data.rentalId ?? ""),
    customerName: String(
      data.customerNameSnapshot ?? "",
    ),
    vehicleRegistration: String(
      data.vehicleRegistrationSnapshot ?? "",
    ),
    amountCents: Number(data.amountCents ?? 0),
    reason: String(data.reason ?? ""),
    status: discountStatusOf(data.status),
    requestedByName: String(
      data.requestedByNameSnapshot ?? "",
    ),
    requestedAt: data.requestedAt
      ? toIso(data.requestedAt)
      : null,
    reviewedByName: trimmedOrNull(
      data.reviewedByNameSnapshot,
    ),
    reviewedAt: data.reviewedAt
      ? toIso(data.reviewedAt)
      : null,
    reviewNote: trimmedOrNull(data.reviewNote),
  };
}

/*
 * Takes an approved discount off the rental's balance. It
 * lowers adjustmentCents as well as the total, because the
 * return recomputes the total from baseRentalCents plus
 * adjustmentCents, and a discount recorded in only one of
 * them would come back when the vehicle does.
 *
 * A discount can only forgive what is still owed: money
 * already taken is a refund, which is a separate decision.
 */
function applyDiscount(
  transaction: {
    update: (
      reference: ReturnType<typeof doc>,
      data: Record<string, unknown>,
    ) => unknown;
    set: (
      reference: ReturnType<typeof doc>,
      data: Record<string, unknown>,
    ) => unknown;
  },
  input: {
    rentalId: string;
    discountId: string;
    financial: Record<string, any>;
    amountCents: number;
    reason: string;
    actorUid: string;
  },
): number {
  const { db } = getFirebaseClient();

  const currentOutstanding = calculateBalance(
    Math.round(
      Number(input.financial.totalCents ?? 0),
    ),
    assertMoneyCents(
      input.financial.paidCents ?? 0,
      "Amount received",
    ),
    assertMoneyCents(
      input.financial.refundedCents ?? 0,
      "Amount refunded",
    ),
  );

  if (input.amountCents > currentOutstanding) {
    throw new Error(
      `The discount is more than the ${formatCents(
        Math.max(currentOutstanding, 0),
      )} still owed on this rental.`,
    );
  }

  const adjustmentCents =
    Number(
      input.financial.adjustmentCents ?? 0,
    ) - input.amountCents;

  const totalCents =
    Number(input.financial.totalCents ?? 0) -
    input.amountCents;

  const outstandingCents =
    currentOutstanding - input.amountCents;

  transaction.update(
    doc(db, "rentalFinancials", input.rentalId),
    {
      adjustmentCents,
      totalCents,
      outstandingCents,
      updatedAt: nowTimestamp(),
    },
  );

  transaction.set(
    doc(collection(db, "financialLedger")),
    {
      rentalId: input.rentalId,
      vehicleId: String(
        input.financial.vehicleId ?? "",
      ),
      vehicleRegistration: String(
        input.financial.vehicleRegistration ?? "",
      ),
      customerId: String(
        input.financial.customerId ?? "",
      ),
      entryType: "rental_discount",
      adjustmentType: "discount",
      amountCents: -input.amountCents,
      discountId: input.discountId,
      note: input.reason,
      occurredAt: nowTimestamp(),
      recordedBy: input.actorUid,
    },
  );

  return outstandingCents;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

async function requestRentalDiscount(
  input: {
    rentalId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{
  discountId: string;
  status: DiscountStatus;
  outstandingCents: number;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const rentalId = trimmedOrNull(input.rentalId);

  if (!rentalId) {
    throw new Error("Select the rental to discount.");
  }

  const amountCents = assertMoneyCents(
    input.amountCents,
    "Discount amount",
  );

  if (amountCents <= 0) {
    throw new Error(
      "Discount amount must be greater than zero.",
    );
  }

  const reason = trimmedOrNull(input.reason);

  if (!reason) {
    throw new Error(
      "Say why the discount is being offered.",
    );
  }

  if (reason.length > 500) {
    throw new Error(
      "Keep the discount reason under 500 characters.",
    );
  }

  /*
   * One request at a time per rental, so an administrator
   * never approves two versions of the same discount. The
   * query cannot run inside a browser transaction; the
   * idempotency key below is what stops a double submit.
   */
  const waiting = await getDocs(
    query(
      collection(db, "rentalDiscounts"),
      where("rentalId", "==", rentalId),
      where("status", "==", "pending"),
      limit(1),
    ),
  );

  if (!waiting.empty) {
    throw new Error(
      "A discount on this rental is already waiting for an administrator.",
    );
  }

  const operationRef = doc(
    db,
    "idempotencyKeys",
    `discount_${input.idempotencyKey}`,
  );

  const discountRef = doc(
    collection(db, "rentalDiscounts"),
  );

  const financialRef = doc(
    db,
    "rentalFinancials",
    rentalId,
  );

  const rentalRef = doc(db, "rentals", rentalId);

  let response:
    | {
        discountId: string;
        status: DiscountStatus;
        outstandingCents: number;
      }
    | undefined;

  await runTransaction(db, async (transaction) => {
    const previous = await transaction.get(
      operationRef,
    );

    if (previous.exists()) {
      response = previous.get("response");

      return;
    }

    const [financialSnapshot, rentalSnapshot] =
      await Promise.all([
        transaction.get(financialRef),
        transaction.get(rentalRef),
      ]);

    if (
      !financialSnapshot.exists() ||
      !rentalSnapshot.exists()
    ) {
      throw new Error(
        "Rental financial record was not found.",
      );
    }

    const actor = await actorProfileSnapshot(
      transaction,
      actorUid,
    );

    const financial = financialSnapshot.data();

    const rental = rentalSnapshot.data();

    const status: DiscountStatus =
      actor.role === "admin"
        ? "approved"
        : "pending";

    let outstandingCents = Number(
      financial.outstandingCents ?? 0,
    );

    if (status === "approved") {
      outstandingCents = applyDiscount(
        transaction,
        {
          rentalId,
          discountId: discountRef.id,
          financial,
          amountCents,
          reason,
          actorUid,
        },
      );
    } else if (amountCents > outstandingCents) {
      throw new Error(
        `The discount is more than the ${formatCents(
          Math.max(outstandingCents, 0),
        )} still owed on this rental.`,
      );
    }

    transaction.set(discountRef, {
      rentalId,
      customerNameSnapshot: String(
        financial.customerNameSnapshot ??
          rental.customerNameSnapshot ??
          "",
      ),
      vehicleRegistrationSnapshot: String(
        financial.vehicleRegistration ??
          rental.vehicleRegistrationSnapshot ??
          "",
      ),
      amountCents,
      reason,
      status,
      requestedBy: actorUid,
      requestedByNameSnapshot: actor.name,
      requestedAt: nowTimestamp(),

      /* An administrator's own discount is its own approval. */
      reviewedBy:
        status === "approved" ? actorUid : null,
      reviewedByNameSnapshot:
        status === "approved" ? actor.name : null,
      reviewedAt:
        status === "approved"
          ? nowTimestamp()
          : null,
      reviewNote: null,
      updatedAt: nowTimestamp(),
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,
        action:
          status === "approved"
            ? "discount.applied"
            : "discount.requested",
        resource: {
          collection: "rentalDiscounts",
          id: discountRef.id,
        },
        details: { rentalId, amountCents },
        createdAt: nowTimestamp(),
      },
    );

    response = {
      discountId: discountRef.id,
      status,
      outstandingCents,
    };

    transaction.set(operationRef, {
      response,
      actorUid,
      createdAt: nowTimestamp(),
    });
  });

  return response!;
}

async function reviewRentalDiscount(
  input: {
    discountId: string;
    decision: "approve" | "reject";
    note: string | null;
  },
): Promise<{
  status: DiscountStatus;
  outstandingCents: number | null;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const discountId = trimmedOrNull(
    input.discountId,
  );

  if (!discountId) {
    throw new Error("Select the discount to review.");
  }

  if (
    input.decision !== "approve" &&
    input.decision !== "reject"
  ) {
    throw new Error(
      "Choose whether to approve or reject the discount.",
    );
  }

  const note = trimmedOrNull(input.note);

  if (note && note.length > 1000) {
    throw new Error(
      "Keep the review note under 1000 characters.",
    );
  }

  const discountRef = doc(
    db,
    "rentalDiscounts",
    discountId,
  );

  let result: {
    status: DiscountStatus;
    outstandingCents: number | null;
  } = { status: "pending", outstandingCents: null };

  await runTransaction(db, async (transaction) => {
    const discountSnapshot = await transaction.get(
      discountRef,
    );

    if (!discountSnapshot.exists()) {
      throw new Error("Discount was not found.");
    }

    const discount = discountSnapshot.data();

    if (
      discountStatusOf(discount.status) !==
      "pending"
    ) {
      throw new Error(
        "This discount has already been decided.",
      );
    }

    const rentalId = String(discount.rentalId);

    const financialRef = doc(
      db,
      "rentalFinancials",
      rentalId,
    );

    const financialSnapshot = await transaction.get(
      financialRef,
    );

    const actor = await actorProfileSnapshot(
      transaction,
      actorUid,
    );

    if (actor.role !== "admin") {
      throw new Error(
        "Only an administrator can approve a discount.",
      );
    }

    const status: DiscountStatus =
      input.decision === "approve"
        ? "approved"
        : "rejected";

    let outstandingCents: number | null = null;

    if (status === "approved") {
      if (!financialSnapshot.exists()) {
        throw new Error(
          "Rental financial record was not found.",
        );
      }

      outstandingCents = applyDiscount(
        transaction,
        {
          rentalId,
          discountId,
          financial: financialSnapshot.data(),
          amountCents: assertMoneyCents(
            discount.amountCents,
            "Discount amount",
          ),
          reason: String(discount.reason ?? ""),
          actorUid,
        },
      );
    }

    transaction.update(discountRef, {
      status,
      reviewedBy: actorUid,
      reviewedByNameSnapshot: actor.name,
      reviewedAt: nowTimestamp(),
      reviewNote: note,
      updatedAt: nowTimestamp(),
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,
        action:
          status === "approved"
            ? "discount.approved"
            : "discount.rejected",
        resource: {
          collection: "rentalDiscounts",
          id: discountId,
        },
        details: { rentalId, note },
        createdAt: nowTimestamp(),
      },
    );

    result = { status, outstandingCents };
  });

  return result;
}

/* Discounts still waiting for an administrator. */
async function listPendingDiscounts(): Promise<
  RentalDiscount[]
> {
  const { db } = getFirebaseClient();

  const snapshot = await getDocs(
    query(
      collection(db, "rentalDiscounts"),
      where("status", "==", "pending"),
      limit(200),
    ),
  );

  return snapshot.docs
    .map((entry) =>
      rentalDiscountFrom(entry.id, entry.data()),
    )
    .sort((a, b) =>
      String(a.requestedAt).localeCompare(
        String(b.requestedAt),
      ),
    );
}

/* =========================================================
   Vehicle creation
   ========================================================= */

async function createVehicle(
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
    photos?: Array<Record<string, unknown>>;
  },
): Promise<{
  vehicleId: string;
  registrationNumber: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const registrationNumber =
    String(
      input.registrationNumber ?? "",
    )
      .trim()
      .toUpperCase();

  const make =
    String(
      input.make ?? "",
    )
      .trim()
      .toUpperCase();

  const model =
    String(
      input.model ?? "",
    ).trim();

  if (!registrationNumber) {
    throw new Error(
      "Registration number is required.",
    );
  }

  if (!make) {
    throw new Error(
      "Vehicle make is required.",
    );
  }

  if (!model) {
    throw new Error(
      "Vehicle model is required.",
    );
  }

  const vin =
    trimmedOrNull(
      input.vin,
    )?.toUpperCase() ?? null;

  if (
    vin !== null &&
    vin.length !== 17
  ) {
    throw new Error(
      "VIN must contain exactly 17 characters.",
    );
  }

  const rates = {
    currency: "USD" as const,

    dailyCents:
      input.dailyCents == null
        ? null
        : assertMoneyCents(
            input.dailyCents,
            "Daily rate",
          ),

    weeklyCents:
      input.weeklyCents == null
        ? null
        : assertMoneyCents(
            input.weeklyCents,
            "Weekly rate",
          ),

    monthlyCents:
      input.monthlyCents == null
        ? null
        : assertMoneyCents(
            input.monthlyCents,
            "Monthly rate",
          ),
  };

  if (
    rates.dailyCents === null &&
    rates.weeklyCents === null &&
    rates.monthlyCents === null
  ) {
    throw new Error(
      "At least one vehicle rate is required.",
    );
  }

  /*
   * Availability and booking both compare these dates. An
   * unparseable string would compare as NaN and read as though
   * it had not expired, so it is refused here rather than
   * relying on the form to be the only way in.
   */
  const registrationExpiresAt =
    optionalDateOrNull(
      input.registrationExpiresAt,
      "Registration expiry",
    );

  const insuranceExpiresAt =
    optionalDateOrNull(
      input.insuranceExpiresAt,
      "Insurance expiry",
    );

  const lastServiceAt =
    optionalDateOrNull(
      input.lastServiceAt,
      "Last service date",
    );

  const nextServiceDueAt =
    optionalDateOrNull(
      input.nextServiceDueAt,
      "Next service date",
    );

  /*
   * Registration numbers and VINs identify a vehicle across
   * the whole system, so a duplicate is refused before the
   * record is created rather than discovered later from two
   * fleet rows describing the same car.
   */
  const duplicateRegistration =
    await getDocs(
      query(
        collection(
          db,
          "vehicles",
        ),
        where(
          "registrationNumber",
          "==",
          registrationNumber,
        ),
        limit(1),
      ),
    );

  if (!duplicateRegistration.empty) {
    throw new Error(
      `Registration number ${registrationNumber} is already assigned to another vehicle.`,
    );
  }

  if (vin !== null) {
    const duplicateVin =
      await getDocs(
        query(
          collection(
            db,
            "vehicles",
          ),
          where(
            "vin",
            "==",
            vin,
          ),
          limit(1),
        ),
      );

    if (!duplicateVin.empty) {
      throw new Error(
        `VIN ${vin} is already assigned to another vehicle.`,
      );
    }
  }

  const vehicleRef =
    doc(
      collection(
        db,
        "vehicles",
      ),
    );

  await runTransaction(
    db,
    async (transaction) => {
      const registrationClaim =
        await readVehicleKeyClaim(
          transaction,
          "reg",
          registrationNumber,
          vehicleRef.id,
        );

      if (registrationClaim.heldBy) {
        throw new Error(
          `Registration number ${registrationNumber} is already assigned to another vehicle.`,
        );
      }

      const vinClaim =
        vin === null
          ? null
          : await readVehicleKeyClaim(
              transaction,
              "vin",
              vin,
              vehicleRef.id,
            );

      if (vinClaim?.heldBy) {
        throw new Error(
          `VIN ${vin} is already assigned to another vehicle.`,
        );
      }

      transaction.set(
        registrationClaim.ref,
        {
          vehicleId: vehicleRef.id,
          value: registrationNumber,
          updatedAt: nowTimestamp(),
        },
      );

      if (vinClaim && vin !== null) {
        transaction.set(
          vinClaim.ref,
          {
            vehicleId: vehicleRef.id,
            value: vin,
            updatedAt: nowTimestamp(),
          },
        );
      }

      transaction.set(
        vehicleRef,
        {
          registrationNumber,

          make,

          model,

          year:
            input.year == null
              ? null
              : Number(
                  input.year,
                ),

          color:
            trimmedOrNull(
              input.color,
            ),

          vin,

          registrationExpiresAt,

          insuranceExpiresAt,

          lastServiceAt,

          nextServiceDueAt,

          rates,

          notes:
            trimmedOrNull(
              input.notes,
            ),

          photos:
            sanitizeMediaList(
              input.photos,
            ),

          status:
            "available" as const,

          createdBy:
            actorUid,

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.set(
        doc(
          collection(
            db,
            "auditLogs",
          ),
        ),
        {
          actorUid,

          action:
            "vehicle.created",

          resource: {
            collection:
              "vehicles",

            id:
              vehicleRef.id,
          },

          details: {
            registrationNumber,
            vin,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    vehicleId:
      vehicleRef.id,

    registrationNumber,
  };
}

/* =========================================================
   Vehicle details
   ========================================================= */

async function updateVehicleDetails(
  input: Record<string, unknown>,
): Promise<void> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const vehicleRef =
    doc(
      db,
      "vehicles",
      String(
        input.vehicleId,
      ),
    );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      const current =
        snapshot.data() as VehicleDocument;

      /*
       * Renaming a vehicle moves its uniqueness claim: the new
       * value is claimed under the same contention rules as a
       * creation, and the old one is released so the previous
       * registration can be issued again.
       */
      const nextRegistration =
        String(
          input.registrationNumber ??
            current.registrationNumber,
        )
          .trim()
          .toUpperCase();

      const nextVin =
        trimmedOrNull(
          input.vin,
        )?.toUpperCase() ?? null;

      if (
        nextVin !== null &&
        nextVin.length !== 17
      ) {
        throw new Error(
          "VIN must contain exactly 17 characters.",
        );
      }

      const registrationChanged =
        nextRegistration !==
        current.registrationNumber;

      const vinChanged =
        nextVin !== (current.vin ?? null);

      const registrationClaim =
        registrationChanged
          ? await readVehicleKeyClaim(
              transaction,
              "reg",
              nextRegistration,
              vehicleRef.id,
            )
          : null;

      if (registrationClaim?.heldBy) {
        throw new Error(
          `Registration number ${nextRegistration} is already assigned to another vehicle.`,
        );
      }

      const vinClaim =
        vinChanged && nextVin !== null
          ? await readVehicleKeyClaim(
              transaction,
              "vin",
              nextVin,
              vehicleRef.id,
            )
          : null;

      if (vinClaim?.heldBy) {
        throw new Error(
          `VIN ${nextVin} is already assigned to another vehicle.`,
        );
      }

      const rates = {
        currency:
          "USD" as const,

        dailyCents:
          input.dailyCents ==
          null
            ? null
            : assertMoneyCents(
                input.dailyCents,
                "Daily rate",
              ),

        weeklyCents:
          input.weeklyCents ==
          null
            ? null
            : assertMoneyCents(
                input.weeklyCents,
                "Weekly rate",
              ),

        monthlyCents:
          input.monthlyCents ==
          null
            ? null
            : assertMoneyCents(
                input.monthlyCents,
                "Monthly rate",
              ),
      };

      if (
        rates.dailyCents === null &&
        rates.weeklyCents === null &&
        rates.monthlyCents === null
      ) {
        throw new Error(
          "At least one vehicle rate is required.",
        );
      }

      if (registrationClaim) {
        transaction.set(
          registrationClaim.ref,
          {
            vehicleId: vehicleRef.id,
            value: nextRegistration,
            updatedAt: nowTimestamp(),
          },
        );

        transaction.delete(
          vehicleKeyRef(
            "reg",
            current.registrationNumber,
          ),
        );
      }

      if (vinClaim && nextVin !== null) {
        transaction.set(
          vinClaim.ref,
          {
            vehicleId: vehicleRef.id,
            value: nextVin,
            updatedAt: nowTimestamp(),
          },
        );
      }

      if (
        vinChanged &&
        current.vin
      ) {
        transaction.delete(
          vehicleKeyRef(
            "vin",
            current.vin,
          ),
        );
      }

      transaction.update(
        vehicleRef,
        {
          registrationNumber:
            nextRegistration,

          make:
            String(
              input.make ??
                current.make,
            )
              .trim()
              .toUpperCase(),

          model:
            String(
              input.model ??
                current.model,
            ).trim(),

          year:
            input.year == null
              ? null
              : Number(
                  input.year,
                ),

          color:
            input.color == null
              ? null
              : String(
                  input.color,
                ).trim() ||
                null,

          vin: nextVin,

          registrationExpiresAt:
            optionalDateOrNull(
              input.registrationExpiresAt,
              "Registration expiry",
            ),

          insuranceExpiresAt:
            optionalDateOrNull(
              input.insuranceExpiresAt,
              "Insurance expiry",
            ),

          lastServiceAt:
            optionalDateOrNull(
              input.lastServiceAt,
              "Last service date",
            ),

          nextServiceDueAt:
            optionalDateOrNull(
              input.nextServiceDueAt,
              "Next service date",
            ),

          rates,

          notes:
            trimmedOrNull(
              input.notes,
            ),

          photos:
            Array.isArray(
              input.photos,
            )
              ? sanitizeMediaList(
                  input.photos,
                )
              : sanitizeMediaList(
                  (
                    current as unknown as {
                      photos?: unknown;
                    }
                  ).photos,
                ),

          updatedAt:
            nowTimestamp(),
        },
      );

      const auditRef =
        doc(
          collection(
            db,
            "auditLogs",
          ),
        );

      transaction.set(
        auditRef,
        {
          actorUid,

          action:
            "vehicle.details_updated",

          resource: {
            collection:
              "vehicles",
            id:
              vehicleRef.id,
          },

          details: {
            previousRates:
              current.rates,
            newRates:
              rates,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );
}

/* =========================================================
   Vehicle status
   ========================================================= */

async function changeVehicleStatus(
  input: {
    vehicleId: string;
    status: VehicleStatus;
    note: string;
  },
): Promise<void> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const vehicleRef =
    doc(
      db,
      "vehicles",
      input.vehicleId,
    );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
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
        throw new Error(
          `Vehicle cannot transition from ${vehicle.status} to ${input.status}.`,
        );
      }

      if (
        input.status ===
        "available"
      ) {
        const now =
          Date.now();

        if (
          complianceDateMs(
            vehicle.insuranceExpiresAt,
            "Vehicle insurance expiry",
          ) <= now ||
          complianceDateMs(
            vehicle.registrationExpiresAt,
            "Vehicle registration expiry",
          ) <= now
        ) {
          throw new Error(
            "Cannot make a vehicle available with expired or missing compliance documents.",
          );
        }
      }

      transaction.update(
        vehicleRef,
        {
          status:
            input.status,

          statusNote:
            input.note,

          updatedAt:
            nowTimestamp(),
        },
      );

      const auditRef =
        doc(
          collection(
            db,
            "auditLogs",
          ),
        );

      transaction.set(
        auditRef,
        {
          actorUid,

          action:
            "vehicle.status_changed",

          resource: {
            collection:
              "vehicles",
            id:
              vehicleRef.id,
          },

          details: {
            from:
              vehicle.status,
            to:
              input.status,
            note:
              input.note,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );
}

/* =========================================================
   Vehicle expense
   ========================================================= */

/*
 * The damage the vehicle carries between hires. Checkout and
 * return keep it up to date on their own; this is for the
 * fleet screen, where a repair is cleared or damage found in
 * the yard is marked.
 */
async function updateVehicleDamage(
  input: {
    vehicleId: string;
    damageMarks: unknown;
  },
): Promise<{
  damageMarks: DamageMark[];
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const vehicleId = trimmedOrNull(
    input.vehicleId,
  );

  if (!vehicleId) {
    throw new Error(
      "Select the vehicle to update.",
    );
  }

  const damageMarks = sanitizeDamageMarks(
    input.damageMarks,
    { strict: true },
  );

  const vehicleRef = doc(
    db,
    "vehicles",
    vehicleId,
  );

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(
      vehicleRef,
    );

    if (!snapshot.exists()) {
      throw new Error("Vehicle was not found.");
    }

    transaction.update(vehicleRef, {
      damageMarks,
      damageUpdatedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,
        action: "vehicle.damage_updated",
        resource: {
          collection: "vehicles",
          id: vehicleId,
        },
        details: {
          marks: damageMarks.length,
        },
        createdAt: nowTimestamp(),
      },
    );
  });

  return { damageMarks };
}

async function recordVehicleExpense(
  input: {
    vehicleId: string;
    category: string;
    amountCents: number;
    occurredAt: string;
    vendor: string | null;
    note: string;
    idempotencyKey: string;
  },
): Promise<{
  expenseId: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const amountCents =
    assertMoneyCents(
      input.amountCents,
      "Expense amount",
    );

  if (amountCents <= 0) {
    throw new Error(
      "Expense amount must be greater than zero.",
    );
  }

  const occurredAt =
    asTimestamp(
      input.occurredAt,
    );

  const vehicleId =
    trimmedOrNull(
      input.vehicleId,
    );

  if (!vehicleId) {
    throw new Error(
      "Select the vehicle this expense belongs to.",
    );
  }

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `expense_${input.idempotencyKey}`,
    );

  const expenseRef =
    doc(
      collection(
        db,
        "vehicleExpenses",
      ),
    );

  const vehicleRef =
    doc(
      db,
      "vehicles",
      vehicleId,
    );

  let recordedExpenseId =
    expenseRef.id;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      /*
       * Replaying a submission returns the expense that was
       * actually written the first time rather than the id of
       * a document this attempt never created.
       */
      if (previous.exists()) {
        const previousResponse =
          previous.get(
            "response",
          ) as {
            expenseId?: string;
          };

        recordedExpenseId =
          previousResponse?.expenseId ??
          recordedExpenseId;

        return;
      }

      const vehicleSnapshot =
        await transaction.get(
          vehicleRef,
        );

      if (
        !vehicleSnapshot.exists()
      ) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      const vehicleRegistration =
        String(
          vehicleSnapshot.get(
            "registrationNumber",
          ) ?? "",
        );

      transaction.set(
        expenseRef,
        {
          vehicleId,

          vehicleRegistration,

          category:
            String(
              input.category ?? "other",
            ),

          amountCents,

          occurredAt,

          vendor:
            trimmedOrNull(
              input.vendor,
            ),

          note:
            trimmedOrNull(
              input.note,
            ) ?? "",

          recordedBy:
            actorUid,

          recordedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          vehicleId,

          vehicleRegistration,

          entryType:
            "expense",

          amountCents:
            -amountCents,

          expenseId:
            expenseRef.id,

          occurredAt,

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response: {
            expenseId:
              expenseRef.id,
          },

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    expenseId:
      recordedExpenseId,
  };
}

/* =========================================================
   Financial overview
   ========================================================= */

/*
 * Revenue reporting is an administrator's screen.
 *
 * The security rules are the real boundary — `refunds`,
 * `financialLedger` and `vehicleExpenses` are admin-read, so
 * an operations account is refused by Firestore whatever the
 * browser does. This check is there so the refusal is a
 * sentence the office can read instead of a raw permission
 * error, and so a non-administrator never issues the reads
 * at all.
 */
async function assertAdmin(
  action: string,
): Promise<void> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const profile = await getDoc(
    doc(db, "users", actorUid),
  );

  if (
    !profile.exists() ||
    profile.get("status") !== "approved" ||
    profile.get("role") !== "admin"
  ) {
    throw new Error(
      `${action} is restricted to administrators.`,
    );
  }
}

async function getFinancialOverview(
  input: {
    from: string;
    to: string;
    vehicleId: string | null;
  },
): Promise<FinancialOverview> {
  await assertAdmin(
    "Financial reporting",
  );

  const { db } =
    getFirebaseClient();

  const [
    financialSnapshot,
    expenseSnapshot,
    ledgerSnapshot,
  ] = await Promise.all([
    getDocs(
      query(
        collection(
          db,
          "rentalFinancials",
        ),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(
          db,
          "vehicleExpenses",
        ),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(
          db,
          "financialLedger",
        ),
        limit(500),
      ),
    ),
  ]);

  const financialRecords:
    FirestoreDoc[] =
    financialSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const expenses:
    FirestoreDoc[] =
    expenseSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const ledgerEntries:
    FirestoreDoc[] =
    ledgerSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  /*
   * Expenses recorded before the registration was stored on
   * them would otherwise be listed under a raw document id, so
   * the label is resolved from whichever record carries it.
   */
  const registrationByVehicle =
    new Map<string, string>();

  for (
    const record of [
      ...financialRecords,
      ...ledgerEntries,
      ...expenses,
    ]
  ) {
    const vehicleId =
      String(
        record.vehicleId ?? "",
      );

    const registration =
      trimmedOrNull(
        record.vehicleRegistration ??
          record.vehicleRegistrationSnapshot,
      );

    if (
      vehicleId &&
      registration &&
      !registrationByVehicle.has(
        vehicleId,
      )
    ) {
      registrationByVehicle.set(
        vehicleId,
        registration,
      );
    }
  }

  const matchesVehicle =
    (record: FirestoreDoc): boolean =>
      !input.vehicleId ||
      String(
        record.vehicleId ?? "",
      ) === input.vehicleId;

  const fromDate =
    new Date(
      `${input.from}T00:00:00`,
    );

  const toDate =
    new Date(
      `${input.to}T23:59:59.999`,
    );

  const withinRange =
    (value: unknown) => {
      if (!value) {
        return false;
      }

      const date =
        new Date(
          toIso(value),
        );

      return (
        date >= fromDate &&
        date <= toDate
      );
    };

  const filteredFinancial =
    financialRecords.filter(
      (record) =>
        matchesVehicle(record) &&
        withinRange(
          record.createdAt ??
            record.pickupAt,
        ),
    );

  const filteredExpenses =
    expenses.filter(
      (record) =>
        matchesVehicle(record) &&
        withinRange(
          record.occurredAt,
        ),
    );

  const filteredLedger =
    ledgerEntries.filter(
      (entry) =>
        matchesVehicle(entry) &&
        withinRange(
          entry.occurredAt,
        ),
    );

  const invoicedCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.totalCents ??
            0,
        ),
      0,
    );

  /*
   * Money received is counted from the ledger entry each
   * payment writes, dated when the payment was taken.
   *
   * It used to be summed from rentalFinancials.paidCents,
   * which is a running total on the rental and was filtered
   * by the date the *rental* was created. A payment taken
   * today against a rental that started last month therefore
   * never appeared in this month's figures at all, and a
   * rental created inside the window contributed its whole
   * lifetime of payments to that window however long ago
   * they were made.
   */
  const paymentEntries =
    filteredLedger.filter(
      (entry) =>
        String(entry.entryType) ===
        "payment",
    );

  const receivedCents =
    paymentEntries.reduce(
      (sum, entry) =>
        sum +
        Number(
          entry.amountCents ?? 0,
        ),
      0,
    );

  const refundedCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.refundedCents ??
            0,
        ),
      0,
    );

  const expensesCents =
    filteredExpenses.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.amountCents ??
            0,
        ),
      0,
    );

  const netCashCents =
    receivedCents -
    refundedCents -
    expensesCents;

  /*
   * Outstanding is what is owed right now, so it deliberately
   * ignores the date window. Filtering it by the date a rental
   * was created hid every older debt: a rental from two months
   * ago with money still on it reported as nothing owed while
   * this month was on screen. The vehicle filter still applies,
   * because that narrows which debts are being asked about
   * rather than when they were incurred.
   */
  const unsettled = financialRecords.filter(
    (record) =>
      matchesVehicle(record) &&
      Number(
        record.outstandingCents ?? 0,
      ) > 0,
  );

  const outstandingCents = unsettled.reduce(
    (sum, record) =>
      sum +
      Number(
        record.outstandingCents ?? 0,
      ),
    0,
  );

  const vehicleMap =
  new Map<
    string,
    {
      vehicleRegistration: string;
      invoicedCents: number;
      expensesCents: number;
      receivedCents: number;
      refundedCents: number;
    }
  >();

  for (
    const record of
    filteredFinancial
  ) {
    const vehicleId =
      String(
        record.vehicleId ??
          "",
      );

    if (!vehicleId) {
      continue;
    }

    const current =
      vehicleMap.get(
        vehicleId,
      ) ?? {
        vehicleRegistration:
          String(
            record.vehicleRegistration ??
              record.vehicleRegistrationSnapshot ??
              registrationByVehicle.get(
                vehicleId,
              ) ??
              vehicleId,
          ),

        invoicedCents: 0,

        expensesCents: 0,

        receivedCents: 0,

        refundedCents: 0,
      };

    current.invoicedCents +=
      Number(
        record.totalCents ?? 0,
      );

    current.refundedCents +=
      Number(
        record.refundedCents ?? 0,
      );

    vehicleMap.set(
      vehicleId,
      current,
    );
  }

  /*
   * Received per vehicle comes from the same payment entries
   * as the headline figure, so the breakdown always adds up
   * to it. A payment against a vehicle with no other activity
   * in the window still opens a row of its own.
   */
  for (const entry of paymentEntries) {
    const vehicleId = String(
      entry.vehicleId ?? "",
    );

    if (!vehicleId) {
      continue;
    }

    const current =
      vehicleMap.get(vehicleId) ?? {
        vehicleRegistration: String(
          entry.vehicleRegistration ??
            registrationByVehicle.get(
              vehicleId,
            ) ??
            vehicleId,
        ),

        invoicedCents: 0,
        expensesCents: 0,
        receivedCents: 0,
        refundedCents: 0,
      };

    current.receivedCents += Number(
      entry.amountCents ?? 0,
    );

    vehicleMap.set(vehicleId, current);
  }

  for (
    const expense of
    filteredExpenses
  ) {
    const vehicleId =
      String(
        expense.vehicleId ??
          "",
      );

    if (!vehicleId) {
      continue;
    }

    const current =
      vehicleMap.get(
        vehicleId,
      ) ?? {
        vehicleRegistration:
          registrationByVehicle.get(
            vehicleId,
          ) ?? vehicleId,

        invoicedCents: 0,
        expensesCents: 0,
        receivedCents: 0,
        refundedCents: 0,
      };

    current.expensesCents +=
      Number(
        expense.amountCents ??
          0,
      );

    vehicleMap.set(
      vehicleId,
      current,
    );
  }

  const vehiclePerformance =
    Array.from(
      vehicleMap.entries(),
    ).map(
      ([
        vehicleId,
        item,
      ]) => ({
        vehicleId,

        vehicleRegistration:
          item.vehicleRegistration,

        invoicedCents:
          item.invoicedCents,

        expensesCents:
          item.expensesCents,

        receivedCents:
  item.receivedCents,

operatingMarginCents:
  item.invoicedCents -
  item.refundedCents -
  item.expensesCents,
      }),
    );

  const customerNameByRental =
    new Map<string, string>();

  for (const record of financialRecords) {
    const name = trimmedOrNull(
      record.customerNameSnapshot,
    );

    if (name) {
      customerNameByRental.set(
        record.id,
        name,
      );
    }
  }

  const recentEntries =
    filteredLedger
      .sort(
        (a, b) =>
          new Date(
            toIso(
              b.occurredAt,
            ),
          ).getTime() -
          new Date(
            toIso(
              a.occurredAt,
            ),
          ).getTime(),
      )
      .slice(0, 20)
      .map(
        (entry) => ({
          id: entry.id,

          entryType:
            String(
              entry.entryType ??
                "entry",
            ),

          vehicleRegistration:
            String(
              entry.vehicleRegistration ??
                "",
            ),

          /*
           * The ledger carries only the customer's id, so the
           * name is read from the rental's financial record,
           * which is kept under the rental's own id.
           */
          customerName:
            customerNameByRental.get(
              String(
                entry.rentalId ?? "",
              ),
            ) ?? null,

          amountCents:
            Number(
              entry.amountCents ??
                0,
            ),

          occurredAt:
            toIso(
              entry.occurredAt,
            ),
        }),
      );

  const outstandingRentals =
    unsettled.length;

  return {
    from:
      input.from,

    to:
      input.to,

    vehicleId:
      input.vehicleId,

    invoicedCents,

    receivedCents,

    refundedCents,

    expensesCents,

    netCashCents,

    operatingMarginCents:
  invoicedCents -
  refundedCents -
  expensesCents,

    outstandingCents,

    outstandingRentals,

    vehiclePerformance,

    recentEntries,
  };
}


/* =========================================================
   Ledger entry detail
   ========================================================= */

/*
 * One line on the finance screen says only what kind of
 * money moved and how much. Opening it answers the rest —
 * whose rental it was, which car, who took the money or
 * gave the discount, and when — and sets it beside every
 * other line on the same rental, so it reads as a bill.
 */
export type LedgerLine = {
  id: string;
  entryType: string;
  amountCents: number;
  occurredAt: string;
  note: string | null;
  detailType: string | null;
  recordedByName: string | null;
};

export type LedgerEntryDetail = {
  entry: LedgerLine & {
    vehicleRegistration: string;
  };

  payment: {
    method: string;
    externalReference: string | null;
    amountCents: number;
  } | null;

  expense: {
    category: string;
    vendor: string | null;
    note: string | null;
  } | null;

  /* The discount this entry records, when it records one. */
  discount: RentalDiscount | null;

  rental: {
    id: string;
    status: string;
    customerName: string;
    customerTelephone: string | null;
    vehicleRegistration: string;
    vehicleDescription: string | null;
    pickupAt: string | null;
    expectedReturnAt: string | null;
    actualReturnAt: string | null;
    handledByName: string | null;
    checkedOutByName: string | null;
    returnedByName: string | null;
  } | null;

  bill: {
    baseRentalCents: number;
    adjustmentCents: number;
    totalCents: number;
    paidCents: number;
    refundedCents: number;
    outstandingCents: number;
    depositHeldCents: number;
  } | null;

  /* Every ledger line on the rental, oldest first. */
  lines: LedgerLine[];

  /* Every discount asked for on the rental, whatever became of it. */
  discounts: RentalDiscount[];
};

function isoOrNull(value: unknown): string | null {
  return value ? toIso(value) : null;
}

async function getLedgerEntryDetail(
  input: { entryId: string },
): Promise<LedgerEntryDetail> {
  await assertAdmin("Financial reporting");

  const entryId = trimmedOrNull(input.entryId);

  if (!entryId) {
    throw new Error("Select an entry to open.");
  }

  const { db } = getFirebaseClient();

  const entrySnapshot = await getDoc(
    doc(db, "financialLedger", entryId),
  );

  if (!entrySnapshot.exists()) {
    throw new Error("That entry was not found.");
  }

  const entry = entrySnapshot.data();

  const rentalId = trimmedOrNull(entry.rentalId);

  const paymentId = trimmedOrNull(entry.paymentId);

  const expenseId = trimmedOrNull(entry.expenseId);

  const [
    rentalSnapshot,
    financialSnapshot,
    paymentSnapshot,
    expenseSnapshot,
    lineSnapshot,
    discountSnapshot,
  ] = await Promise.all([
    rentalId
      ? getDoc(doc(db, "rentals", rentalId))
      : null,

    rentalId
      ? getDoc(
          doc(db, "rentalFinancials", rentalId),
        )
      : null,

    paymentId
      ? getDoc(doc(db, "payments", paymentId))
      : null,

    expenseId
      ? getDoc(
          doc(db, "vehicleExpenses", expenseId),
        )
      : null,

    rentalId
      ? getDocs(
          query(
            collection(db, "financialLedger"),
            where("rentalId", "==", rentalId),
            limit(200),
          ),
        )
      : null,

    rentalId
      ? getDocs(
          query(
            collection(db, "rentalDiscounts"),
            where("rentalId", "==", rentalId),
            limit(50),
          ),
        )
      : null,
  ]);

  const rental = rentalSnapshot?.exists()
    ? rentalSnapshot.data()
    : null;

  const financial = financialSnapshot?.exists()
    ? financialSnapshot.data()
    : null;

  const lineDocs: FirestoreDoc[] = lineSnapshot
    ? lineSnapshot.docs.map((snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }))
    : [{ id: entryId, ...entry }];

  const vehicleId = trimmedOrNull(
    entry.vehicleId ?? rental?.vehicleId,
  );

  /*
   * The ledger stores who recorded a line by account id only.
   * Names are looked up once per person; an account that has
   * since been removed simply shows no name.
   */
  const recorderIds = [
    ...new Set(
      lineDocs
        .map((line) =>
          trimmedOrNull(line.recordedBy),
        )
        .filter(
          (uid): uid is string => uid !== null,
        ),
    ),
  ];

  const customerId = trimmedOrNull(
    entry.customerId ?? rental?.customerId,
  );

  const [
    vehicleSnapshot,
    customerSnapshot,
    ...recorderSnapshots
  ] = await Promise.all([
      vehicleId
        ? getDoc(
            doc(db, "vehicles", vehicleId),
          ).catch(() => null)
        : null,

      /* A customer removed since keeps the name on the rental. */
      customerId
        ? getDoc(
            doc(db, "customers", customerId),
          ).catch(() => null)
        : null,

      ...recorderIds.map((uid) =>
        getDoc(doc(db, "users", uid)).catch(
          () => null,
        ),
      ),
    ]);

  const nameByUid = new Map<string, string>();

  recorderIds.forEach((uid, index) => {
    const profile =
      recorderSnapshots[index]?.data() ?? {};

    const name =
      trimmedOrNull(profile.fullName) ??
      trimmedOrNull(profile.email);

    if (name) {
      nameByUid.set(uid, name);
    }
  });

  const lineFrom = (
    line: FirestoreDoc,
  ): LedgerLine => ({
    id: line.id,
    entryType: String(line.entryType ?? "entry"),
    amountCents: Number(line.amountCents ?? 0),
    occurredAt: toIso(line.occurredAt),
    note: trimmedOrNull(line.note),
    detailType: trimmedOrNull(
      line.feeType ?? line.adjustmentType,
    ),
    recordedByName:
      nameByUid.get(String(line.recordedBy ?? "")) ??
      null,
  });

  const lines = lineDocs
    .map(lineFrom)
    .sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );

  const discounts = discountSnapshot
    ? discountSnapshot.docs
        .map((snapshot) =>
          rentalDiscountFrom(
            snapshot.id,
            snapshot.data(),
          ),
        )
        .sort((a, b) =>
          String(a.requestedAt).localeCompare(
            String(b.requestedAt),
          ),
        )
    : [];

  const discountId = trimmedOrNull(entry.discountId);

  const vehicle = vehicleSnapshot?.exists()
    ? vehicleSnapshot.data()
    : null;

  const vehicleDescription = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model]
        .map((part) => trimmedOrNull(part))
        .filter(Boolean)
        .join(" ") || null
    : null;

  const vehicleRegistration = String(
    entry.vehicleRegistration ??
      rental?.vehicleRegistrationSnapshot ??
      vehicle?.registrationNumber ??
      "",
  );

  const payment = paymentSnapshot?.exists()
    ? paymentSnapshot.data()
    : null;

  const expense = expenseSnapshot?.exists()
    ? expenseSnapshot.data()
    : null;

  return {
    entry: {
      ...lineFrom({ id: entryId, ...entry }),
      vehicleRegistration,
    },

    payment: payment
      ? {
          method: String(payment.method ?? "other"),
          externalReference: trimmedOrNull(
            payment.externalReference,
          ),
          amountCents: Number(
            payment.amountCents ?? 0,
          ),
        }
      : null,

    expense: expense
      ? {
          category: String(
            expense.category ?? "other",
          ),
          vendor: trimmedOrNull(expense.vendor),
          note: trimmedOrNull(expense.note),
        }
      : null,

    discount: discountId
      ? (discounts.find(
          (discount) => discount.id === discountId,
        ) ?? null)
      : null,

    rental:
      rental && rentalId
        ? {
            id: rentalId,
            status: String(rental.status ?? ""),
            customerName: String(
              rental.customerNameSnapshot ??
                financial?.customerNameSnapshot ??
                "",
            ),
            customerTelephone: trimmedOrNull(
              customerSnapshot?.get("telephone"),
            ),
            vehicleRegistration,
            vehicleDescription,
            pickupAt: isoOrNull(rental.pickupAt),
            expectedReturnAt: isoOrNull(
              rental.expectedReturnAt,
            ),
            actualReturnAt: isoOrNull(
              rental.actualReturnAt,
            ),
            handledByName: trimmedOrNull(
              rental.handledByNameSnapshot ??
                rental.createdByNameSnapshot,
            ),
            checkedOutByName: trimmedOrNull(
              rental.checkedOutByNameSnapshot,
            ),
            returnedByName: trimmedOrNull(
              rental.returnedByNameSnapshot,
            ),
          }
        : null,

    bill: financial
      ? {
          baseRentalCents: Number(
            financial.baseRentalCents ?? 0,
          ),
          adjustmentCents: Number(
            financial.adjustmentCents ?? 0,
          ),
          totalCents: Number(
            financial.totalCents ?? 0,
          ),
          paidCents: Number(
            financial.paidCents ?? 0,
          ),
          refundedCents: Number(
            financial.refundedCents ?? 0,
          ),
          outstandingCents: Number(
            financial.outstandingCents ?? 0,
          ),
          depositHeldCents: Number(
            financial.depositHeldCents ?? 0,
          ),
        }
      : null,

    lines,

    discounts,
  };
}

/* =========================================================
   Customer removal
   ========================================================= */

/*
 * A customer is only removable while nothing points at them.
 * Reservations and rentals both carry a customerId, so the
 * two collections are checked before the delete is attempted
 * and the record is refused if either returns a match.
 *
 * The check runs outside the transaction because the browser
 * SDK cannot read a query transactionally. A booking created
 * in the same instant as the delete would therefore survive
 * it; the reservation keeps its own customerNameSnapshot, so
 * it still renders, and the deletion is written to the audit
 * log so the removal can be traced.
 */
async function deleteCustomer(
  input: { customerId: string },
): Promise<{ customerId: string }> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const customerId = trimmedOrNull(
    input.customerId,
  );

  if (!customerId) {
    throw new Error(
      "Select a customer to remove.",
    );
  }

  const customerRef = doc(
    db,
    "customers",
    customerId,
  );

  const [
    reservationMatches,
    rentalMatches,
  ] = await Promise.all([
    getDocs(
      query(
        collection(db, "reservations"),
        where("customerId", "==", customerId),
        limit(1),
      ),
    ),

    getDocs(
      query(
        collection(db, "rentals"),
        where("customerId", "==", customerId),
        limit(1),
      ),
    ),
  ]);

  if (!reservationMatches.empty) {
    throw new Error(
      "This customer has bookings on file and cannot be removed.",
    );
  }

  if (!rentalMatches.empty) {
    throw new Error(
      "This customer has rental history and cannot be removed.",
    );
  }

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot = await transaction.get(
        customerRef,
      );

      if (!snapshot.exists()) {
        throw new Error(
          "Customer was not found.",
        );
      }

      const actorName = await actorNameSnapshot(
        transaction,
        actorUid,
      );

      transaction.delete(customerRef);

      transaction.set(
        doc(collection(db, "auditLogs")),
        {
          actorUid,

          action: "customer.deleted",

          resource: {
            collection: "customers",
            id: customerId,
          },

          details: {
            actorName,

            fullName: String(
              snapshot.get("fullName") ?? "",
            ),

            licenceNumber: String(
              snapshot.get("licenceNumber") ?? "",
            ),

            /*
             * The licence image lives in Cloudinary and can
             * only be removed with the account's API secret,
             * which this application deliberately does not
             * hold. The path is recorded so it can be purged
             * from the Cloudinary console.
             */
            licenceStoragePath: trimmedOrNull(
              snapshot.get("licenceStoragePath"),
            ),
          },

          createdAt: nowTimestamp(),
        },
      );
    },
  );

  return { customerId };
}

/* =========================================================
   Contract review, finalisation and delivery
   ========================================================= */

export type ContractStatus =
  | "not_submitted"
  | "in_review"
  | "approved"
  | "rejected";

export type ContractDelivery = {
  id: string;
  status: "sent" | "failed";
  provider: string;
  providerMessageId: string | null;
  recipientEmail: string;
  recipientNameSnapshot: string;
  contractVersion: number;
  sentByNameSnapshot: string;
  failureReason: string | null;
  createdAt: string;
};

export type ContractWorkflow = {
  reservationId: string;
  status: ContractStatus;
  version: number;
  approvedVersion: number | null;
  submittedByNameSnapshot: string | null;
  submittedAt: string | null;
  reviewedByNameSnapshot: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  deliveries: ContractDelivery[];
};

function contractRef(reservationId: string) {
  const { db } = getFirebaseClient();

  return doc(
    db,
    "reservationContracts",
    reservationId,
  );
}

/*
 * The approved snapshot is addressed by its version so a
 * rejected-and-resubmitted contract never overwrites the
 * agreement a customer was already sent.
 */
function contractVersionRef(
  reservationId: string,
  version: number,
) {
  const { db } = getFirebaseClient();

  return doc(
    db,
    "reservationContracts",
    reservationId,
    "versions",
    `v${version}`,
  );
}

/* The role decides who may approve, so it is read from the
   caller's own profile rather than taken from the browser. */
async function actorProfileSnapshot(
  transaction: {
    get: (
      reference: ReturnType<typeof doc>,
    ) => Promise<{
      data: () => Record<string, unknown> | undefined;
    }>;
  },
  actorUid: string,
): Promise<{
  name: string;
  role: string | null;
}> {
  const { db } = getFirebaseClient();

  const snapshot = await transaction.get(
    doc(db, "users", actorUid),
  );

  const profile = snapshot.data() ?? {};

  return {
    name:
      trimmedOrNull(profile.fullName) ??
      trimmedOrNull(profile.email) ??
      signedInAccountName(actorUid),

    role: trimmedOrNull(profile.role),
  };
}

function contractStatusOf(
  value: unknown,
): ContractStatus {
  return value === "in_review" ||
    value === "approved" ||
    value === "rejected"
    ? value
    : "not_submitted";
}

async function getContractWorkflow(
  input: { reservationId: string },
): Promise<ContractWorkflow> {
  const reservationId = trimmedOrNull(
    input.reservationId,
  );

  if (!reservationId) {
    throw new Error(
      "A booking reference is required.",
    );
  }

  const { db } = getFirebaseClient();

  const [snapshot, deliveryDocs] =
    await Promise.all([
      getDoc(contractRef(reservationId)),

      getDocs(
        query(
          collection(
            db,
            "reservationContracts",
            reservationId,
            "deliveries",
          ),
          orderBy("createdAt", "desc"),
          limit(20),
        ),
      ),
    ]);

  const deliveries: ContractDelivery[] =
    deliveryDocs.docs.map((delivery) => ({
      id: delivery.id,

      status:
        delivery.get("status") === "failed"
          ? "failed"
          : "sent",

      provider: String(
        delivery.get("provider") ?? "unknown",
      ),

      providerMessageId: trimmedOrNull(
        delivery.get("providerMessageId"),
      ),

      recipientEmail: String(
        delivery.get("recipientEmail") ?? "",
      ),

      recipientNameSnapshot: String(
        delivery.get("recipientNameSnapshot") ??
          "",
      ),

      contractVersion: Number(
        delivery.get("contractVersion") ?? 0,
      ),

      sentByNameSnapshot: String(
        delivery.get("sentByNameSnapshot") ?? "",
      ),

      failureReason: trimmedOrNull(
        delivery.get("failureReason"),
      ),

      createdAt: toIso(
        delivery.get("createdAt"),
      ),
    }));

  if (!snapshot.exists()) {
    return {
      reservationId,
      status: "not_submitted",
      version: 0,
      approvedVersion: null,
      submittedByNameSnapshot: null,
      submittedAt: null,
      reviewedByNameSnapshot: null,
      reviewedAt: null,
      reviewNote: null,
      deliveries,
    };
  }

  return {
    reservationId,

    status: contractStatusOf(
      snapshot.get("status"),
    ),

    version: Number(
      snapshot.get("version") ?? 0,
    ),

    approvedVersion:
      snapshot.get("approvedVersion") == null
        ? null
        : Number(
            snapshot.get("approvedVersion"),
          ),

    submittedByNameSnapshot: trimmedOrNull(
      snapshot.get("submittedByNameSnapshot"),
    ),

    submittedAt:
      snapshot.get("submittedAt") == null
        ? null
        : toIso(snapshot.get("submittedAt")),

    reviewedByNameSnapshot: trimmedOrNull(
      snapshot.get("reviewedByNameSnapshot"),
    ),

    reviewedAt:
      snapshot.get("reviewedAt") == null
        ? null
        : toIso(snapshot.get("reviewedAt")),

    reviewNote: trimmedOrNull(
      snapshot.get("reviewNote"),
    ),

    deliveries,
  };
}

export type ContractQueueEntry = {
  reservationId: string;
  rentalId: string | null;
  status: ContractStatus;
  version: number;
  customerName: string;
  vehicleRegistration: string;
  submittedByNameSnapshot: string | null;
  reviewNote: string | null;
};

/*
 * Everything an administrator still has to decide on, plus
 * the contracts that came back rejected and need correcting.
 * Without this an agreement submitted from one browser would
 * be unreachable from another.
 */
async function listContractsForReview(): Promise<
  ContractQueueEntry[]
> {
  const { db } = getFirebaseClient();

  const snapshot = await getDocs(
    query(
      collection(db, "reservationContracts"),
      where("status", "in", [
        "in_review",
        "rejected",
      ]),
      limit(50),
    ),
  );

  return snapshot.docs
    .map((entry) => ({
      reservationId: entry.id,

      rentalId: trimmedOrNull(
        entry.get("rentalId"),
      ),

      status: contractStatusOf(
        entry.get("status"),
      ),

      version: Number(
        entry.get("version") ?? 0,
      ),

      customerName: String(
        entry.get("customerNameSnapshot") ??
          "Unknown customer",
      ),

      vehicleRegistration: String(
        entry.get(
          "vehicleRegistrationSnapshot",
        ) ?? "Unknown vehicle",
      ),

      submittedByNameSnapshot: trimmedOrNull(
        entry.get("submittedByNameSnapshot"),
      ),

      reviewNote: trimmedOrNull(
        entry.get("reviewNote"),
      ),
    }))
    .sort((a, b) =>
      a.vehicleRegistration.localeCompare(
        b.vehicleRegistration,
      ),
    );
}

/*
 * Submitting hands the agreement to an administrator. The
 * version advances on every submission, so the number that
 * is later frozen and emailed identifies exactly which round
 * of review produced the approved text.
 */
async function submitContractForReview(
  input: {
    reservationId: string;
    rentalId?: string | null;
  },
): Promise<{
  reservationId: string;
  version: number;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const reservationId = trimmedOrNull(
    input.reservationId,
  );

  if (!reservationId) {
    throw new Error(
      "A booking reference is required.",
    );
  }

  const reservationRef = doc(
    db,
    "reservations",
    reservationId,
  );

  const reference = contractRef(reservationId);

  let version = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const [reservation, existing] =
        await Promise.all([
          transaction.get(reservationRef),
          transaction.get(reference),
        ]);

      if (!reservation.exists()) {
        throw new Error(
          "Booking was not found.",
        );
      }

      const actorName = await actorNameSnapshot(
        transaction,
        actorUid,
      );

      const current = existing.exists()
        ? contractStatusOf(
            existing.get("status"),
          )
        : "not_submitted";

      if (current === "approved") {
        throw new Error(
          "This contract has already been finalised.",
        );
      }

      if (current === "in_review") {
        throw new Error(
          "This contract is already waiting for review.",
        );
      }

      version =
        Number(
          existing.exists()
            ? (existing.get("version") ?? 0)
            : 0,
        ) + 1;

      const review = {
        reservationId,

        /*
         * The agreement is issued at checkout, so the queue
         * has to reopen the rental's document rather than the
         * booking's.
         */
        rentalId:
          trimmedOrNull(input.rentalId) ??
          trimmedOrNull(
            existing.exists()
              ? existing.get("rentalId")
              : null,
          ),

        status: "in_review",

        version,

        /*
         * Copied so the review queue can list what is waiting
         * without reading every reservation behind it.
         */
        customerNameSnapshot: String(
          reservation.get(
            "customerNameSnapshot",
          ) ?? "",
        ),

        vehicleRegistrationSnapshot: String(
          reservation.get(
            "vehicleRegistrationSnapshot",
          ) ?? "",
        ),

        approvedVersion: null,

        submittedBy: actorUid,

        submittedByNameSnapshot: actorName,

        submittedAt: nowTimestamp(),

        reviewedBy: null,

        reviewedByNameSnapshot: null,

        reviewedAt: null,

        reviewNote: null,

        updatedAt: nowTimestamp(),
      };

      if (existing.exists()) {
        transaction.update(reference, review);
      } else {
        transaction.set(reference, {
          ...review,
          createdAt: nowTimestamp(),
        });
      }

      transaction.set(
        doc(collection(db, "auditLogs")),
        {
          actorUid,

          action: "contract.submitted",

          resource: {
            collection: "reservationContracts",
            id: reservationId,
          },

          details: { version },

          createdAt: nowTimestamp(),
        },
      );
    },
  );

  return { reservationId, version };
}

/*
 * Approval freezes the agreement. The snapshot is built from
 * the stored reservation, customer and vehicle inside the
 * same transaction that records the decision, and is written
 * to a versioned document the security rules make immutable,
 * so what was approved is what is later sent.
 */
async function reviewContract(
  input: {
    reservationId: string;
    decision: "approve" | "reject";
    note: string | null;
  },
): Promise<{
  reservationId: string;
  status: ContractStatus;
  version: number;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const reservationId = trimmedOrNull(
    input.reservationId,
  );

  if (!reservationId) {
    throw new Error(
      "A booking reference is required.",
    );
  }

  if (
    input.decision !== "approve" &&
    input.decision !== "reject"
  ) {
    throw new Error(
      "Choose whether to approve or reject the contract.",
    );
  }

  const note = trimmedOrNull(input.note);

  if (input.decision === "reject" && !note) {
    throw new Error(
      "Explain why the contract is being rejected.",
    );
  }

  if (note && note.length > 1000) {
    throw new Error(
      "Keep the review note under 1000 characters.",
    );
  }

  const reference = contractRef(reservationId);

  const reservationRef = doc(
    db,
    "reservations",
    reservationId,
  );

  let version = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const [existing, reservationSnapshot] =
        await Promise.all([
          transaction.get(reference),
          transaction.get(reservationRef),
        ]);

      if (!existing.exists()) {
        throw new Error(
          "This contract has not been submitted for review.",
        );
      }

      if (
        contractStatusOf(
          existing.get("status"),
        ) !== "in_review"
      ) {
        throw new Error(
          "Only a contract waiting for review can be approved or rejected.",
        );
      }

      if (!reservationSnapshot.exists()) {
        throw new Error(
          "Booking was not found.",
        );
      }

      const actor = await actorProfileSnapshot(
        transaction,
        actorUid,
      );

      if (actor.role !== "admin") {
        throw new Error(
          "Only an administrator can approve or reject a contract.",
        );
      }

      version = Number(
        existing.get("version") ?? 1,
      );

      const reservation =
        reservationSnapshot.data() ?? {};

      if (input.decision === "reject") {
        transaction.update(reference, {
          status: "rejected",

          reviewedBy: actorUid,

          reviewedByNameSnapshot: actor.name,

          reviewedAt: nowTimestamp(),

          reviewNote: note,

          updatedAt: nowTimestamp(),
        });
      } else {
        /*
         * The agreement is issued at checkout and lives on
         * the rental, so the approved snapshot has to be
         * taken from there. Without it the emailed copy
         * would carry the booking's bare details and none of
         * what the renter actually signed.
         */
        const rentalId = trimmedOrNull(
          existing.get("rentalId"),
        );

        const [
          customerSnapshot,
          vehicleSnapshot,
          rentalSnapshot,
        ] = await Promise.all([
          transaction.get(
            doc(
              db,
              "customers",
              String(reservation.customerId),
            ),
          ),

          transaction.get(
            doc(
              db,
              "vehicles",
              String(reservation.vehicleId),
            ),
          ),

          rentalId
            ? transaction.get(
                doc(db, "rentals", rentalId),
              )
            : Promise.resolve(null),
        ]);

        const customer =
          customerSnapshot.data() ?? {};

        const vehicle =
          vehicleSnapshot.data() ?? {};

        const rental =
          rentalSnapshot?.data() ?? {};

        const rateSnapshot = (reservation.rateSnapshot ??
          {}) as Record<string, unknown>;

        const quote = (reservation.quote ??
          {}) as Record<string, unknown>;

        transaction.set(
          contractVersionRef(
            reservationId,
            version,
          ),
          {
            reservationId,

            version,

            approvedBy: actorUid,

            approvedByNameSnapshot: actor.name,

            approvedAt: nowTimestamp(),

            customer: {
              fullName: String(
                customer.fullName ??
                  reservation.customerNameSnapshot ??
                  "",
              ),

              telephone: String(
                customer.telephone ?? "",
              ),

              email: trimmedOrNull(
                customer.email,
              ),

              address: trimmedOrNull(
                customer.address,
              ),

              licenceNumber: String(
                customer.licenceNumber ?? "",
              ),

              licenceCountry: String(
                customer.licenceCountry ?? "",
              ),

              licenceExpiresAt: trimmedOrNull(
                customer.licenceExpiresAt,
              ),

              state: trimmedOrNull(
                customer.state,
              ),

              localAddress: trimmedOrNull(
                customer.localAddress,
              ),

              dateOfBirth: trimmedOrNull(
                customer.dateOfBirth,
              ),
            },

            vehicle: {
              registration: String(
                reservation.vehicleRegistrationSnapshot ??
                  vehicle.registrationNumber ??
                  "",
              ),

              make: String(vehicle.make ?? ""),

              model: String(
                vehicle.model ?? "",
              ),

              year:
                vehicle.year == null
                  ? null
                  : Number(vehicle.year),

              color: trimmedOrNull(
                vehicle.color,
              ),

              vin: trimmedOrNull(vehicle.vin),
            },

            pickupAt: toIso(
              reservation.pickupAt,
            ),

            expectedReturnAt: toIso(
              reservation.expectedReturnAt,
            ),

            pickupLocation: trimmedOrNull(
              reservation.pickupLocation,
            ),

            dropoffLocation: trimmedOrNull(
              reservation.dropoffLocation,
            ),

            notes: trimmedOrNull(
              reservation.notes,
            ),

            preparedBy: String(
              reservation.createdByNameSnapshot ??
                "",
            ),

            chargedDays: Number(
              quote.chargedDays ?? 0,
            ),

            baseRentalCents: Number(
              quote.baseRentalCents ?? 0,
            ),

            rateSnapshot: {
              dailyCents:
                rateSnapshot.dailyCents == null
                  ? null
                  : Number(
                      rateSnapshot.dailyCents,
                    ),

              weeklyCents:
                rateSnapshot.weeklyCents == null
                  ? null
                  : Number(
                      rateSnapshot.weeklyCents,
                    ),

              monthlyCents:
                rateSnapshot.monthlyCents == null
                  ? null
                  : Number(
                      rateSnapshot.monthlyCents,
                    ),
            },

            rentalId,

            /*
             * Everything the renter actually signed for:
             * readings, gas, waivers, deposit, payment and
             * the charge table, as the printed form shows
             * them.
             */
            agreement:
              approvedAgreementSnapshot(rental),

            signedByNameSnapshot: String(
              (
                (rental.agreement ??
                  {}) as Record<string, unknown>
              ).customerSignatureName ??
                customer.fullName ??
                reservation.customerNameSnapshot ??
                "",
            ),

            signatureMethod:
              (
                (rental.agreement ??
                  {}) as Record<string, unknown>
              ).customerSignatureMethod ===
              "typed"
                ? "typed"
                : "drawn",

            /* The rental is created by the checkout that
               took the signature, so its creation is when
               the renter accepted. */
            signatureCapturedAt:
              rental.createdAt == null
                ? null
                : toIso(rental.createdAt),
          },
        );

        transaction.update(reference, {
          status: "approved",

          approvedVersion: version,

          reviewedBy: actorUid,

          reviewedByNameSnapshot: actor.name,

          reviewedAt: nowTimestamp(),

          reviewNote: note,

          updatedAt: nowTimestamp(),
        });
      }

      transaction.set(
        doc(collection(db, "auditLogs")),
        {
          actorUid,

          action:
            input.decision === "approve"
              ? "contract.approved"
              : "contract.rejected",

          resource: {
            collection: "reservationContracts",
            id: reservationId,
          },

          details: { version, note },

          createdAt: nowTimestamp(),
        },
      );
    },
  );

  return {
    reservationId,

    status:
      input.decision === "approve"
        ? "approved"
        : "rejected",

    version,
  };
}

/* =========================================================
   Rental history
   ========================================================= */

export type RentalHistoryEntry = {
  rentalId: string;
  customerId: string;
  customerName: string;
  vehicleId: string;
  vehicleRegistration: string;
  status: string;
  /** Typed in from the paper file rather than run here. */
  isHistorical: boolean;
  /** Who booked it, handed it over and took it back. */
  bookedByName: string;
  rentedOutByName: string;
  returnedByName: string | null;
  pickupAt: string | null;
  expectedReturnAt: string | null;
  actualReturnAt: string | null;
  baseRentalCents: number;
  adjustmentCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
};

/*
 * History joins the two records a rental keeps: `rentals`,
 * which carries the dates, the status and the name of every
 * employee who touched it, and `rentalFinancials`, which
 * carries the money under the same document id.
 *
 * It is two capped collection reads and an in-memory join
 * rather than one read per row: a page of fifty rentals used
 * to be a single query and is now two, which is still two.
 *
 * Neither shape needs a composite index. The whole-fleet view
 * orders on a single field; the per-customer view filters on
 * a single field and is ordered here, which keeps the feature
 * from requiring an index deployment to work.
 */
async function listRentalHistory(
  input: {
    customerId?: string | null;
    limit?: number;
  },
): Promise<RentalHistoryEntry[]> {
  const { db } = getFirebaseClient();

  const customerId = trimmedOrNull(
    input.customerId,
  );

  const cap = Math.min(
    Math.max(
      Number(input.limit ?? 50) || 50,
      1,
    ),
    200,
  );

  const [rentals, financials] =
    await Promise.all([
      getDocs(
        customerId
          ? query(
              collection(db, "rentals"),
              where(
                "customerId",
                "==",
                customerId,
              ),
              limit(cap),
            )
          : query(
              collection(db, "rentals"),
              orderBy("createdAt", "desc"),
              limit(cap),
            ),
      ),

      getDocs(
        customerId
          ? query(
              collection(
                db,
                "rentalFinancials",
              ),
              where(
                "customerId",
                "==",
                customerId,
              ),
              limit(cap),
            )
          : query(
              collection(
                db,
                "rentalFinancials",
              ),
              orderBy("createdAt", "desc"),
              limit(cap),
            ),
      ),
    ]);

  /* The financial record is keyed by the rental's own id. */
  const money = new Map(
    financials.docs.map((entry) => [
      String(
        entry.get("rentalId") ?? entry.id,
      ),
      entry,
    ]),
  );

  const now = Date.now();

  return rentals.docs
    .map((entry) => {
      const financial = money.get(entry.id);

      const pickupAt =
        entry.get("pickupAt") == null
          ? null
          : toIso(entry.get("pickupAt"));

      const expectedReturnAt =
        entry.get("expectedReturnAt") == null
          ? null
          : toIso(
              entry.get("expectedReturnAt"),
            );

      const actualReturnAt =
        entry.get("actualReturnAt") == null
          ? null
          : toIso(
              entry.get("actualReturnAt"),
            );

      const isHistorical =
        entry.get("isHistorical") === true;

      const stored = String(
        entry.get("status") ?? "active",
      );

      /*
       * Overdue is derived from the expected return time, the
       * same rule the dashboard applies: nothing sweeps the
       * collection on a schedule, so a stored flag would be
       * stale rather than merely wrong.
       */
      const status =
        stored === "returned"
          ? "returned"
          : stored === "overdue" ||
              (expectedReturnAt !== null &&
                Date.parse(
                  expectedReturnAt,
                ) < now)
            ? "overdue"
            : stored;

      const bookedByName = String(
        entry.get("createdByNameSnapshot") ??
          "Not recorded",
      );

      const totalCents = Number(
        financial?.get("totalCents") ?? 0,
      );

      return {
        rentalId: entry.id,

        customerId: String(
          entry.get("customerId") ?? "",
        ),

        customerName: String(
          entry.get("customerNameSnapshot") ??
            "Unknown customer",
        ),

        vehicleId: String(
          entry.get("vehicleId") ?? "",
        ),

        vehicleRegistration: String(
          entry.get(
            "vehicleRegistrationSnapshot",
          ) ?? "Unknown vehicle",
        ),

        status,

        isHistorical,

        bookedByName,

        /*
         * Who actually handed the keys over. It falls back to
         * whoever booked it, because a rental checked out
         * before the snapshot existed has no other record of
         * it and a blank column answers nothing.
         */
        rentedOutByName: String(
          entry.get(
            "checkedOutByNameSnapshot",
          ) ?? bookedByName,
        ),

        returnedByName: trimmedOrNull(
          entry.get(
            "returnedByNameSnapshot",
          ),
        ),

        pickupAt,

        expectedReturnAt,

        actualReturnAt,

        baseRentalCents: Number(
          financial?.get(
            "baseRentalCents",
          ) ?? 0,
        ),

        adjustmentCents: Number(
          financial?.get(
            "adjustmentCents",
          ) ?? 0,
        ),

        totalCents,

        paidCents: Number(
          financial?.get("paidCents") ?? 0,
        ),

        outstandingCents: Number(
          financial?.get(
            "outstandingCents",
          ) ?? 0,
        ),

        /* Sort key only; not part of the result. */
        sortAt: new Date(
          actualReturnAt ??
            pickupAt ??
            0,
        ).getTime(),
      };
    })
    .sort((a, b) => b.sortAt - a.sortAt)
    .map(
      ({ sortAt: _sortAt, ...entry }) =>
        entry,
    );
}

/* =========================================================
   Historical rental entry
   ========================================================= */

/* How a payment was taken; the same list the till offers. */
const RENTAL_PAYMENT_METHODS = [
  "cash",
  "card",
  "bank_transfer",
  "other",
] as const;

export type PastRentalInput = {
  customerId: string;
  vehicleId: string;
  pickupAt: string;
  returnedAt: string;
  /** The employee who handed the vehicle over at the time. */
  handledByUid: string | null;
  baseRentalCents: number;
  additionalChargesCents: number;
  paidCents: number;
  paymentMethod: string | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  notes: string | null;
  idempotencyKey: string;
};

/*
 * A rental the office ran before this system existed, or one
 * that was written on paper while it was down.
 *
 * It is deliberately not the booking workflow with the dates
 * changed: nothing is reserved, no vehicle changes status and
 * no agreement is issued, because all of that already
 * happened. What is written is the record — who rented what,
 * from whom, between which dates and for how much — flagged
 * as historical so no screen mistakes it for a live booking.
 */
async function recordPastRental(
  input: PastRentalInput,
): Promise<{
  rentalId: string;
  reservationId: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const pickupAt =
    asTimestamp(
      input.pickupAt,
    );

  const returnedAt =
    asTimestamp(
      input.returnedAt,
    );

  if (
    returnedAt.toMillis() <=
    pickupAt.toMillis()
  ) {
    throw new Error(
      "The return must be after the pickup.",
    );
  }

  /*
   * A "past" booking that has not happened yet would sit in
   * the records as a completed rental for a vehicle still on
   * the forecourt, so the whole window has to be behind us.
   */
  if (
    returnedAt.toMillis() >
    Date.now()
  ) {
    throw new Error(
      "A past booking cannot end in the future. Use the booking workflow instead.",
    );
  }

  const baseRentalCents =
    assertMoneyCents(
      input.baseRentalCents,
      "Rental amount",
    );

  if (baseRentalCents <= 0) {
    throw new Error(
      "Enter what the rental was charged at.",
    );
  }

  const additionalChargesCents =
    assertMoneyCents(
      input.additionalChargesCents ?? 0,
      "Additional charges",
    );

  const paidCents =
    assertMoneyCents(
      input.paidCents ?? 0,
      "Amount received",
    );

  const totalCents =
    baseRentalCents +
    additionalChargesCents;

  if (paidCents > totalCents) {
    throw new Error(
      "The amount received is more than the rental was charged at.",
    );
  }

  const paymentMethod =
    trimmedOrNull(
      input.paymentMethod,
    );

  if (
    paidCents > 0 &&
    (!paymentMethod ||
      !(
        RENTAL_PAYMENT_METHODS as readonly string[]
      ).includes(paymentMethod))
  ) {
    throw new Error(
      "Select how the payment was taken.",
    );
  }

  const idempotencyKey =
    trimmedOrNull(
      input.idempotencyKey,
    );

  if (!idempotencyKey) {
    throw new Error(
      "A past booking needs an operation key.",
    );
  }

  const handledByUid =
    trimmedOrNull(
      input.handledByUid,
    ) ?? actorUid;

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `past_rental_${idempotencyKey}`,
    );

  const reservationRef =
    doc(
      collection(
        db,
        "reservations",
      ),
    );

  const rentalRef =
    doc(
      collection(
        db,
        "rentals",
      ),
    );

  let recordedRentalId =
    rentalRef.id;

  let recordedReservationId =
    reservationRef.id;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      /*
       * A repeated submission replays what was written the
       * first time rather than entering the same historical
       * rental twice.
       */
      if (previous.exists()) {
        const response =
          previous.get(
            "response",
          ) as {
            rentalId?: string;
            reservationId?: string;
          };

        recordedRentalId =
          response?.rentalId ??
          recordedRentalId;

        recordedReservationId =
          response?.reservationId ??
          recordedReservationId;

        return;
      }

      const [
        vehicleSnapshot,
        customerSnapshot,
      ] = await Promise.all([
        transaction.get(
          doc(
            db,
            "vehicles",
            String(
              input.vehicleId,
            ),
          ),
        ),

        transaction.get(
          doc(
            db,
            "customers",
            String(
              input.customerId,
            ),
          ),
        ),
      ]);

      if (!vehicleSnapshot.exists()) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      if (!customerSnapshot.exists()) {
        throw new Error(
          "Customer was not found.",
        );
      }

      const recordedByNameSnapshot =
        await actorNameSnapshot(
          transaction,
          actorUid,
        );

      /*
       * The name of the employee who handled the rental is
       * read from their own profile, never taken from the
       * form, so the attribution on a historical record is
       * as trustworthy as it is on a live one.
       */
      const handledByNameSnapshot =
        handledByUid === actorUid
          ? recordedByNameSnapshot
          : await actorNameSnapshot(
              transaction,
              handledByUid,
            );

      const customerNameSnapshot =
        String(
          customerSnapshot.get(
            "fullName",
          ) ?? "",
        );

      const vehicleRegistrationSnapshot =
        String(
          vehicleSnapshot.get(
            "registrationNumber",
          ) ?? "",
        );

      const notes =
        trimmedOrNull(
          input.notes,
        );

      const shared = {
        customerId:
          customerSnapshot.id,

        customerNameSnapshot,

        vehicleId:
          vehicleSnapshot.id,

        vehicleRegistrationSnapshot,

        pickupAt,

        expectedReturnAt:
          returnedAt,

        pickupLocation:
          trimmedOrNull(
            input.pickupLocation,
          ),

        dropoffLocation:
          trimmedOrNull(
            input.dropoffLocation,
          ),

        /*
         * What separates this record from a live one. Every
         * screen that lists rentals reads it, so a rental
         * typed in from the paper file is never counted as
         * a vehicle that is out.
         */
        isHistorical: true,

        source: "manual_past_entry",

        createdBy: handledByUid,

        createdByNameSnapshot:
          handledByNameSnapshot,

        handledBy: handledByUid,

        handledByNameSnapshot,

        recordedBy: actorUid,

        recordedByNameSnapshot,

        notes,

        createdAt: nowTimestamp(),

        updatedAt: nowTimestamp(),
      };

      transaction.set(
        reservationRef,
        {
          ...shared,

          status: "completed",

          bookingMedia: [],

          rentalId: rentalRef.id,

          completedAt: returnedAt,

          rateSnapshot: {
            currency: "USD",
            dailyCents: null,
            weeklyCents: null,
            monthlyCents: null,
            quotedAt:
              new Date().toISOString(),
            vehicleId:
              vehicleSnapshot.id,
            vehicleRegistration:
              vehicleRegistrationSnapshot,
          },

          quote: {
            chargedDays:
              chargedRentalDays({
                pickupAt:
                  pickupAt
                    .toDate()
                    .toISOString(),
                expectedReturnAt:
                  returnedAt
                    .toDate()
                    .toISOString(),
              }),
            dailyUnits: 0,
            weeklyUnits: 0,
            monthlyUnits: 0,
            baseRentalCents,
            currency: "USD",
          },
        },
      );

      transaction.set(
        rentalRef,
        {
          ...shared,

          reservationId:
            reservationRef.id,

          status: "returned",

          actualReturnAt: returnedAt,

          checkedOutBy: handledByUid,

          checkedOutByNameSnapshot:
            handledByNameSnapshot,

          returnedBy: handledByUid,

          returnedByNameSnapshot:
            handledByNameSnapshot,

          checkoutNotes: notes,

          returnNotes: notes,

          checkoutMedia: [],

          returnMedia: [],

          adjustments: [],
        },
      );

      transaction.set(
        doc(
          db,
          "rentalFinancials",
          rentalRef.id,
        ),
        {
          rentalId: rentalRef.id,

          vehicleId:
            vehicleSnapshot.id,

          vehicleRegistration:
            vehicleRegistrationSnapshot,

          customerId:
            customerSnapshot.id,

          customerNameSnapshot,

          rentalStatus: "returned",

          isHistorical: true,

          handledByNameSnapshot,

          pickupAt,

          actualReturnAt: returnedAt,

          baseRentalCents,

          adjustmentCents:
            additionalChargesCents,

          totalCents,

          paidCents,

          refundedCents: 0,

          refundedPaymentCents: 0,

          depositHeldCents: 0,

          refundedDepositCents: 0,

          outstandingCents:
            totalCents - paidCents,

          currency: "USD",

          createdAt: nowTimestamp(),

          updatedAt: nowTimestamp(),
        },
      );

      if (paidCents > 0) {
        transaction.set(
          doc(
            collection(
              db,
              "payments",
            ),
          ),
          {
            rentalId: rentalRef.id,

            vehicleId:
              vehicleSnapshot.id,

            customerId:
              customerSnapshot.id,

            amountCents: paidCents,

            method: paymentMethod,

            externalReference: null,

            isHistorical: true,

            receivedAt: returnedAt,

            recordedBy: actorUid,

            createdAt: nowTimestamp(),
          },
        );
      }

      transaction.set(
        doc(
          collection(
            db,
            "financialLedger",
          ),
        ),
        {
          rentalId: rentalRef.id,

          vehicleId:
            vehicleSnapshot.id,

          vehicleRegistration:
            vehicleRegistrationSnapshot,

          customerId:
            customerSnapshot.id,

          entryType:
            "historical_rental",

          amountCents: totalCents,

          occurredAt: returnedAt,

          recordedBy: actorUid,
        },
      );

      /*
       * Money received is counted from the ledger, dated when
       * the payment was taken, so a historical payment needs
       * the same entry a live one writes or the period it
       * belongs to will not show it.
       */
      if (paidCents > 0) {
        transaction.set(
          doc(
            collection(
              db,
              "financialLedger",
            ),
          ),
          {
            rentalId: rentalRef.id,

            vehicleId:
              vehicleSnapshot.id,

            vehicleRegistration:
              vehicleRegistrationSnapshot,

            customerId:
              customerSnapshot.id,

            entryType: "payment",

            amountCents: paidCents,

            isHistorical: true,

            occurredAt: returnedAt,

            recordedBy: actorUid,
          },
        );
      }

      transaction.set(
        doc(
          collection(
            db,
            "auditLogs",
          ),
        ),
        {
          actorUid,

          action:
            "rental.past_recorded",

          resource: {
            collection: "rentals",
            id: rentalRef.id,
          },

          details: {
            customerId:
              customerSnapshot.id,

            vehicleId:
              vehicleSnapshot.id,

            handledBy: handledByUid,

            handledByNameSnapshot,

            pickupAt: input.pickupAt,

            returnedAt:
              input.returnedAt,

            totalCents,

            paidCents,
          },

          createdAt: nowTimestamp(),
        },
      );

      transaction.set(
        operationRef,
        {
          response: {
            rentalId: rentalRef.id,

            reservationId:
              reservationRef.id,
          },

          actorUid,

          createdAt: nowTimestamp(),
        },
      );
    },
  );

  return {
    rentalId: recordedRentalId,
    reservationId:
      recordedReservationId,
  };
}

/* =========================================================
   Expense records
   ========================================================= */

export type ExpenseRecord = {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  category: string;
  amountCents: number;
  occurredAt: string | null;
  vendor: string | null;
  note: string;
  recordedBy: string;
};

/*
 * The expenses this account is allowed to see.
 *
 * An administrator reads the whole book. Anyone else reads
 * only what they recorded themselves, which is what the
 * rules permit: `vehicleExpenses` is admin-read except for
 * the recorder's own entries, so the `recordedBy` filter is
 * not a convenience — without it the query is refused.
 */
async function listVehicleExpenses(
  input: {
    mine?: boolean;
    limit?: number;
  },
): Promise<ExpenseRecord[]> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const cap = Math.min(
    Math.max(
      Number(input?.limit ?? 100) || 100,
      1,
    ),
    500,
  );

  const snapshot = await getDocs(
    input?.mine
      ? query(
          collection(
            db,
            "vehicleExpenses",
          ),
          where(
            "recordedBy",
            "==",
            actorUid,
          ),
          limit(cap),
        )
      : query(
          collection(
            db,
            "vehicleExpenses",
          ),
          limit(cap),
        ),
  );

  return snapshot.docs
    .map((entry) => {
      const occurredAt =
        entry.get("occurredAt") == null
          ? null
          : toIso(entry.get("occurredAt"));

      return {
        id: entry.id,

        vehicleId: String(
          entry.get("vehicleId") ?? "",
        ),

        vehicleRegistration: String(
          entry.get("vehicleRegistration") ??
            "Unknown vehicle",
        ),

        category: String(
          entry.get("category") ?? "other",
        ),

        amountCents: Number(
          entry.get("amountCents") ?? 0,
        ),

        occurredAt,

        vendor: trimmedOrNull(
          entry.get("vendor"),
        ),

        note: String(
          entry.get("note") ?? "",
        ),

        recordedBy: String(
          entry.get("recordedBy") ?? "",
        ),

        /* Sort key only; dropped below. */
        sortAt: Date.parse(
          occurredAt ?? "",
        ),
      };
    })
    .sort(
      (a, b) =>
        (Number.isNaN(b.sortAt)
          ? 0
          : b.sortAt) -
        (Number.isNaN(a.sortAt)
          ? 0
          : a.sortAt),
    )
    .map(
      ({ sortAt: _sortAt, ...entry }) =>
        entry,
    );
}

/* =========================================================
   Rental documents
   ========================================================= */

export type RentalMediaItem = {
  url: string;
  publicId: string;
  originalFilename: string;
  format: string;
};

export type RentalDocuments = {
  rentalId: string;
  customerId: string;
  customerName: string;
  vehicleRegistration: string;
  /*
   * A Cloudinary URL, or a Firebase Storage path for a
   * licence captured before the move to Cloudinary. The
   * screen resolves whichever it is given.
   */
  licenceStoragePath: string | null;
  bookingMedia: RentalMediaItem[];
  checkoutMedia: RentalMediaItem[];
  returnMedia: RentalMediaItem[];
};

/*
 * Only what is needed to show a picture: the stored media
 * objects also carry byte counts and dimensions that no
 * viewer reads.
 */
function mediaItems(
  value: unknown,
): RentalMediaItem[] {
  return sanitizeMediaList(value)
    .filter(
      (item) =>
        typeof item.url === "string" &&
        String(item.url).length > 0,
    )
    .map((item, index) => ({
      url: String(item.url),

      publicId: String(
        item.publicId ?? `media-${index}`,
      ),

      originalFilename: String(
        item.originalFilename ?? "Photo",
      ),

      format: String(item.format ?? ""),
    }));
}

/*
 * Everything filed against one rental that somebody at the
 * desk might need to look at: the renter's licence, and the
 * vehicle as it was photographed at booking, at handover and
 * on its return.
 *
 * The agreement itself is not here — it is rebuilt from the
 * booking by getRentalAgreement, which the same dialog
 * already reads.
 */
async function getRentalDocuments(
  input: { rentalId: string },
): Promise<RentalDocuments> {
  const { db } = getFirebaseClient();

  const rentalRef = doc(
    db,
    "rentals",
    String(input.rentalId),
  );

  const rental = await getDoc(rentalRef);

  if (!rental.exists()) {
    throw new Error(
      "Rental was not found.",
    );
  }

  const customerId = trimmedOrNull(
    rental.get("customerId"),
  );

  /*
   * A rental whose customer has since been removed still has
   * its photographs and its name snapshot, so a missing
   * customer costs the licence image and nothing else.
   */
  const customer = customerId
    ? await getDoc(
        doc(db, "customers", customerId),
      )
    : null;

  return {
    rentalId: rental.id,

    customerId: customerId ?? "",

    customerName: String(
      rental.get("customerNameSnapshot") ??
        customer?.get("fullName") ??
        "Unknown customer",
    ),

    vehicleRegistration: String(
      rental.get(
        "vehicleRegistrationSnapshot",
      ) ?? "Unknown vehicle",
    ),

    licenceStoragePath:
      customer && customer.exists()
        ? trimmedOrNull(
            customer.get(
              "licenceStoragePath",
            ),
          )
        : null,

    bookingMedia: mediaItems(
      rental.get("bookingMedia"),
    ),

    checkoutMedia: mediaItems(
      rental.get("checkoutMedia"),
    ),

    returnMedia: mediaItems(
      rental.get("returnMedia"),
    ),
  };
}

/* =========================================================
   Compatibility dispatcher
   ========================================================= */

export async function callFirestoreOperation<
  TInput,
  TResult,
>(
  name: string,
  data: TInput,
): Promise<TResult> {
  switch (name) {
    case "getOperationalDashboard":
      return (
        (await getOperationalDashboard()) as TResult
      );
    case "getPayableRentals":
  return (
    (await getPayableRentals()) as TResult
  );
    case "getFinancialOverview":
      return (
        (await getFinancialOverview(
          data as {
            from: string;
            to: string;
            vehicleId: string | null;
          },
        )) as TResult
      );

    case "getLedgerEntryDetail":
      return (
        (await getLedgerEntryDetail(
          data as { entryId: string },
        )) as TResult
      );

    case "listVehicleExpenses":
      return (
        (await listVehicleExpenses(
          data as {
            mine?: boolean;
            limit?: number;
          },
        )) as TResult
      );

    case "recordVehicleExpense":
      return (
        (await recordVehicleExpense(
          data as {
            vehicleId: string;
            category: string;
            amountCents: number;
            occurredAt: string;
            vendor:
              | string
              | null;
            note: string;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "createOrUpdateCustomer":
      return (
        (await createOrUpdateCustomer(
          data as Record<
            string,
            unknown
          >,
        )) as TResult
      );

    case "updateCustomerLicenceDocument":
      return (
        (await updateCustomerLicenceDocument(
          data as {
            customerId: string;
            licenceStoragePath: string;
          },
        )) as TResult
      );

    case "deleteCustomer":
      return (
        (await deleteCustomer(
          data as { customerId: string },
        )) as TResult
      );

    case "listRentalHistory":
      return (
        (await listRentalHistory(
          data as {
            customerId?: string | null;
            limit?: number;
          },
        )) as TResult
      );

    case "getContractWorkflow":
      return (
        (await getContractWorkflow(
          data as { reservationId: string },
        )) as TResult
      );

    case "listContractsForReview":
      return (
        (await listContractsForReview()) as TResult
      );

    case "submitContractForReview":
      return (
        (await submitContractForReview(
          data as {
            reservationId: string;
            rentalId?: string | null;
          },
        )) as TResult
      );

    case "reviewContract":
      return (
        (await reviewContract(
          data as {
            reservationId: string;
            decision: "approve" | "reject";
            note: string | null;
          },
        )) as TResult
      );

    case "getReservationContract":
      return (
        (await getReservationContract(
          data as { reservationId: string },
        )) as TResult
      );

    case "getRentalDocuments":
      return (
        (await getRentalDocuments(
          data as { rentalId: string },
        )) as TResult
      );

    case "getRentalAgreement":
      return (
        (await getRentalAgreement(
          data as { rentalId: string },
        )) as TResult
      );

    case "createReservation":
      return (
        (await createReservation(
          data as {
            customerId: string;
            vehicleId: string;
            pickupAt: string;
            expectedReturnAt: string;
            pickupLocation: string | null;
            dropoffLocation: string | null;
            notes: string | null;
            bookingMedia: Array<
              Record<string, unknown>
            >;
          },
        )) as TResult
      );

    case "recordPastRental":
      return (
        (await recordPastRental(
          data as PastRentalInput,
        )) as TResult
      );

    case "updateVehicleDamage":
      return (
        (await updateVehicleDamage(
          data as {
            vehicleId: string;
            damageMarks: unknown;
          },
        )) as TResult
      );

    case "cancelReservation":
      return (
        (await cancelReservation(
          data as {
            reservationId: string;
            reason: string;
          },
        )) as TResult
      );

    case "checkoutReservation":
      return (
        (await checkoutReservation(
          data as {
            reservationId: string;
            pickupFuelLevel: string;
            pickupOdometer: {
              value: number;
              unit: "km" | "mi";
            };
            notes: string | null;
          },
        )) as TResult
      );

    case "extendRental":
      return (
        (await extendRental(
          data as {
            rentalId: string;
            expectedReturnAt: string;
            note: string;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "returnRental":
      return (
        (await returnRental(
          data as {
            rentalId: string;
            actualReturnAt: string;
            returnFuelLevel: string;
            returnOdometer: {
              value: number;
              unit: "km" | "mi";
            };
            adjustments: Array<{
              type: string;
              amountCents: number;
              note: string;
            }>;
            waivers?: Record<
              string,
              unknown
            > | null;
            extraHours?: number | null;
            notes: string | null;
            returnMedia: Array<
              Record<string, unknown>
            >;
          },
        )) as TResult
      );

    case "recordRentalPayment":
      return (
        (await recordRentalPayment(
          data as {
            rentalId: string;
            amountCents: number;
            method: string;
            externalReference:
              | string
              | null;
            additionalFees?: Array<{
              type: string;
              amountCents: number;
            }>;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "requestRentalDiscount":
      return (
        (await requestRentalDiscount(
          data as {
            rentalId: string;
            amountCents: number;
            reason: string;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "reviewRentalDiscount":
      return (
        (await reviewRentalDiscount(
          data as {
            discountId: string;
            decision: "approve" | "reject";
            note: string | null;
          },
        )) as TResult
      );

    case "listPendingDiscounts":
      return (
        (await listPendingDiscounts()) as TResult
      );

    case "createVehicle":
      return (
        (await createVehicle(
          data as {
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
            photos?: Array<
              Record<string, unknown>
            >;
          },
        )) as TResult
      );

    case "updateVehicleDetails":
      await updateVehicleDetails(
        data as Record<
          string,
          unknown
        >,
      );

      return undefined as TResult;

    case "changeVehicleStatus":
      await changeVehicleStatus(
        data as {
          vehicleId: string;
          status: VehicleStatus;
          note: string;
        },
      );

      return undefined as TResult;

    default:
      throw new Error(
        `Unsupported rental operation: ${name}`,
      );
  }
}