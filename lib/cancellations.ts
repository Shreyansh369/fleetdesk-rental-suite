import {
  collection,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * A cancelled booking is kept, not deleted, but nothing used
 * to say it had happened: it simply left the list of bookings
 * awaiting checkout. These helpers let the shell count the
 * cancellations a person has not seen yet and let the
 * Bookings screen say who called each one off, when and why.
 */

/* Older than this and a cancellation is history, not news. */
export const CANCELLATION_WINDOW_DAYS = 14;

const CANCELLATION_LIMIT = 50;

/* Sent when the Bookings screen has shown the list. */
export const CANCELLATIONS_SEEN_EVENT =
  "aar:cancellations-seen";

export type CancelledBooking = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  pickupAt: string | null;
  expectedReturnAt: string | null;
  cancelledAt: string;
  cancelledByName: string | null;
  reason: string | null;
};

export function recentCancellationsQuery() {
  const since = new Date();

  since.setDate(
    since.getDate() - CANCELLATION_WINDOW_DAYS,
  );

  /*
   * Only a cancelled booking carries cancelledAt, so a range
   * on that one field finds them without a composite index.
   */
  return query(
    collection(
      getFirebaseClient().db,
      "reservations",
    ),
    where(
      "cancelledAt",
      ">=",
      Timestamp.fromDate(since),
    ),
    orderBy("cancelledAt", "desc"),
    limit(CANCELLATION_LIMIT),
  );
}

function isoOf(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === "string" && value) {
    const date = new Date(value);

    return Number.isNaN(date.valueOf())
      ? null
      : date.toISOString();
  }

  return null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export function cancelledBookingFrom(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): CancelledBooking {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    customerName: String(
      data.customerNameSnapshot ?? "",
    ),
    vehicleRegistration: String(
      data.vehicleRegistrationSnapshot ?? "",
    ),
    pickupAt: isoOf(data.pickupAt),
    expectedReturnAt: isoOf(
      data.expectedReturnAt,
    ),
    cancelledAt:
      isoOf(data.cancelledAt) ??
      new Date(0).toISOString(),
    cancelledByName: textOrNull(
      data.cancelledByNameSnapshot,
    ),
    reason: textOrNull(data.cancellationReason),
  };
}

/*
 * What a person has already seen is remembered on their own
 * device. It is only a nudge: losing it (a private window, a
 * cleared browser) at worst shows the last fortnight as new.
 */
function seenKey(uid: string): string {
  return `aar:cancellations-seen:${uid}`;
}

export function cancellationsSeenAt(
  uid: string,
): number {
  try {
    const value = Number(
      window.localStorage.getItem(seenKey(uid)),
    );

    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function markCancellationsSeen(
  uid: string,
): void {
  try {
    window.localStorage.setItem(
      seenKey(uid),
      String(Date.now()),
    );
  } catch {
    // Storage is unavailable; the badge simply stays.
  }

  window.dispatchEvent(
    new Event(CANCELLATIONS_SEEN_EVENT),
  );
}
