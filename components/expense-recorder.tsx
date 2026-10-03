"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

import {
  ReceiptText,
  RefreshCw,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import { AppShell } from "./app-shell";

import { useFirebaseAuth } from "./firebase-provider";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
  type ExpenseRecord,
} from "@/lib/services/firestore-client";

/*
 * Recording what the fleet costs to run is operational work:
 * the person who takes a car to the garage is the one holding
 * the invoice. This screen is therefore open to operations,
 * and it records expenses and nothing else — revenue, margin
 * and the ledger stay on Finance, which only an administrator
 * can open.
 *
 * An operations account reads back only the entries it
 * recorded itself. That is not a display choice: the security
 * rules allow it no other query.
 */

type VehicleOption = {
  id: string;
  label: string;
};

const CATEGORIES = [
  { value: "repair", label: "Repair" },
  { value: "service", label: "Service" },
  {
    value: "maintenance",
    label: "Maintenance",
  },
  { value: "parts", label: "Parts" },
  { value: "fuel", label: "Fuel" },
  {
    value: "insurance",
    label: "Insurance",
  },
  {
    value: "licensing",
    label: "Licensing and registration",
  },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
] as const;

function categoryLabel(
  value: string,
): string {
  return (
    CATEGORIES.find(
      (category) =>
        category.value === value,
    )?.label ??
    value
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase(),
      )
  );
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    date.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function ExpenseRecorder() {
  const { role } = useFirebaseAuth();

  const [vehicles, setVehicles] = useState<
    VehicleOption[]
  >([]);

  const [expenses, setExpenses] = useState<
    ExpenseRecord[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [reloadToken, setReloadToken] =
    useState(0);

  /*
   * Held across retries so a lost response cannot record the
   * same expense twice; replaced only after it is stored.
   */
  const expenseKey =
    useRef<string>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const [fleet, recorded] =
          await Promise.all([
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

            callFirestoreOperation<
              {
                mine: boolean;
                limit: number;
              },
              ExpenseRecord[]
            >("listVehicleExpenses", {
              /*
               * An administrator sees the whole book; anyone
               * else can only be served their own entries.
               */
              mine: role !== "admin",
              limit: 100,
            }),
          ]);

        if (cancelled) {
          return;
        }

        setVehicles(
          fleet.docs.map((document) => ({
            id: document.id,

            label: `${document.get(
              "registrationNumber",
            )} · ${document.get(
              "make",
            )} ${document.get("model")}`,
          })),
        );

        setExpenses(recorded);
        setError(undefined);
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
  }, [role, reloadToken]);

  async function addExpense(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    /*
     * React clears currentTarget once the handler returns, so
     * the element is captured before the first await.
     */
    const formElement = event.currentTarget;

    const form = new FormData(formElement);

    setSaving(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const amount = Number(
        form.get("amount"),
      );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "Expense amount must be greater than zero.",
        );
      }

      const occurredAt = String(
        form.get("occurredAt") ?? "",
      ).trim();

      if (!occurredAt) {
        throw new Error(
          "Expense date is required.",
        );
      }

      await callFirestoreOperation<
        {
          vehicleId: string;
          category: string;
          amountCents: number;
          occurredAt: string;
          vendor: string | null;
          note: string;
          idempotencyKey: string;
        },
        { expenseId: string }
      >("recordVehicleExpense", {
        vehicleId: String(
          form.get("vehicleId"),
        ),

        category: String(
          form.get("category"),
        ),

        amountCents: Math.round(
          amount * 100,
        ),

        occurredAt: new Date(
          `${occurredAt}T12:00:00`,
        ).toISOString(),

        vendor:
          String(
            form.get("vendor") ?? "",
          ).trim() || null,

        note: String(
          form.get("note") ?? "",
        ).trim(),

        idempotencyKey: (expenseKey.current ??=
          crypto.randomUUID()),
      });

      expenseKey.current = undefined;

      formElement.reset();

      setNotice("Expense recorded.");

      setReloadToken(
        (token) => token + 1,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const total = expenses.reduce(
    (sum, entry) => sum + entry.amountCents,
    0,
  );

  return (
    <AppShell
      title="Expenses"
      eyebrow="Running costs"
      action={
        <button
          type="button"
          className="button button-secondary compact"
          disabled={loading}
          onClick={() =>
            setReloadToken(
              (token) => token + 1,
            )
          }
        >
          <RefreshCw
            className={
              loading ? "spin" : undefined
            }
            size={15}
          />
          Refresh
        </button>
      }
    >
      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="alert alert-success"
          role="status"
        >
          {notice}
        </div>
      )}

      <section className="surface ledger-surface">
        <div className="section-heading">
          <div>
            <p className="section-kicker">
              New entry
            </p>

            <h2>Record an expense</h2>

          </div>
        </div>

        <form
          className="form-grid"
          onSubmit={(event) =>
            void addExpense(event)
          }
        >
          <div className="field full">
            <label htmlFor="expense-vehicle">
              Vehicle
            </label>

            <select
              id="expense-vehicle"
              name="vehicleId"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select a vehicle
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
            <label htmlFor="expense-category">
              Category
            </label>

            <select
              id="expense-category"
              name="category"
              defaultValue="maintenance"
            >
              {CATEGORIES.map((category) => (
                <option
                  value={category.value}
                  key={category.value}
                >
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="expense-amount">
              Amount (USD)
            </label>

            <input
              id="expense-amount"
              name="amount"
              type="number"
              min="0.01"
              max="100000"
              step="0.01"
              inputMode="decimal"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="expense-date">
              Date
            </label>

            <input
              id="expense-date"
              name="occurredAt"
              type="date"
              defaultValue={toDateInput(
                new Date(),
              )}
              max={toDateInput(new Date())}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="expense-vendor">
              Vendor
            </label>

            <input
              id="expense-vendor"
              name="vendor"
              maxLength={160}
            />
          </div>

          <div className="field full">
            <label htmlFor="expense-note">
              Note
            </label>

            <input
              id="expense-note"
              name="note"
              minLength={1}
              maxLength={1000}
              required
            />
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={
                saving || !vehicles.length
              }
            >
              {saving
                ? "Saving…"
                : "Record expense"}
            </button>
          </div>
        </form>
      </section>

      <section className="surface ledger-surface">
        <div className="section-heading">
          <div>
            <p className="section-kicker">
              {role === "admin"
                ? "All entries"
                : "Recorded by you"}
            </p>

            <h2>Recent expenses</h2>
          </div>

          <span className="customer-count">
            {formatMoney(total)}
          </span>
        </div>

        {loading ? (
          <div
            className="inline-empty"
            role="status"
            aria-live="polite"
          >
            Loading expenses…
          </div>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-illustration">
              <ReceiptText size={23} />
            </div>

            <h2>No expenses recorded</h2>

            <p>
              {role === "admin"
                ? "Nothing has been recorded against the fleet yet."
                : "You have not recorded an expense yet. Entries recorded by other staff are only visible to an administrator."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vehicle</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                </tr>
              </thead>

              <tbody>
                {expenses.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {formatDate(
                        entry.occurredAt,
                      )}
                    </td>

                    <td>
                      <strong>
                        {
                          entry.vehicleRegistration
                        }
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {categoryLabel(
                          entry.category,
                        )}
                      </strong>

                      {entry.note && (
                        <span>
                          {entry.note}
                        </span>
                      )}
                    </td>

                    <td>
                      {entry.vendor ??
                        "Not recorded"}
                    </td>

                    <td>
                      <strong>
                        {formatMoney(
                          entry.amountCents,
                        )}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
