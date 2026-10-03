"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

import { useEffect, useRef, useState } from "react";

import { useFirebaseAuth } from "./firebase-provider";

import { getFirebaseClient } from "@/lib/firebase/client";

import { firebaseErrorMessage } from "@/lib/presentation";

import {
  callFirestoreOperation,
  type PastRentalInput,
} from "@/lib/services/firestore-client";

import { listAssignableStaff } from "@/lib/services/staff-directory";

/*
 * A rental the office ran before this system, or while it was
 * unavailable, typed in from the paper file.
 *
 * It is deliberately not the booking workflow with the dates
 * changed: nothing is reserved, no vehicle changes status and
 * no agreement is issued, because all of that already
 * happened. It lives beside the history it belongs to rather
 * than among the live workflows, which is where somebody
 * looking at an incomplete history would go.
 */

type Option = {
  id: string;
  label: string;
};

function todayDateTime(): string {
  const now = new Date();

  const pad = (value: number) =>
    String(value).padStart(2, "0");

  return `${now.getFullYear()}-${pad(
    now.getMonth() + 1,
  )}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

function toIso(
  value: FormDataEntryValue | null,
): string {
  const date = new Date(String(value));

  if (Number.isNaN(date.valueOf())) {
    throw new Error(
      "Enter a valid date and time.",
    );
  }

  return date.toISOString();
}

function dollarsToCents(
  value: FormDataEntryValue | null,
): number {
  const amount = Number(
    String(value ?? "").trim() || 0,
  );

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return 0;
  }

  return Math.round(amount * 100);
}

export function PastBookingForm({
  onRecorded,
  onCancel,
}: {
  onRecorded: () => void;
  onCancel: () => void;
}) {
  const { user } = useFirebaseAuth();

  const [customers, setCustomers] = useState<
    Option[]
  >([]);

  const [vehicles, setVehicles] = useState<
    Option[]
  >([]);

  const [staff, setStaff] = useState<
    Array<{ uid: string; fullName: string }>
  >([]);

  const [busy, setBusy] = useState(false);

  const [error, setError] =
    useState<string>();

  /*
   * Held across retries so a lost response cannot enter the
   * same historical rental twice; replaced once it is stored.
   */
  const operationKey =
    useRef<string>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { db } = getFirebaseClient();

        const [people, fleet, assignable] =
          await Promise.all([
            getDocs(
              query(
                collection(db, "customers"),
                orderBy("fullName"),
                limit(500),
              ),
            ),

            getDocs(
              query(
                collection(db, "vehicles"),
                orderBy(
                  "registrationNumber",
                ),
                limit(100),
              ),
            ),

            listAssignableStaff(),
          ]);

        if (cancelled) {
          return;
        }

        setCustomers(
          people.docs.map((entry) => ({
            id: entry.id,

            label: `${entry.get(
              "fullName",
            )} · ${entry.get("telephone")}`,
          })),
        );

        setVehicles(
          fleet.docs.map((entry) => ({
            id: entry.id,

            label: `${entry.get(
              "registrationNumber",
            )} · ${entry.get(
              "make",
            )} ${entry.get("model")}`,
          })),
        );

        setStaff(assignable);
      } catch (cause) {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;

    const form = new FormData(formElement);

    setBusy(true);
    setError(undefined);

    try {
      const paidCents = dollarsToCents(
        form.get("paidAmount"),
      );

      await callFirestoreOperation<
        PastRentalInput,
        {
          rentalId: string;
          reservationId: string;
        }
      >("recordPastRental", {
        customerId: String(
          form.get("customerId") ?? "",
        ),

        vehicleId: String(
          form.get("vehicleId") ?? "",
        ),

        pickupAt: toIso(
          form.get("pickupAt"),
        ),

        returnedAt: toIso(
          form.get("returnedAt"),
        ),

        handledByUid:
          String(
            form.get("handledByUid") ?? "",
          ).trim() || null,

        baseRentalCents: dollarsToCents(
          form.get("rentalAmount"),
        ),

        additionalChargesCents:
          dollarsToCents(
            form.get("additionalAmount"),
          ),

        paidCents,

        paymentMethod:
          paidCents > 0
            ? String(
                form.get("paymentMethod") ??
                  "cash",
              )
            : null,

        pickupLocation:
          String(
            form.get("pickupLocation") ?? "",
          ).trim() || null,

        dropoffLocation:
          String(
            form.get("dropoffLocation") ??
              "",
          ).trim() || null,

        notes:
          String(
            form.get("notes") ?? "",
          ).trim() || null,

        idempotencyKey: (operationKey.current ??=
          crypto.randomUUID()),
      });

      operationKey.current = undefined;

      formElement.reset();

      onRecorded();
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="past-booking-panel">
      <div className="section-heading">
        <div>
          <p className="section-kicker">
            Past booking
          </p>

          <h2>
            Record a rental that already
            happened
          </h2>
        </div>
      </div>

      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <form
        className="form-grid"
        onSubmit={(event) =>
          void submit(event)
        }
      >
        <div className="field">
          <label htmlFor="past-customer">
            Customer
          </label>

          <select
            id="past-customer"
            name="customerId"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Select customer
            </option>

            {customers.map((customer) => (
              <option
                value={customer.id}
                key={customer.id}
              >
                {customer.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="past-vehicle">
            Vehicle
          </label>

          <select
            id="past-vehicle"
            name="vehicleId"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Select vehicle
            </option>

            {vehicles.map((vehicle) => (
              <option
                value={vehicle.id}
                key={vehicle.id}
              >
                {vehicle.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="past-pickup">
            Rental start
          </label>

          <input
            id="past-pickup"
            name="pickupAt"
            type="datetime-local"
            max={todayDateTime()}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="past-return">
            Return
          </label>

          <input
            id="past-return"
            name="returnedAt"
            type="datetime-local"
            max={todayDateTime()}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="past-handled-by">
            Handled by
          </label>

          <select
            id="past-handled-by"
            name="handledByUid"
            defaultValue=""
          >
            <option value="">Me</option>

            {/*
              * The signed-in account is the default above, so
              * listing it again would offer the same person
              * twice under two names.
              */}
            {staff
              .filter(
                (member) =>
                  member.uid !== user?.uid,
              )
              .map((member) => (
                <option
                  value={member.uid}
                  key={member.uid}
                >
                  {member.fullName}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="past-rental-amount">
            Rental charged (USD)
          </label>

          <input
            id="past-rental-amount"
            name="rentalAmount"
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            inputMode="decimal"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="past-additional-amount">
            Additional charges (USD)
          </label>

          <input
            id="past-additional-amount"
            name="additionalAmount"
            type="number"
            min="0"
            max="100000"
            step="0.01"
            inputMode="decimal"
            defaultValue="0"
          />
        </div>

        <div className="field">
          <label htmlFor="past-paid-amount">
            Amount received (USD)
          </label>

          <input
            id="past-paid-amount"
            name="paidAmount"
            type="number"
            min="0"
            max="100000"
            step="0.01"
            inputMode="decimal"
            defaultValue="0"
          />
        </div>

        <div className="field">
          <label htmlFor="past-payment-method">
            Payment method
          </label>

          <select
            id="past-payment-method"
            name="paymentMethod"
            defaultValue="cash"
          >
            <option value="cash">Cash</option>

            <option value="card">Card</option>

            <option value="bank_transfer">
              Bank transfer
            </option>

            <option value="other">
              Other
            </option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="past-pickup-location">
            Pickup location
          </label>

          <input
            id="past-pickup-location"
            name="pickupLocation"
            maxLength={160}
          />
        </div>

        <div className="field">
          <label htmlFor="past-dropoff-location">
            Drop-off location
          </label>

          <input
            id="past-dropoff-location"
            name="dropoffLocation"
            maxLength={160}
          />
        </div>

        <div className="field full">
          <label htmlFor="past-notes">
            Notes
          </label>

          <textarea
            id="past-notes"
            name="notes"
            maxLength={1000}
          />
        </div>

        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>

          <button
            className="button button-primary"
            disabled={
              busy ||
              !customers.length ||
              !vehicles.length
            }
          >
            {busy
              ? "Recording…"
              : "Record past booking"}
          </button>
        </div>
      </form>
    </section>
  );
}
