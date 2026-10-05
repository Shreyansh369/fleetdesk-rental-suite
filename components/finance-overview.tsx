"use client";

import Link from "next/link";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "@/lib/data/firestore";

import {
  BarChart3,
  CircleDollarSign,
  CreditCard,
  HandCoins,
  ReceiptText,
  RefreshCw,
  WalletCards,
} from "@/components/icons";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { AppShell } from "./app-shell";

import {
  entryTypeLabel,
  LedgerEntryReceipt,
} from "./ledger-entry-receipt";

import { useFirebaseAuth } from "./firebase-provider";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

import type {
  FinancialOverview as FinancialData,
} from "@/lib/services/firestore-client";

type VehicleOption = {
  id: string;
  label: string;
};

function toDateInput(
  date: Date,
): string {
  return date
    .toISOString()
    .slice(0, 10);
}

function startOfMonth(): string {
  const date = new Date();

  return toDateInput(
    new Date(
      date.getFullYear(),
      date.getMonth(),
      1,
    ),
  );
}

export function FinanceOverview() {
  const { role } =
    useFirebaseAuth();

  const [from, setFrom] =
    useState(startOfMonth);

  const [to, setTo] =
    useState(() =>
      toDateInput(new Date()),
    );

  const [
    selectedVehicleId,
    setSelectedVehicleId,
  ] = useState("");

  const [data, setData] =
    useState<FinancialData>();

  const [vehicles, setVehicles] =
    useState<VehicleOption[]>([]);

  const [error, setError] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  const [reloadToken, setReloadToken] =
    useState(0);

  const [openEntryId, setOpenEntryId] =
    useState<string | null>(null);

  const closeEntry = useCallback(
    () => setOpenEntryId(null),
    [],
  );

  useEffect(() => {
    if (role !== "admin") {
      return;
    }

    let cancelled = false;

    async function load() {
      /*
       * Changing a filter starts a new report, so the old
       * figures are marked stale straight away rather than
       * being presented as though they matched the new range.
       */
      setLoading(true);
      setError(undefined);

      try {
        const [
          overview,
          fleet,
        ] = await Promise.all([
          callFirestoreOperation<
            {
              from: string;
              to: string;
              vehicleId: string | null;
            },
            FinancialData
          >(
            "getFinancialOverview",
            {
              from,
              to,
              vehicleId:
                selectedVehicleId ||
                null,
            },
          ),

          getDocs(
            query(
              collection(
                getFirebaseClient().db,
                "vehicles",
              ),
              orderBy(
                "registrationNumber",
              ),
              limit(100),
            ),
          ),
        ]);

        if (cancelled) {
          return;
        }

        setData(overview);

        setVehicles(
          fleet.docs.map(
            (document) => ({
              id: document.id,
              label: `${document.get(
                "registrationNumber",
              )} · ${document.get(
                "make",
              )} ${document.get(
                "model",
              )}`,
            }),
          ),
        );
      } catch (cause) {
        if (!cancelled) {
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
    from,
    to,
    role,
    selectedVehicleId,
    reloadToken,
  ]);

  const runReport = useCallback(() => {
    setLoading(true);
    setError(undefined);
    setReloadToken(
      (token) => token + 1,
    );
  }, []);

  if (role !== "admin") {
    return (
      <AppShell
        title="Finance"
        eyebrow="Restricted"
      >
        <section className="empty-state prominent">
          <div className="empty-illustration">
            <WalletCards />
          </div>

          <div>
            <h2>
              Administrator access required
            </h2>

            <p>
              Financial reports and profit data
              are visible only to administrators.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const metrics = [
    {
      label: "Invoiced",
      value: data?.invoicedCents,
      icon: ReceiptText,
      tone: "navy",
    },
    {
      label: "Received",
      value: data?.receivedCents,
      icon: CreditCard,
      tone: "green",
    },
    {
      label: "Expenses",
      value: data?.expensesCents,
      icon: HandCoins,
      tone: "orange",
    },
    {
      label: "Operating margin",
      value:
        data?.operatingMarginCents,
      icon: BarChart3,
      tone: "purple",
    },
    {
      label: "Outstanding",
      value: data?.outstandingCents,
      icon: CircleDollarSign,
      tone: "red",

      /*
       * The only figure here that is not confined to the
       * selected dates: it is what is owed today, across every
       * rental, so it has to say so beside a date filter.
       */
      note: "All unpaid rentals, any date",
    },
  ];

  return (
    <AppShell
      title="Finance"
      eyebrow="Rental performance"
      action={
        <button
          type="button"
          className="button button-secondary compact"
          onClick={runReport}
          disabled={loading}
        >
          <RefreshCw
            size={16}
            className={
              loading
                ? "spin"
                : undefined
            }
          />

          Refresh
        </button>
      }
    >
      <section className="report-filter surface">
        <div className="field">
          <label htmlFor="from">
            From
          </label>

          <input
            id="from"
            type="date"
            value={from}
            onChange={(event) =>
              setFrom(
                event.target.value,
              )
            }
          />
        </div>

        <div className="field">
          <label htmlFor="to">
            To
          </label>

          <input
            id="to"
            type="date"
            value={to}
            onChange={(event) =>
              setTo(
                event.target.value,
              )
            }
          />
        </div>

        <div className="field">
          <label htmlFor="vehicle-filter">
            Vehicle
          </label>

          <select
            id="vehicle-filter"
            value={selectedVehicleId}
            onChange={(event) =>
              setSelectedVehicleId(
                event.target.value,
              )
            }
          >
            <option value="">
              All vehicles
            </option>

            {vehicles.map(
              (vehicle) => (
                <option
                  key={vehicle.id}
                  value={vehicle.id}
                >
                  {vehicle.label}
                </option>
              ),
            )}
          </select>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={runReport}
          disabled={loading}
        >
          Run report
        </button>
      </section>

      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className="metric-grid finance-metrics">
        {metrics.map(
          ({
            label,
            value,
            icon: Icon,
            tone,
            note,
          }) => (
            <article
              className="metric-card"
              key={label}
            >
              <div
                className={`metric-icon ${tone}`}
              >
                <Icon size={19} />
              </div>

              <div>
                <p>{label}</p>

                <strong>
                  {value === undefined
                    ? "—"
                    : formatMoney(value)}
                </strong>

                {note && (
                  <small className="metric-note">
                    {note}
                  </small>
                )}
              </div>
            </article>
          ),
        )}
      </section>

      <section className="dashboard-grid finance-grid">
        <article className="surface">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                By vehicle
              </p>

              <h2>
                Operating margin
              </h2>
            </div>
          </div>

          {data?.vehiclePerformance
            .length ? (
            <div className="list-table">
              {data.vehiclePerformance.map(
                (vehicle) => (
                  <div
                    className="finance-row"
                    key={vehicle.vehicleId}
                  >
                    <div>
                      <strong>
                        {
                          vehicle.vehicleRegistration
                        }
                      </strong>

                      <span>
                        {formatMoney(
                          vehicle.invoicedCents,
                        )}{" "}
                        invoiced ·{" "}
                        {formatMoney(
                          vehicle.expensesCents,
                        )}{" "}
                        expenses
                      </span>
                    </div>

                    <strong
                      className={
                        vehicle.operatingMarginCents <
                        0
                          ? "amount-negative"
                          : "amount-positive"
                      }
                    >
                      {formatMoney(
                        vehicle.operatingMarginCents,
                      )}
                    </strong>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="inline-empty">
              No financial activity in
              this period.
            </div>
          )}
        </article>

        <article className="surface">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Running costs
              </p>

              <h2>
                Expenses
              </h2>
            </div>
          </div>

          {/*
            * Recording an expense is operational work and has
            * a screen of its own that operations can reach.
            * Finance reports on the result rather than
            * carrying a second copy of the form.
            */}
          <p>
            Expenses are recorded on the
            Expenses screen, which any
            approved account can open. The
            figures above already include
            everything recorded there.
          </p>

          <Link
            className="button button-secondary"
            href="/expenses"
          >
            <ReceiptText size={15} />
            Open Expenses
          </Link>
        </article>
      </section>

      <section className="surface ledger-surface">
        <div className="section-heading">
          <div>
            <p className="section-kicker">
              Activity
            </p>

            <h2>
              Recent entries
            </h2>
          </div>

          <span className="quiet">
            {data?.outstandingRentals ??
              0}{" "}
            rental
            {data?.outstandingRentals ===
            1
              ? ""
              : "s"}{" "}
            outstanding
          </span>
        </div>

        {data?.recentEntries.length ? (
          <>
          <p className="quiet ledger-hint">
            Tap an entry to see the customer,
            the vehicle, who recorded it and the
            rental&rsquo;s full bill.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Vehicle</th>
                  <th className="align-right">
                    Amount
                  </th>
                </tr>
              </thead>

              <tbody>
                {data.recentEntries.map(
                  (entry) => (
                    <tr
                      key={entry.id}
                      className="ledger-row"
                      onClick={() =>
                        setOpenEntryId(
                          entry.id,
                        )
                      }
                    >
                      <td>
                        {formatDate(
                          entry.occurredAt,
                        )}
                      </td>

                      <td>
                        {/* A real button, so the row opens
                            from the keyboard as well. */}
                        <button
                          type="button"
                          className="ledger-open"
                          aria-label={`Open ${entryTypeLabel(
                            entry.entryType,
                          )} of ${formatMoney(
                            entry.amountCents,
                          )}`}
                          onClick={(event) => {
                            event.stopPropagation();

                            setOpenEntryId(
                              entry.id,
                            );
                          }}
                        >
                          <span className="entry-type">
                            {entryTypeLabel(
                              entry.entryType,
                            )}
                          </span>

                          {/* The vehicle column is hidden on
                              a phone, so the car and the
                              customer ride under the type. */}
                          {(entry.vehicleRegistration ||
                            entry.customerName) && (
                            <small className="ledger-who">
                              {[
                                entry.vehicleRegistration,
                                entry.customerName,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          )}
                        </button>
                      </td>

                      <td>
                        {
                          entry.vehicleRegistration
                        }
                      </td>

                      <td
                        className={`align-right ${
                          entry.amountCents <
                          0
                            ? "amount-negative"
                            : "amount-positive"
                        }`}
                      >
                        {formatMoney(
                          entry.amountCents,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="inline-empty">
            No entries for this period.
          </div>
        )}
      </section>

      {openEntryId && (
        <LedgerEntryReceipt
          entryId={openEntryId}
          onClose={closeEntry}
        />
      )}
    </AppShell>
  );
}