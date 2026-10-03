"use client";

import { ArrowUpDown } from "lucide-react";

import { useEffect, useState } from "react";

import {
  callFirestoreOperation,
  type RentalHistoryEntry,
} from "@/lib/services/firestore-client";

import {
  firebaseErrorMessage,
  formatMoney,
} from "@/lib/presentation";

import { RentalAgreement } from "./rental-agreement";

/*
 * One history list, shown on the dashboard as a recent-activity
 * panel and on the customers screen as a full table. Both read
 * the same records so the two screens can never disagree about
 * what a rental cost.
 */
export type RentalHistoryProps = {
  /** Limits the history to a single customer. */
  customerId?: string | null;

  limit?: number;

  /** Free-text filter applied by the customers screen. */
  search?: string;

  /** The dashboard shows a trimmed set of columns. */
  compact?: boolean;

  reloadToken?: number;
};

function day(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusLabel(status: string): string {
  switch (status) {
    case "returned":
      return "Returned";

    case "overdue":
      return "Overdue";

    case "active":
      return "On rent";

    default:
      return status
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) =>
          letter.toUpperCase(),
        );
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "returned":
      return "available";

    case "overdue":
      return "overdue";

    case "active":
      return "rented";

    default:
      return "";
  }
}

type SortKey =
  | "time"
  | "rentedOutBy"
  | "renter"
  | "vehicle"
  | "date"
  | "amount";

const COLUMNS: Array<{
  key: SortKey;
  label: string;
}> = [
  { key: "vehicle", label: "Vehicle" },
  { key: "renter", label: "Renter" },
  {
    key: "rentedOutBy",
    label: "Rented out by",
  },
  { key: "date", label: "Picked up" },
  { key: "time", label: "Returned" },
  { key: "amount", label: "Rent" },
];

function millis(
  value: string | null,
): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareOn(
  key: SortKey,
  left: RentalHistoryEntry,
  right: RentalHistoryEntry,
): number {
  switch (key) {
    case "rentedOutBy":
      return left.rentedOutByName.localeCompare(
        right.rentedOutByName,
      );

    case "renter":
      return left.customerName.localeCompare(
        right.customerName,
      );

    case "vehicle":
      return left.vehicleRegistration.localeCompare(
        right.vehicleRegistration,
      );

    case "date":
      return (
        millis(left.pickupAt) -
        millis(right.pickupAt)
      );

    case "amount":
      return (
        left.totalCents - right.totalCents
      );

    /*
     * "Time" is when the rental last moved — its return, or
     * its pickup while it is still out — which is the order
     * the list opens in.
     */
    default:
      return (
        millis(
          left.actualReturnAt ??
            left.pickupAt,
        ) -
        millis(
          right.actualReturnAt ??
            right.pickupAt,
        )
      );
  }
}

export function RentalHistory({
  customerId = null,
  limit = 50,
  search = "",
  compact = false,
  reloadToken = 0,
}: RentalHistoryProps) {
  const [entries, setEntries] = useState<
    RentalHistoryEntry[]
  >([]);

  const [error, setError] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  /*
   * The agreement the office is looking at. Opening a history
   * row is how staff pull up the paperwork a renter signed.
   */
  const [openRentalId, setOpenRentalId] =
    useState<string>();

  /*
   * The table sorts on whichever column the office is asking
   * a question about: who rented this out, who rented it, for
   * how much, and when.
   */
  const [sort, setSort] = useState<{
    key: SortKey;
    ascending: boolean;
  }>({ key: "time", ascending: false });

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            ascending: !current.ascending,
          }
        : {
            key,

            /* Dates and money read newest and largest
               first; names read A to Z. */
            ascending: !(
              key === "time" ||
              key === "date" ||
              key === "amount"
            ),
          },
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result =
          await callFirestoreOperation<
            {
              customerId: string | null;
              limit: number;
            },
            RentalHistoryEntry[]
          >("listRentalHistory", {
            customerId,
            limit,
          });

        if (cancelled) {
          return;
        }

        setEntries(result);
        setError(undefined);
      } catch (cause) {
        if (!cancelled) {
          setEntries([]);

          setError(
            firebaseErrorMessage(cause),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    customerId,
    limit,
    reloadToken,
  ]);

  const needle = search
    .trim()
    .toLowerCase();

  const matched = needle
    ? entries.filter((entry) =>
        [
          entry.customerName,
          entry.vehicleRegistration,
          entry.rentedOutByName,
          entry.bookedByName,
          entry.returnedByName,
          entry.status,
          entry.isHistorical
            ? "past booking"
            : "",
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      )
    : entries;

  const visible = [...matched].sort(
    (left, right) => {
      const order = compareOn(
        sort.key,
        left,
        right,
      );

      return sort.ascending
        ? order
        : -order;
    },
  );

  if (loading) {
    return (
      <div
        className="inline-empty"
        role="status"
        aria-live="polite"
      >
        Loading rental history...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="alert alert-error"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="inline-empty">
        {entries.length === 0
          ? "No rentals have been recorded yet."
          : "No rentals match this search."}
      </div>
    );
  }

  const sheet = openRentalId ? (
    <RentalAgreement
      rentalId={openRentalId}
      onClose={() =>
        setOpenRentalId(undefined)
      }
    />
  ) : null;

  /*
   * A booking typed in from the paper file reads as
   * "Returned" like any other closed rental, so it is
   * labelled for what it is rather than presented as
   * something this system ran.
   */
  function entryStatusLabel(
    entry: RentalHistoryEntry,
  ): string {
    return entry.isHistorical
      ? "Past booking"
      : statusLabel(entry.status);
  }

  function entryStatusTone(
    entry: RentalHistoryEntry,
  ): string {
    return entry.isHistorical
      ? "cleaning"
      : statusTone(entry.status);
  }

  if (compact) {
    return (
      <div className="list-table">
        {visible.map((entry) => (
          <button
            type="button"
            className="pickup-row history-row"
            key={entry.rentalId}
            onClick={() =>
              setOpenRentalId(entry.rentalId)
            }
            aria-label={`Open the agreement for ${entry.customerName}`}
            title={`Open the agreement for ${entry.customerName}`}
          >
            <div className="pickup-time">
              <strong>
                {day(
                  entry.actualReturnAt ??
                    entry.pickupAt,
                )}
              </strong>

              <span>
                {entry.actualReturnAt
                  ? "returned"
                  : "picked up"}
              </span>
            </div>

            <div className="pickup-customer">
              <strong>
                {entry.customerName}
              </strong>

              <span>
                {entry.vehicleRegistration}
                {" · "}
                {formatMoney(
                  entry.totalCents,
                )}
                {entry.outstandingCents > 0
                  ? ` · ${formatMoney(
                      entry.outstandingCents,
                    )} outstanding`
                  : ""}
              </span>
            </div>

            <span
              className={`status-pill ${entryStatusTone(
                entry,
              )}`}
            >
              {entryStatusLabel(entry)}
            </span>
          </button>
        ))}

        {sheet}
      </div>
    );
  }

  return (
    <div className="table-wrap customer-table-wrap">
      <table className="sortable-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className="is-sortable"
                aria-sort={
                  sort.key === column.key
                    ? sort.ascending
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="column-sort"
                  onClick={() =>
                    sortBy(column.key)
                  }
                >
                  {column.label}

                  <ArrowUpDown
                    size={13}
                    aria-hidden="true"
                    className={
                      sort.key === column.key
                        ? "is-sorted"
                        : undefined
                    }
                  />
                </button>
              </th>
            ))}

            <th>Outstanding</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {visible.map((entry) => (
            <tr key={entry.rentalId}>
              <td>
                <strong>
                  {entry.vehicleRegistration}
                </strong>
              </td>

              <td>
                <button
                  type="button"
                  className="text-button history-open"
                  title={`Open the rental file for ${entry.customerName}`}
                  onClick={() =>
                    setOpenRentalId(
                      entry.rentalId,
                    )
                  }
                >
                  {entry.customerName}
                </button>
              </td>

              <td>
                <strong>
                  {entry.rentedOutByName}
                </strong>

                {entry.returnedByName &&
                  entry.returnedByName !==
                    entry.rentedOutByName && (
                    <span>
                      {`Returned to ${entry.returnedByName}`}
                    </span>
                  )}
              </td>

              <td>{day(entry.pickupAt)}</td>

              <td>
                {day(entry.actualReturnAt)}
              </td>

              <td>
                <strong>
                  {formatMoney(
                    entry.totalCents,
                  )}
                </strong>

                {entry.adjustmentCents > 0 && (
                  <span>
                    {formatMoney(
                      entry.baseRentalCents,
                    )}
                    {" base · "}
                    {formatMoney(
                      entry.adjustmentCents,
                    )}
                    {" adjustments"}
                  </span>
                )}
              </td>

              <td>
                {entry.outstandingCents > 0 ? (
                  <strong>
                    {formatMoney(
                      entry.outstandingCents,
                    )}
                  </strong>
                ) : (
                  "Settled"
                )}
              </td>

              <td>
                <span
                  className={`status-pill ${entryStatusTone(
                    entry,
                  )}`}
                >
                  {entryStatusLabel(entry)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sheet}
    </div>
  );
}
