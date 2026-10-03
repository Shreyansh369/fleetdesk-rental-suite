"use client";

import { onSnapshot } from "firebase/firestore";

import {
  useEffect,
  useState,
} from "react";

import { useFirebaseAuth } from "./firebase-provider";

import {
  CANCELLATION_WINDOW_DAYS,
  cancellationsSeenAt,
  cancelledBookingFrom,
  markCancellationsSeen,
  recentCancellationsQuery,
  type CancelledBooking,
} from "@/lib/cancellations";

const COLLAPSED_COUNT = 5;

function moment(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/*
 * Bookings called off in the last fortnight: who cancelled
 * each one, when, and why. The ones cancelled since this
 * person last looked are marked new, and opening the list is
 * what clears the count beside Bookings.
 */
export function CancelledBookings() {
  const { user } = useFirebaseAuth();

  const uid = user?.uid;

  const [bookings, setBookings] = useState<
    CancelledBooking[]
  >();

  const [seenBefore, setSeenBefore] =
    useState<number>();

  const [expanded, setExpanded] =
    useState(false);

  useEffect(() => {
    if (!uid) {
      return;
    }

    /* Read once, before this visit marks everything seen. */
    const seenAtOpen =
      cancellationsSeenAt(uid);

    let unsubscribe:
      | (() => void)
      | undefined;

    try {
      unsubscribe = onSnapshot(
        recentCancellationsQuery(),

        (snapshot) => {
          setSeenBefore(seenAtOpen);

          setBookings(
            snapshot.docs.map(
              cancelledBookingFrom,
            ),
          );

          markCancellationsSeen(uid);
        },

        () => setBookings([]),
      );
    } catch {
      // Firebase is unconfigured; the shell reports that itself.
    }

    return () => unsubscribe?.();
  }, [uid]);

  if (!bookings?.length) {
    return null;
  }

  const shown = expanded
    ? bookings
    : bookings.slice(0, COLLAPSED_COUNT);

  return (
    <section className="surface booking-list cancelled-list">
      <p className="section-kicker">
        Cancelled in the last{" "}
        {CANCELLATION_WINDOW_DAYS} days
      </p>

      <ul>
        {shown.map((booking) => (
          <li key={booking.id}>
            <strong>
              {booking.vehicleRegistration ||
                "Vehicle not recorded"}

              {seenBefore !== undefined &&
                new Date(
                  booking.cancelledAt,
                ).getTime() > seenBefore && (
                  <span className="cancelled-new">
                    New
                  </span>
                )}
            </strong>

            <small>
              {booking.customerName ||
                "Customer not recorded"}
              {booking.pickupAt
                ? ` · was ${moment(
                    booking.pickupAt,
                  )} → ${moment(
                    booking.expectedReturnAt,
                  )}`
                : ""}
            </small>

            <small>
              Cancelled {moment(booking.cancelledAt)}
              {" by "}
              {booking.cancelledByName ??
                "an unrecorded account"}
              {booking.reason
                ? ` · “${booking.reason}”`
                : " · no reason given"}
            </small>
          </li>
        ))}
      </ul>

      {bookings.length > COLLAPSED_COUNT && (
        <button
          className="text-button"
          type="button"
          onClick={() =>
            setExpanded((value) => !value)
          }
        >
          {expanded
            ? "Show fewer"
            : `Show all ${bookings.length}`}
        </button>
      )}
    </section>
  );
}
