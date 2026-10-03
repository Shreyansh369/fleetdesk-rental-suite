"use client";

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import {
  CarFront,
  History,
  Pencil,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AppShell } from "./app-shell";
import { CountrySelect } from "./country-select";
import { useFirebaseAuth } from "./firebase-provider";
import { PastBookingForm } from "./past-booking-form";
import { RentalHistory } from "./rental-history";
import { CustomerLicenseCapture } from "./customer-license-capture";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

type Customer = {
  id: string;
  fullName: string;
  telephone: string;
  email: string | null;
  address: string | null;
  state: string | null;
  localAddress: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string | null;
  licenceStoragePath: string | null;
  dateOfBirth: string | null;
};

type CustomerForm = {
  fullName: string;
  telephone: string;
  email: string;
  address: string;
  state: string;
  localAddress: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string;
  licenceStoragePath: string | null;
  dateOfBirth: string;
};

type ActiveRental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  expectedReturnAt: Date | null;
  bookedBy: string;
  checkedOutBy: string;
  status: "active" | "overdue";
};

type CustomerTab =
  | "customers"
  | "active-rentals"
  | "history";

function tomorrowDate(): string {
  const value = new Date();

  value.setDate(
    value.getDate() + 1,
  );

  const year =
    value.getFullYear();

  const month =
    String(
      value.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      value.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function todayDate(): string {
  const value = new Date();

  const year =
    value.getFullYear();

  const month =
    String(
      value.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      value.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/*
 * Shown beside the date of birth: the under-25 insurance
 * premium in the agreement's terms is judged on age, so the
 * desk should not have to work it out from the date.
 */
function ageInYears(
  value: string,
): number {
  const born =
    new Date(`${value.slice(0, 10)}T00:00:00`);

  if (
    Number.isNaN(born.getTime())
  ) {
    return 0;
  }

  const today = new Date();

  let years =
    today.getFullYear() -
    born.getFullYear();

  const monthDelta =
    today.getMonth() - born.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 &&
      today.getDate() < born.getDate())
  ) {
    years -= 1;
  }

  return Math.max(0, years);
}

function customerToForm(
  customer: Customer,
): CustomerForm {
  return {
    fullName:
      customer.fullName,
    telephone:
      customer.telephone,
    email:
      customer.email ?? "",
    address:
      customer.address ?? "",
    state:
      customer.state ?? "",
    localAddress:
      customer.localAddress ?? "",
    licenceNumber:
      customer.licenceNumber,
    licenceCountry:
      customer.licenceCountry,
    licenceExpiresAt:
      customer.licenceExpiresAt
        ? customer.licenceExpiresAt.slice(
            0,
            10,
          )
        : "",
    licenceStoragePath:
      customer.licenceStoragePath,
    dateOfBirth:
      customer.dateOfBirth
        ? customer.dateOfBirth.slice(
            0,
            10,
          )
        : "",
  };
}

function emptyCustomerForm(): CustomerForm {
  return {
    fullName: "",
    telephone: "",
    email: "",
    address: "",
    state: "",
    localAddress: "",
    licenceNumber: "",
    licenceCountry: "",
    licenceExpiresAt: "",
    licenceStoragePath: null,
    dateOfBirth: "",
  };
}

function asDate(
  value: unknown,
): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value
  ) {
    const timestamp =
      value as {
        toDate?: () => Date;
      };

    if (
      typeof timestamp.toDate ===
      "function"
    ) {
      return timestamp.toDate();
    }
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value ===
    "string"
  ) {
    const date =
      new Date(value);

    return Number.isNaN(
      date.getTime(),
    )
      ? null
      : date;
  }

  return null;
}

function formatRentalDate(
  value: Date | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  return value.toLocaleString(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

export function CustomerDirectory({
  initialView,
}: {
  initialView?: string | null;
} = {}) {
  const { role } =
    useFirebaseAuth();

  /*
   * The tab follows the URL rather than only its first value:
   * following the dashboard's history link while /customers is
   * already mounted changes the query without remounting, and
   * the linked tab would otherwise not open.
   */
  const [manualTab, setManualTab] =
    useState<{
      view: string | null;
      tab: CustomerTab;
    } | null>(null);

  const tab: CustomerTab =
    manualTab &&
    manualTab.view === (initialView ?? null)
      ? manualTab.tab
      : initialView === "history"
        ? "history"
        : "customers";

  function setTab(next: CustomerTab) {
    setManualTab({
      view: initialView ?? null,
      tab: next,
    });
  }

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [activeRentals, setActiveRentals] =
    useState<ActiveRental[]>([]);

  const [search, setSearch] =
    useState("");

  const [rentalSearch, setRentalSearch] =
    useState("");

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  const [loadingRentals, setLoadingRentals] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [editingSaving, setEditingSaving] =
    useState(false);

  const [showCreateForm, setShowCreateForm] =
    useState(false);

  const [editingCustomerId, setEditingCustomerId] =
    useState<string | null>(null);

  const [editingCustomerForm, setEditingCustomerForm] =
    useState<CustomerForm>(
      emptyCustomerForm(),
    );

  const [rentalsLoaded, setRentalsLoaded] =
    useState(false);

  const [rentalsReloadToken, setRentalsReloadToken] =
    useState(0);

  /*
   * Removing a customer is irreversible, so the row asks for
   * a second click rather than deleting on the first one.
   */
  /*
   * A rental the office ran before this system belongs with
   * the history it is missing from, not among the live
   * booking workflows.
   */
  const [showPastBooking, setShowPastBooking] =
    useState(false);

  const [historyReloadToken, setHistoryReloadToken] =
    useState(0);

  const [pendingDeleteId, setPendingDeleteId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  useEffect(() => {
    const source = query(
      collection(
        getFirebaseClient().db,
        "customers",
      ),
      orderBy("fullName"),
      limit(500),
    );

    return onSnapshot(
      source,
      (snapshot) => {
        setCustomers(
          snapshot.docs.map(
            (customerDoc) => ({
              id: customerDoc.id,

              fullName:
                customerDoc.get(
                  "fullName",
                ),

              telephone:
                customerDoc.get(
                  "telephone",
                ),

              email:
                customerDoc.get(
                  "email",
                ) ?? null,

              address:
                customerDoc.get(
                  "address",
                ) ?? null,

              state:
                customerDoc.get(
                  "state",
                ) ?? null,

              localAddress:
                customerDoc.get(
                  "localAddress",
                ) ?? null,

              licenceNumber:
                customerDoc.get(
                  "licenceNumber",
                ),

              licenceCountry:
                customerDoc.get(
                  "licenceCountry",
                ),

              licenceExpiresAt:
                customerDoc.get(
                  "licenceExpiresAt",
                ) ?? null,

              licenceStoragePath:
                customerDoc.get(
                  "licenceStoragePath",
                ) ?? null,

              dateOfBirth:
                customerDoc.get(
                  "dateOfBirth",
                ) ?? null,
            }),
          ),
        );

        setError(undefined);
        setLoading(false);
      },
      (cause) => {
        console.error(
          "Customer directory listener failed:",
          cause,
        );

        setError(
          firebaseErrorMessage(
            cause,
          ),
        );

        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (
      tab !== "active-rentals"
    ) {
      return;
    }

    let cancelled = false;

    async function loadActiveRentals() {
      try {
        const snapshot =
          await getDocs(
            query(
              collection(
                getFirebaseClient().db,
                "rentals",
              ),
              where(
                "status",
                "in",
                [
                  "active",
                  "overdue",
                ],
              ),
              limit(100),
            ),
          );

        const records =
          snapshot.docs
            .map(
              (rentalDoc) => {
                const expectedReturn =
                  asDate(
                    rentalDoc.get(
                      "expectedReturnAt",
                    ),
                  );

                /*
                 * Overdue is derived from the expected return
                 * time, not read from a stored flag: nothing
                 * sweeps the collection on a schedule, so the
                 * stored status would still say "active" long
                 * after a car was due back.
                 */
                const status =
                  String(
                    rentalDoc.get(
                      "status",
                    ),
                  ) === "overdue" ||
                  (expectedReturn !==
                    null &&
                    expectedReturn.getTime() <
                      Date.now())
                    ? "overdue"
                    : "active";

                return {
                  id:
                    rentalDoc.id,

                  customerName:
                    String(
                      rentalDoc.get(
                        "customerNameSnapshot",
                      ) ??
                        "Unknown customer",
                    ),

                  vehicleRegistration:
                    String(
                      rentalDoc.get(
                        "vehicleRegistrationSnapshot",
                      ) ??
                        "Unknown vehicle",
                    ),

                  expectedReturnAt:
                    expectedReturn,

                  bookedBy:
                    String(
                      rentalDoc.get(
                        "createdByNameSnapshot",
                      ) ??
                        "Not recorded",
                    ),

                  checkedOutBy:
                    String(
                      rentalDoc.get(
                        "checkedOutByNameSnapshot",
                      ) ??
                        "Not recorded",
                    ),

                  status,
                } satisfies ActiveRental;
              },
            )
            .sort(
              (a, b) => {
                const aTime =
                  a.expectedReturnAt?.getTime() ??
                  Number.MAX_SAFE_INTEGER;

                const bTime =
                  b.expectedReturnAt?.getTime() ??
                  Number.MAX_SAFE_INTEGER;

                return (
                  aTime -
                  bTime
                );
              },
            );

        setActiveRentals(
          records,
        );

        setRentalsLoaded(
          true,
        );
      } catch (cause) {
        console.error(
          "Active rental load failed:",
          cause,
        );

        setError(
          firebaseErrorMessage(
            cause,
          ),
        );
      } finally {
        setLoadingRentals(false);
      }
    }

    void loadActiveRentals();

    /*
     * A tab switch or refresh while a read is in flight would
     * otherwise let the older response overwrite the newer one.
     */
    return () => {
      cancelled = true;
    };
  }, [tab, rentalsReloadToken]);

  function refreshActiveRentals() {
    setLoadingRentals(true);
    setError(undefined);
    setRentalsReloadToken(
      (token) => token + 1,
    );
  }

  const filteredCustomers =
    useMemo(() => {
      const needle =
        search
          .trim()
          .toLowerCase();

      if (!needle) {
        return customers;
      }

      return customers.filter(
        (customer) =>
          [
            customer.fullName,
            customer.telephone,
            customer.email,
            customer.licenceNumber,
            customer.licenceCountry,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(needle),
            ),
      );
    }, [
      customers,
      search,
    ]);

  const filteredRentals =
    useMemo(() => {
      const needle =
        rentalSearch
          .trim()
          .toLowerCase();

      if (!needle) {
        return activeRentals;
      }

      return activeRentals.filter(
        (rental) =>
          [
            rental.customerName,
            rental.vehicleRegistration,
            rental.bookedBy,
            rental.checkedOutBy,
            rental.status,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(needle),
            ),
      );
    }, [
      activeRentals,
      rentalSearch,
    ]);

  function closeEditor() {
    if (editingSaving) {
      return;
    }

    setEditingCustomerId(
      null,
    );

    setEditingCustomerForm(
      emptyCustomerForm(),
    );
  }

  function openEditor(
    customer: Customer,
  ) {
    setError(undefined);
    setNotice(undefined);

    setShowCreateForm(
      false,
    );

    setEditingCustomerId(
      customer.id,
    );

    setEditingCustomerForm(
      customerToForm(customer),
    );
  }

  /*
   * Deletion is refused by the service layer while any
   * booking or rental still references the customer, so the
   * failure the employee sees explains which history is in
   * the way rather than a bare permission error.
   */
  async function removeCustomer(
    customer: Customer,
  ) {
    setError(undefined);
    setNotice(undefined);
    setDeletingId(customer.id);

    try {
      await callFirestoreOperation<
        { customerId: string },
        { customerId: string }
      >("deleteCustomer", {
        customerId: customer.id,
      });

      setPendingDeleteId(null);

      setNotice(
        `${customer.fullName} was removed.`,
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function createCustomer(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError(undefined);
    setNotice(undefined);
    setSaving(true);

    /*
     * React clears currentTarget once the handler returns, so
     * the element is captured before the first await.
     */
    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    const fullName =
      String(
        form.get(
          "fullName",
        ) ?? "",
      ).trim();

    const telephone =
      String(
        form.get(
          "telephone",
        ) ?? "",
      ).trim();

    const emailValue =
      String(
        form.get(
          "email",
        ) ?? "",
      ).trim();

    const addressValue =
      String(
        form.get(
          "address",
        ) ?? "",
      ).trim();

    const stateValue =
      String(
        form.get(
          "state",
        ) ?? "",
      ).trim();

    const localAddressValue =
      String(
        form.get(
          "localAddress",
        ) ?? "",
      ).trim();

    const licenceNumber =
      String(
        form.get(
          "licenceNumber",
        ) ?? "",
      )
        .trim()
        .toUpperCase();

    const licenceCountry =
      String(
        form.get(
          "licenceCountry",
        ) ?? "",
      )
        .trim()
        .toUpperCase();

    const licenceExpiresAt =
      String(
        form.get(
          "licenceExpiresAt",
        ) ?? "",
      ).trim();

    const dateOfBirthValue =
      String(
        form.get(
          "dateOfBirth",
        ) ?? "",
      ).trim();

    try {
      if (
        !fullName ||
        !telephone ||
        !licenceNumber ||
        !licenceCountry ||
        !licenceExpiresAt
      ) {
        throw new Error(
          "Complete all required customer details.",
        );
      }

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0,
      );

      const expiry =
        new Date(
          `${licenceExpiresAt}T00:00:00`,
        );

      expiry.setHours(
        0,
        0,
        0,
        0,
      );

      if (
        Number.isNaN(
          expiry.getTime(),
        ) ||
        expiry.getTime() <=
          today.getTime()
      ) {
        throw new Error(
          "Licence expiry must be after today.",
        );
      }

      if (
        licenceCountry.length !==
        2
      ) {
        throw new Error(
          "Select a valid licence issuing country.",
        );
      }

      const result =
        await callFirestoreOperation<
          {
            fullName: string;
            telephone: string;
            email: string | null;
            address: string | null;
            state: string | null;
            localAddress: string | null;
            licenceNumber: string;
            licenceCountry: string;
            licenceExpiresAt: string;
            dateOfBirth:
              string | null;
            notes:
              string | null;
            licenceStoragePath:
              string | null;
          },
          {
            customerId: string;
          }
        >(
          "createOrUpdateCustomer",
          {
            fullName,
            telephone,
            email:
              emailValue ||
              null,
            address:
              addressValue ||
              null,
            state:
              stateValue || null,
            localAddress:
              localAddressValue || null,
            licenceNumber,
            licenceCountry,
            licenceExpiresAt,
            dateOfBirth:
              dateOfBirthValue ||
              null,
            notes:
              null,
            licenceStoragePath:
              null,
          },
        );

      formElement.reset();

      setShowCreateForm(
        false,
      );

      setEditingCustomerId(
        result.customerId,
      );

      setEditingCustomerForm({
        fullName,
        telephone,
        email:
          emailValue,
        address:
          addressValue,
        state: stateValue ?? "",
        localAddress:
          localAddressValue ?? "",
        licenceNumber,
        licenceCountry,
        licenceExpiresAt,
        licenceStoragePath:
          null,
        dateOfBirth:
          dateOfBirthValue,
      });

      setNotice(
        "Customer created. Add or capture the driver's licence photo below.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomerEdits(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!editingCustomerId) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setEditingSaving(true);

    try {
      const form =
        new FormData(
          event.currentTarget,
        );

      const fullName =
        editingCustomerForm.fullName
          .trim();

      const telephone =
        editingCustomerForm.telephone
          .trim();

      const email =
        editingCustomerForm.email
          .trim();

      const address =
        editingCustomerForm.address
          .trim();

      const licenceNumber =
        editingCustomerForm.licenceNumber
          .trim()
          .toUpperCase();

      const licenceCountry =
        String(
          form.get(
            "licenceCountry",
          ) ?? "",
        )
          .trim()
          .toUpperCase();

      const licenceExpiresAt =
        editingCustomerForm.licenceExpiresAt
          .trim();

      if (
        !fullName ||
        !telephone ||
        !licenceNumber ||
        !licenceCountry ||
        !licenceExpiresAt
      ) {
        throw new Error(
          "Complete all required customer details.",
        );
      }

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0,
      );

      const expiry =
        new Date(
          `${licenceExpiresAt}T00:00:00`,
        );

      expiry.setHours(
        0,
        0,
        0,
        0,
      );

      if (
        Number.isNaN(
          expiry.getTime(),
        ) ||
        expiry.getTime() <=
          today.getTime()
      ) {
        throw new Error(
          "Licence expiry must be after today.",
        );
      }

      if (
        licenceCountry.length !==
        2
      ) {
        throw new Error(
          "Select a valid licence issuing country.",
        );
      }

      await callFirestoreOperation<
        {
          customerId: string;
          fullName: string;
          telephone: string;
          email: string | null;
          address: string | null;
          state: string | null;
          localAddress: string | null;
          licenceNumber: string;
          licenceCountry: string;
          licenceExpiresAt: string;
          dateOfBirth: string | null;
          licenceStoragePath:
            string | null;
        },
        {
          customerId: string;
        }
      >(
        "createOrUpdateCustomer",
        {
          customerId:
            editingCustomerId,

          fullName,
          telephone,

          email:
            email || null,

          address:
            address || null,

          state:
            editingCustomerForm.state.trim() ||
            null,

          localAddress:
            editingCustomerForm.localAddress.trim() ||
            null,

          licenceNumber,
          licenceCountry,
          licenceExpiresAt,

          dateOfBirth:
            editingCustomerForm.dateOfBirth.trim() ||
            null,

          /*
           * The internal note is not on this form, so it is
           * left out of the patch rather than sent back as
           * null and erased.
           */
          licenceStoragePath:
            editingCustomerForm
              .licenceStoragePath,
        },
      );

      setNotice(
        "Customer details updated successfully.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    } finally {
      setEditingSaving(false);
    }
  }

  async function handleLicenceChange(
    storagePath: string | null,
  ) {
    if (!editingCustomerId) {
      return;
    }

    if (!storagePath) {
      setEditingCustomerForm(
        (current) => ({
          ...current,
          licenceStoragePath:
            null,
        }),
      );

      return;
    }

    setError(undefined);
    setNotice(undefined);

    try {
      await callFirestoreOperation<
        {
          customerId: string;
          licenceStoragePath: string;
        },
        {
          customerId: string;
          licenceStoragePath: string;
        }
      >(
        "updateCustomerLicenceDocument",
        {
          customerId:
            editingCustomerId,
          licenceStoragePath:
            storagePath,
        },
      );

      setEditingCustomerForm(
        (current) => ({
          ...current,
          licenceStoragePath:
            storagePath,
        }),
      );

      setNotice(
        "Driver's licence photo saved successfully.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    }
  }

  return (
    <AppShell
      title="Customers"
      eyebrow="Customer records"
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

      <section className="customer-surface surface">
        <div className="surface-toolbar">
          <div className="search-box">
            <Search size={17} />

            <input
              value={
                tab === "customers"
                  ? search
                  : rentalSearch
              }
              onChange={(event) => {
                if (
                  tab ===
                  "customers"
                ) {
                  setSearch(
                    event.target.value,
                  );
                } else {
                  setRentalSearch(
                    event.target.value,
                  );
                }
              }}
              placeholder={
                tab === "customers"
                  ? "Search name, telephone or licence"
                  : tab === "history"
                    ? "Search renter, vehicle or staff member"
                    : "Search customer, vehicle or staff"
              }
              aria-label={
                tab === "customers"
                  ? "Search customers"
                  : tab === "history"
                    ? "Search rental history"
                    : "Search active rentals"
              }
            />
          </div>

          {/*
            * The history list owns its own records, so there is
            * no count to state here without duplicating the
            * query behind it.
            */}
          {tab !== "history" && (
            <span className="customer-count">
              {tab === "customers"
                ? `${filteredCustomers.length} customer${
                    filteredCustomers.length ===
                    1
                      ? ""
                      : "s"
                  }`
                : `${filteredRentals.length} active rental${
                    filteredRentals.length ===
                    1
                      ? ""
                      : "s"
                  }`}
            </span>
          )}

          {tab === "customers" && (
            <button
              className="button button-primary compact"
              type="button"
              onClick={() => {
                setError(undefined);
                setNotice(undefined);

                setEditingCustomerId(
                  null,
                );

                setEditingCustomerForm(
                  emptyCustomerForm(),
                );

                setShowCreateForm(
                  true,
                );
              }}
            >
              <Plus size={16} />
              Add customer
            </button>
          )}

          {tab === "history" && (
            <button
              className="button button-primary compact"
              type="button"
              onClick={() => {
                setError(undefined);
                setNotice(undefined);

                setShowPastBooking(
                  (open) => !open,
                );
              }}
            >
              {showPastBooking ? (
                <X size={16} />
              ) : (
                <PlusCircle size={16} />
              )}

              {showPastBooking
                ? "Close"
                : "Record a past booking"}
            </button>
          )}

          {tab ===
            "active-rentals" && (
            <button
              className="button button-secondary compact"
              type="button"
              disabled={
                loadingRentals
              }
              onClick={
                refreshActiveRentals
              }
            >
              Refresh
            </button>
          )}
        </div>

        <div
          className="customer-tabs"
          role="tablist"
          aria-label="Customer views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={
              tab ===
              "customers"
            }
            className={
              tab ===
              "customers"
                ? "button button-primary compact"
                : "button button-secondary compact"
            }
            onClick={() =>
              setTab(
                "customers",
              )
            }
          >
            <UserRound
              size={15}
            />
            Customers
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              tab ===
              "active-rentals"
            }
            className={
              tab ===
              "active-rentals"
                ? "button button-primary compact"
                : "button button-secondary compact"
            }
            onClick={() =>
              setTab(
                "active-rentals",
              )
            }
          >
            <CarFront
              size={15}
            />
            Active rentals
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              tab === "history"
            }
            className={
              tab === "history"
                ? "button button-primary compact"
                : "button button-secondary compact"
            }
            onClick={() =>
              setTab("history")
            }
          >
            <History size={15} />
            History
          </button>
        </div>

        {tab === "customers" && (
          <>
            {showCreateForm && (
              <div className="customer-create-panel">
                <div className="customer-create-header">
                  <div>
                    <p className="section-kicker">
                      New customer
                    </p>

                    <h2>
                      Add customer
                    </h2>

                    <p>
                      Create the customer
                      directly from the
                      Customers screen.
                      After saving, you can
                      capture or upload the
                      driver&apos;s licence photo.
                    </p>
                  </div>

                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => {
                      if (saving) {
                        return;
                      }

                      setShowCreateForm(
                        false,
                      );
                    }}
                    aria-label="Close customer form"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form
                  className="form-grid"
                  onSubmit={
                    createCustomer
                  }
                >
                  <div className="field">
                    <label htmlFor="full-name">
                      Full name
                    </label>

                    <input
                      id="full-name"
                      name="fullName"
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="telephone">
                      Telephone
                    </label>

                    <input
                      id="telephone"
                      name="telephone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email">
                      Email
                    </label>

                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field full">
                    <label htmlFor="address">
                      Address
                    </label>

                    <input
                      id="address"
                      name="address"
                      autoComplete="street-address"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="state">
                      State
                    </label>

                    <input
                      id="state"
                      name="state"
                      autoComplete="address-level1"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="local-address">
                      Local address
                    </label>

                    <input
                      id="local-address"
                      name="localAddress"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="date-of-birth">
                      Date of birth
                    </label>

                    <input
                      id="date-of-birth"
                      name="dateOfBirth"
                      type="date"
                      max={todayDate()}
                      autoComplete="bday"
                    />

                  </div>

                  <div className="field">
                    <label htmlFor="licence-number">
                      Licence number
                    </label>

                    <input
                      id="licence-number"
                      name="licenceNumber"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="issuing-country">
                      Issuing country
                    </label>

                    <CountrySelect
                      id="issuing-country"
                      name="licenceCountry"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-expiry">
                      Licence expiry
                    </label>

                    <input
                      id="licence-expiry"
                      name="licenceExpiresAt"
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        saving
                      }
                      onClick={() =>
                        setShowCreateForm(
                          false,
                        )
                      }
                    >
                      Cancel
                    </button>

                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        saving
                      }
                    >
                      {saving
                        ? "Saving..."
                        : "Save customer"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {editingCustomerId && (
              <div
                className="customer-create-panel"
                style={{
                  marginTop:
                    "16px",
                }}
              >
                <div className="customer-create-header">
                  <div>
                    <p className="section-kicker">
                      Customer details
                    </p>
                  </div>
                </div>

                <form
                  className="form-grid"
                  onSubmit={
                    saveCustomerEdits
                  }
                >
                  <div className="field">
                    <label htmlFor="full-name-2">
                      Full name
                    </label>

                    <input
                      id="full-name-2"
                      value={
                        editingCustomerForm.fullName
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            fullName:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="telephone-2">
                      Telephone
                    </label>

                    <input
                      id="telephone-2"
                      value={
                        editingCustomerForm.telephone
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            telephone:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email-2">
                      Email
                    </label>

                    <input
                      id="email-2"
                      value={
                        editingCustomerForm.email
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            email:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field full">
                    <label htmlFor="address-2">
                      Address
                    </label>

                    <input
                      id="address-2"
                      value={
                        editingCustomerForm.address
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            address:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      autoComplete="street-address"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="state-2">
                      State
                    </label>

                    <input
                      id="state-2"
                      value={
                        editingCustomerForm.state
                      }
                      onChange={(event) =>
                        setEditingCustomerForm(
                          (current) => ({
                            ...current,
                            state:
                              event.target
                                .value,
                          }),
                        )
                      }
                      autoComplete="address-level1"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="local-address-2">
                      Local address
                    </label>

                    <input
                      id="local-address-2"
                      value={
                        editingCustomerForm.localAddress
                      }
                      onChange={(event) =>
                        setEditingCustomerForm(
                          (current) => ({
                            ...current,
                            localAddress:
                              event.target
                                .value,
                          }),
                        )
                      }
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="date-of-birth-2">
                      Date of birth
                    </label>

                    <input
                      id="date-of-birth-2"
                      value={
                        editingCustomerForm.dateOfBirth
                      }
                      onChange={(event) =>
                        setEditingCustomerForm(
                          (current) => ({
                            ...current,
                            dateOfBirth:
                              event.target
                                .value,
                          }),
                        )
                      }
                      type="date"
                      max={todayDate()}
                      autoComplete="bday"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-number-2">
                      Licence number
                    </label>

                    <input
                      id="licence-number-2"
                      value={
                        editingCustomerForm.licenceNumber
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            licenceNumber:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="issuing-country-2">
                      Issuing country
                    </label>

                    <CountrySelect
                      id="issuing-country-2"
                      key={`${editingCustomerId}-${editingCustomerForm.licenceCountry}`}
                      name="licenceCountry"
                      defaultValue={
                        editingCustomerForm.licenceCountry
                      }
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-expiry-2">
                      Licence expiry
                    </label>

                    <input
                      id="licence-expiry-2"
                      value={
                        editingCustomerForm.licenceExpiresAt
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            licenceExpiresAt:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="field full">
                    <CustomerLicenseCapture
                      customerId={
                        editingCustomerId
                      }
                      value={
                        editingCustomerForm.licenceStoragePath
                      }
                      onChange={
                        handleLicenceChange
                      }
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        editingSaving
                      }
                      onClick={
                        closeEditor
                      }
                    >
                      Cancel
                    </button>

                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        editingSaving
                      }
                    >
                      {editingSaving
                        ? "Saving..."
                        : "Save changes"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {loading ? (
              <div
                className="inline-empty"
                role="status"
              >
                Loading customer records...
              </div>
            ) : filteredCustomers.length ===
              0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <UserRound
                    size={23}
                  />
                </div>

                <h2>
                  No customer records
                </h2>

                <p>
                  Add the first customer
                  directly from this screen.
                </p>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() =>
                    setShowCreateForm(
                      true,
                    )
                  }
                >
                  <Plus size={16} />
                  Add customer
                </button>
              </div>
            ) : (
              <div className="table-wrap customer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        Customer
                      </th>

                      <th>
                        Contact
                      </th>

                      <th>
                        Date of birth
                      </th>

                      <th>
                        Licence
                      </th>

                      <th>
                        Expires
                      </th>

                      <th>
                        Address
                      </th>

                      <th>
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCustomers.map(
                      (customer) => (
                        <tr
                          key={
                            customer.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                customer.fullName
                              }
                            </strong>

                            <span>
                              {
                                customer.email ||
                                "No email recorded"
                              }
                            </span>
                          </td>

                          <td>
                            <strong>
                              {
                                customer.telephone
                              }
                            </strong>
                          </td>

                          <td>
                            {customer.dateOfBirth ? (
                              <>
                                <strong>
                                  {formatDate(
                                    customer.dateOfBirth,
                                  )}
                                </strong>

                                <span>
                                  {`${ageInYears(
                                    customer.dateOfBirth,
                                  )} years old`}
                                </span>
                              </>
                            ) : (
                              <span className="missing">
                                Not recorded
                              </span>
                            )}
                          </td>

                          <td>
                            <strong>
                              {
                                customer.licenceNumber
                              }
                            </strong>

                            <span>
                              {
                                customer.licenceCountry
                              }
                            </span>

                            {customer.licenceStoragePath ? (
                              <small>
                                Licence photo
                                saved
                              </small>
                            ) : (
                              <small className="missing">
                                No licence photo
                              </small>
                            )}
                          </td>

                          <td>
                            {formatDate(
                              customer.licenceExpiresAt,
                            )}
                          </td>

                          <td>
                            {
                              customer.address ||
                              "Not recorded"
                            }
                          </td>

                          <td>
                            {pendingDeleteId ===
                            customer.id ? (
                              <div className="row-actions">
                                <button
                                  className="button button-danger compact"
                                  type="button"
                                  disabled={
                                    deletingId ===
                                    customer.id
                                  }
                                  onClick={() =>
                                    void removeCustomer(
                                      customer,
                                    )
                                  }
                                >
                                  {deletingId ===
                                  customer.id
                                    ? "Removing…"
                                    : "Yes, remove"}
                                </button>

                                <button
                                  className="text-button"
                                  type="button"
                                  disabled={
                                    deletingId ===
                                    customer.id
                                  }
                                  onClick={() =>
                                    setPendingDeleteId(
                                      null,
                                    )
                                  }
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="row-actions">
                                <button
                                  className="button button-secondary compact"
                                  type="button"
                                  onClick={() =>
                                    openEditor(
                                      customer,
                                    )
                                  }
                                >
                                  <Pencil
                                    size={15}
                                  />
                                  Edit
                                </button>

                                {role ===
                                  "admin" && (
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label={`Remove ${customer.fullName}`}
                                    onClick={() => {
                                      setError(
                                        undefined,
                                      );

                                      setNotice(
                                        undefined,
                                      );

                                      setPendingDeleteId(
                                        customer.id,
                                      );
                                    }}
                                  >
                                    <Trash2
                                      size={16}
                                    />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "active-rentals" && (
          <>
            {loadingRentals ? (
              <div
                className="inline-empty"
                role="status"
                aria-live="polite"
              >
                Loading active rentals...
              </div>
            ) : !rentalsLoaded ||
              filteredRentals.length ===
                0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <CarFront
                    size={23}
                  />
                </div>

                <h2>
                  No active rentals
                </h2>

                <p>
                  There are currently no
                  active or overdue rentals.
                </p>
              </div>
            ) : (
              <div className="table-wrap customer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        Vehicle
                      </th>

                      <th>
                        Customer
                      </th>

                      <th>
                        Expected return
                      </th>

                      <th>
                        Status
                      </th>

                      <th>
                        Booked by
                      </th>

                      <th>
                        Checked out by
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRentals.map(
                      (rental) => (
                        <tr
                          key={
                            rental.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                rental.vehicleRegistration
                              }
                            </strong>
                          </td>

                          <td>
                            <strong>
                              {
                                rental.customerName
                              }
                            </strong>
                          </td>

                          <td>
                            {
                              formatRentalDate(
                                rental.expectedReturnAt,
                              )
                            }
                          </td>

                          <td>
                            <span
                              className={
                                rental.status ===
                                "overdue"
                                  ? "status-pill overdue"
                                  : "status-pill"
                              }
                            >
                              {rental.status ===
                              "overdue"
                                ? "Overdue"
                                : "Active"}
                            </span>
                          </td>

                          <td>
                            {
                              rental.bookedBy
                            }
                          </td>

                          <td>
                            {
                              rental.checkedOutBy
                            }
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {showPastBooking && (
              <PastBookingForm
                onRecorded={() => {
                  setShowPastBooking(false);

                  setHistoryReloadToken(
                    (token) => token + 1,
                  );

                  setNotice(
                    "Past booking recorded. It is listed below as a past booking.",
                  );
                }}
                onCancel={() =>
                  setShowPastBooking(false)
                }
              />
            )}

            <RentalHistory
              limit={200}
              search={rentalSearch}
              reloadToken={
                historyReloadToken
              }
            />
          </>
        )}
      </section>
    </AppShell>
  );
}