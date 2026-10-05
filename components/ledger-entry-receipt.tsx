"use client";

import { Printer, X } from "@/components/icons";

import { createPortal } from "react-dom";

import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  callFirestoreOperation,
  type LedgerEntryDetail,
} from "@/lib/services/firestore-client";

import {
  firebaseErrorMessage,
  formatMoney,
} from "@/lib/presentation";

/** The hydration flag never changes, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

function dateTime(
  value: string | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* "rental_checkout" reads as "Rental checkout". */
export function entryTypeLabel(
  value: string,
): string {
  const words = value.replaceAll("_", " ");

  return (
    words.charAt(0).toUpperCase() +
    words.slice(1)
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="receipt-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/*
 * Opened from a line on the finance screen. It answers what
 * a bare amount cannot — which car, whose rental, who took
 * the money or allowed the discount, and when — and lays the
 * line beside everything else charged and paid on the same
 * rental, so the desk can read it as the customer's bill.
 */
export function LedgerEntryReceipt({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [detail, setDetail] =
    useState<LedgerEntryDetail>();

  const [error, setError] =
    useState<string>();

  useEffect(() => {
    let cancelled = false;

    callFirestoreOperation<
      { entryId: string },
      LedgerEntryDetail
    >("getLedgerEntryDetail", { entryId })
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entryId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () =>
      window.removeEventListener(
        "keydown",
        onKey,
      );
  }, [onClose]);

  if (!hydrated) {
    return null;
  }

  const entry = detail?.entry;

  const rental = detail?.rental;

  const bill = detail?.bill;

  const discount = detail?.discount;

  return createPortal(
    <div
      className="agreement-backdrop"
      role="presentation"
      onClick={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="agreement-modal receipt-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Entry details"
      >
        <header className="agreement-modal-header">
          <div>
            <p className="page-kicker">
              {entry
                ? entryTypeLabel(
                    entry.entryType,
                  )
                : "Entry"}
            </p>

            <h2>
              {entry
                ? formatMoney(
                    entry.amountCents,
                  )
                : "Loading…"}
            </h2>
          </div>

          <div className="agreement-modal-actions">
            <button
              className="button button-secondary compact"
              type="button"
              onClick={() => window.print()}
              disabled={!detail}
            >
              <Printer size={16} />
              Print
            </button>

            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div
            className="alert alert-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {entry && detail && (
          <article className="receipt">
            <h3 className="receipt-print-title">
              FleetDesk ·{" "}
              {entryTypeLabel(entry.entryType)}
            </h3>

            <section className="receipt-block">
              <p className="section-kicker">
                This entry
              </p>

              <Row
                label="Amount"
                value={formatMoney(
                  entry.amountCents,
                )}
              />

              <Row
                label="Date"
                value={dateTime(
                  entry.occurredAt,
                )}
              />

              <Row
                label="Recorded by"
                value={
                  entry.recordedByName ??
                  "Not recorded"
                }
              />

              <Row
                label="Vehicle"
                value={
                  entry.vehicleRegistration ||
                  "Not recorded"
                }
              />

              {detail.payment && (
                <>
                  <Row
                    label="Paid by"
                    value={entryTypeLabel(
                      detail.payment.method,
                    )}
                  />

                  {detail.payment
                    .externalReference && (
                    <Row
                      label="Reference"
                      value={
                        detail.payment
                          .externalReference
                      }
                    />
                  )}
                </>
              )}

              {entry.detailType &&
                !discount && (
                  <Row
                    label="Kind"
                    value={entryTypeLabel(
                      entry.detailType,
                    )}
                  />
                )}

              {detail.expense && (
                <>
                  <Row
                    label="Category"
                    value={entryTypeLabel(
                      detail.expense.category,
                    )}
                  />

                  {detail.expense.vendor && (
                    <Row
                      label="Vendor"
                      value={
                        detail.expense.vendor
                      }
                    />
                  )}
                </>
              )}

              {discount && (
                <>
                  <Row
                    label="Offered by"
                    value={`${
                      discount.requestedByName ||
                      "Not recorded"
                    } · ${dateTime(
                      discount.requestedAt,
                    )}`}
                  />

                  <Row
                    label="Approved by"
                    value={`${
                      discount.reviewedByName ??
                      "Not recorded"
                    } · ${dateTime(
                      discount.reviewedAt,
                    )}`}
                  />
                </>
              )}

              {(entry.note ??
                detail.expense?.note) && (
                <Row
                  label="Note"
                  value={
                    entry.note ??
                    detail.expense?.note
                  }
                />
              )}
            </section>

            {rental && (
              <section className="receipt-block">
                <p className="section-kicker">
                  Rental
                </p>

                <Row
                  label="Customer"
                  value={
                    rental.customerName ||
                    "Not recorded"
                  }
                />

                {rental.customerTelephone && (
                  <Row
                    label="Telephone"
                    value={
                      rental.customerTelephone
                    }
                  />
                )}

                <Row
                  label="Vehicle"
                  value={[
                    rental.vehicleRegistration,
                    rental.vehicleDescription,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />

                <Row
                  label="Picked up"
                  value={dateTime(
                    rental.pickupAt,
                  )}
                />

                <Row
                  label={
                    rental.actualReturnAt
                      ? "Returned"
                      : "Due back"
                  }
                  value={dateTime(
                    rental.actualReturnAt ??
                      rental.expectedReturnAt,
                  )}
                />

                <Row
                  label="Status"
                  value={entryTypeLabel(
                    rental.status,
                  )}
                />

                {rental.handledByName && (
                  <Row
                    label="Booked by"
                    value={
                      rental.handledByName
                    }
                  />
                )}

                {rental.checkedOutByName && (
                  <Row
                    label="Checked out by"
                    value={
                      rental.checkedOutByName
                    }
                  />
                )}

                {rental.returnedByName && (
                  <Row
                    label="Returned by"
                    value={
                      rental.returnedByName
                    }
                  />
                )}
              </section>
            )}

            {detail.lines.length > 1 && (
              <section className="receipt-block">
                <p className="section-kicker">
                  Everything on this rental
                </p>

                <ul className="receipt-lines">
                  {detail.lines.map(
                    (line) => (
                      <li
                        key={line.id}
                        className={
                          line.id === entry.id
                            ? "is-current"
                            : ""
                        }
                      >
                        <span>
                          <strong>
                            {entryTypeLabel(
                              line.entryType,
                            )}
                            {line.detailType &&
                            line.entryType !==
                              "rental_discount"
                              ? ` · ${entryTypeLabel(
                                  line.detailType,
                                )}`
                              : ""}
                          </strong>

                          <small>
                            {dateTime(
                              line.occurredAt,
                            )}
                            {line.recordedByName
                              ? ` · ${line.recordedByName}`
                              : ""}
                            {line.note
                              ? ` · ${line.note}`
                              : ""}
                          </small>
                        </span>

                        <b
                          className={
                            line.amountCents < 0
                              ? "amount-negative"
                              : ""
                          }
                        >
                          {formatMoney(
                            line.amountCents,
                          )}
                        </b>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            )}

            {bill && (
              <section className="receipt-block receipt-totals">
                <p className="section-kicker">
                  Bill
                </p>

                <Row
                  label="Rent"
                  value={formatMoney(
                    bill.baseRentalCents,
                  )}
                />

                <Row
                  label="Charges and discounts"
                  value={formatMoney(
                    bill.adjustmentCents,
                  )}
                />

                <Row
                  label="Total"
                  value={formatMoney(
                    bill.totalCents,
                  )}
                />

                <Row
                  label="Paid"
                  value={formatMoney(
                    bill.paidCents,
                  )}
                />

                {bill.refundedCents > 0 && (
                  <Row
                    label="Refunded"
                    value={formatMoney(
                      bill.refundedCents,
                    )}
                  />
                )}

                {bill.depositHeldCents > 0 && (
                  <Row
                    label="Deposit held"
                    value={formatMoney(
                      bill.depositHeldCents,
                    )}
                  />
                )}

                <Row
                  label="Still owed"
                  value={formatMoney(
                    bill.outstandingCents,
                  )}
                />
              </section>
            )}

            {detail.discounts.some(
              (item) =>
                item.status !== "approved",
            ) && (
              <section className="receipt-block">
                <p className="section-kicker">
                  Discount requests
                </p>

                <ul className="receipt-lines">
                  {detail.discounts
                    .filter(
                      (item) =>
                        item.status !==
                        "approved",
                    )
                    .map((item) => (
                      <li key={item.id}>
                        <span>
                          <strong>
                            {entryTypeLabel(
                              item.status,
                            )}{" "}
                            · {item.reason}
                          </strong>

                          <small>
                            Asked by{" "}
                            {item.requestedByName ||
                              "unknown"}{" "}
                            ·{" "}
                            {dateTime(
                              item.requestedAt,
                            )}
                            {item.reviewedByName
                              ? ` · decided by ${item.reviewedByName}`
                              : ""}
                          </small>
                        </span>

                        <b>
                          {formatMoney(
                            item.amountCents,
                          )}
                        </b>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </section>
    </div>,
    document.body,
  );
}
