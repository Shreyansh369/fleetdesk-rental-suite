"use client";

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "@/lib/data/firestore";

import {
  CarFront,
  CheckCircle2,
  FileWarning,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  VehicleDocument,
  VehicleStatus,
} from "@/packages/domain/src/types";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

import { AppShell } from "./app-shell";
import { DamageDiagram } from "./damage-diagram";
import { MediaCapture } from "./media-capture";

import {
  sanitizeDamageMarks,
  type DamageMark,
} from "@/lib/damage";

import type { CloudinaryMedia } from "@/lib/cloudinary";

type Vehicle = VehicleDocument & {
  id: string;
};

type VehicleForm = {
  registrationNumber: string;
  make: string;
  model: string;
  year: string;
  color: string;
  vin: string;
  registrationExpiresAt: string;
  insuranceExpiresAt: string;
  lastServiceAt: string;
  nextServiceDueAt: string;
  dailyCents: string;
  weeklyCents: string;
  monthlyCents: string;
  notes: string;
};

const statuses: Array<
  VehicleStatus | "all"
> = [
  "all",
  "available",
  "reserved",
  "rented",
  "overdue",
  "cleaning",
  "maintenance",
  "out_of_service",
];

function label(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function toInputDate(
  value: string | null,
): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value.length >= 10
      ? value.slice(0, 10)
      : "";
  }

  return date
    .toISOString()
    .slice(0, 10);
}

function vehicleToForm(
  vehicle: Vehicle,
): VehicleForm {
  return {
    registrationNumber:
      vehicle.registrationNumber ?? "",

    make:
      vehicle.make ?? "",

    model:
      vehicle.model ?? "",

    year:
      vehicle.year == null
        ? ""
        : String(vehicle.year),

    color:
      vehicle.color ?? "",

    vin:
      vehicle.vin ?? "",

    registrationExpiresAt:
      toInputDate(
        vehicle.registrationExpiresAt,
      ),

    insuranceExpiresAt:
      toInputDate(
        vehicle.insuranceExpiresAt,
      ),

    lastServiceAt:
      toInputDate(
        vehicle.lastServiceAt,
      ),

    nextServiceDueAt:
      toInputDate(
        vehicle.nextServiceDueAt,
      ),

    dailyCents:
      vehicle.rates.dailyCents == null
        ? ""
        : String(
            vehicle.rates.dailyCents / 100,
          ),

    weeklyCents:
      vehicle.rates.weeklyCents == null
        ? ""
        : String(
            vehicle.rates.weeklyCents / 100,
          ),

    monthlyCents:
      vehicle.rates.monthlyCents == null
        ? ""
        : String(
            vehicle.rates.monthlyCents / 100,
          ),

    notes:
      vehicle.notes ?? "",
  };
}

function emptyVehicleForm(): VehicleForm {
  return {
    registrationNumber: "",
    make: "",
    model: "",
    year: "",
    color: "",
    vin: "",
    registrationExpiresAt: "",
    insuranceExpiresAt: "",
    lastServiceAt: "",
    nextServiceDueAt: "",
    dailyCents: "",
    weeklyCents: "",
    monthlyCents: "",
    notes: "",
  };
}

function dateIsValid(
  value: string,
): boolean {
  return (
    !value ||
    !Number.isNaN(
      new Date(value).valueOf(),
    )
  );
}

/*
 * Compliance is judged against a timestamp captured when the
 * fleet snapshot arrives rather than read during render, so
 * every row on a given list is measured against the same
 * moment.
 */
function expiresWithin(
  value: string | null,
  nowMs: number,
  windowMs: number,
): boolean {
  if (!value) {
    return true;
  }

  const expiry =
    new Date(value).getTime();

  if (Number.isNaN(expiry)) {
    return true;
  }

  return expiry <= nowMs + windowMs;
}

function isCurrent(
  value: string | null,
  nowMs: number,
): boolean {
  if (!value) {
    return false;
  }

  const expiry =
    new Date(value).getTime();

  return (
    !Number.isNaN(expiry) &&
    expiry > nowMs
  );
}

const DOCUMENT_WINDOW_MS =
  30 * 24 * 60 * 60 * 1000;

function centsFromInput(
  value: string,
): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const number = Number(trimmed);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    throw new Error(
      "Rates must be non-negative numbers.",
    );
  }

  return Math.round(number * 100);
}

export function VehicleDirectory({
  initialView,
}: {
  initialView?: string | null;
} = {}) {
  const [vehicles, setVehicles] =
    useState<Vehicle[]>([]);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState<
      VehicleStatus | "all"
    >("all");

  /*
   * The filter follows the URL rather than only its first
   * value: following the dashboard link while /vehicles is
   * already mounted changes the query without remounting, and
   * the linked view would otherwise open unfiltered.
   */
  const [manualView, setManualView] =
    useState<{
      view: string | null;
      documentsOnly: boolean;
    } | null>(null);

  const documentsOnly =
    manualView &&
    manualView.view === (initialView ?? null)
      ? manualView.documentsOnly
      : initialView === "documents";

  function setDocumentsOnly(
    next: boolean | ((value: boolean) => boolean),
  ) {
    setManualView({
      view: initialView ?? null,
      documentsOnly:
        typeof next === "function"
          ? next(documentsOnly)
          : next,
    });
  }

  const [evaluatedAt, setEvaluatedAt] =
    useState(0);

  const [editingVehicle, setEditingVehicle] =
    useState<Vehicle | null>(null);

  const [creatingVehicle, setCreatingVehicle] =
    useState(false);

  const [form, setForm] =
    useState<VehicleForm | null>(null);

  const [photos, setPhotos] =
    useState<CloudinaryMedia[]>([]);

  /* Null until changed, so an untouched form saves nothing. */
  const [damage, setDamage] =
    useState<DamageMark[] | null>(null);

  const [saving, setSaving] =
    useState(false);

  const [busyVehicleId, setBusyVehicleId] =
    useState<string>();

  useEffect(() => {
    const source = query(
      collection(
        getFirebaseClient().db,
        "vehicles",
      ),
      orderBy("registrationNumber"),
      limit(100),
    );

    return onSnapshot(
      source,
      (snapshot) => {
        setVehicles(
          snapshot.docs.map(
            (item) =>
              ({
                id: item.id,
                ...item.data(),
              }) as Vehicle,
          ),
        );

        setEvaluatedAt(Date.now());

        setError(undefined);
      },
      () => {
        setError(
          "Fleet records are unavailable. Check your access and try again.",
        );
      },
    );
  }, []);

  const filtered = useMemo(() => {
    const needle =
      search.trim().toLowerCase();

    return vehicles.filter(
      (vehicle) =>
        (status === "all" ||
          vehicle.status === status) &&
        (!documentsOnly ||
          expiresWithin(
            vehicle.registrationExpiresAt,
            evaluatedAt,
            DOCUMENT_WINDOW_MS,
          ) ||
          expiresWithin(
            vehicle.insuranceExpiresAt,
            evaluatedAt,
            DOCUMENT_WINDOW_MS,
          )) &&
        (!needle ||
          `${vehicle.registrationNumber} ${
            vehicle.make
          } ${
            vehicle.model
          } ${vehicle.vin ?? ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [
    vehicles,
    search,
    status,
    documentsOnly,
    evaluatedAt,
  ]);

  const documentsDueCount =
    useMemo(
      () =>
        vehicles.filter(
          (vehicle) =>
            expiresWithin(
              vehicle.registrationExpiresAt,
              evaluatedAt,
              DOCUMENT_WINDOW_MS,
            ) ||
            expiresWithin(
              vehicle.insuranceExpiresAt,
              evaluatedAt,
              DOCUMENT_WINDOW_MS,
            ),
        ).length,
      [
        vehicles,
        evaluatedAt,
      ],
    );

  const statusCount = (
    item: VehicleStatus,
  ) =>
    vehicles.filter(
      (vehicle) =>
        vehicle.status === item,
    ).length;

  function openCreator() {
    setError(undefined);
    setNotice(undefined);
    setEditingVehicle(null);
    setForm(emptyVehicleForm());
    setPhotos([]);
    setCreatingVehicle(true);
  }

  function openEditor(vehicle: Vehicle) {
    setError(undefined);
    setNotice(undefined);
    setEditingVehicle(vehicle);
    setDamage(null);
    setForm(vehicleToForm(vehicle));
    setPhotos(
      (vehicle.photos ??
        []) as CloudinaryMedia[],
    );
  }

  function closeEditor() {
    if (saving) {
      return;
    }

    setEditingVehicle(null);
    setCreatingVehicle(false);
    setForm(null);
    setPhotos([]);
    setDamage(null);
  }

  function updateForm(
    field: keyof VehicleForm,
    value: string,
  ) {
    setForm((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  async function saveVehicle() {
    if ((!editingVehicle && !creatingVehicle) || !form) {
      return;
    }

    setError(undefined);
    setNotice(undefined);

    try {
      if (!form.registrationNumber.trim()) {
        throw new Error(
          "Registration number is required.",
        );
      }

      if (!form.make.trim()) {
        throw new Error(
          "Make is required.",
        );
      }

      if (!form.model.trim()) {
        throw new Error(
          "Model is required.",
        );
      }

      if (form.year.trim()) {
        const year =
          Number(form.year);

        if (
          !Number.isInteger(year) ||
          year < 1886 ||
          year >
            new Date().getFullYear() + 1
        ) {
          throw new Error(
            "Enter a valid vehicle year.",
          );
        }
      }

      if (
        form.registrationExpiresAt &&
        !dateIsValid(
          form.registrationExpiresAt,
        )
      ) {
        throw new Error(
          "Registration expiry date is invalid.",
        );
      }

      if (
        form.insuranceExpiresAt &&
        !dateIsValid(
          form.insuranceExpiresAt,
        )
      ) {
        throw new Error(
          "Insurance expiry date is invalid.",
        );
      }

      if (
        form.lastServiceAt &&
        !dateIsValid(
          form.lastServiceAt,
        )
      ) {
        throw new Error(
          "Last service date is invalid.",
        );
      }

      if (
        form.nextServiceDueAt &&
        !dateIsValid(
          form.nextServiceDueAt,
        )
      ) {
        throw new Error(
          "Next service date is invalid.",
        );
      }

      if (
        form.vin.trim() &&
        form.vin.trim().length !== 17
      ) {
        throw new Error(
          "VIN must contain 17 characters.",
        );
      }

      setSaving(true);

      const payload = {
        registrationNumber:
          form.registrationNumber
            .trim()
            .toUpperCase(),

        make:
          form.make
            .trim()
            .toUpperCase(),

        model:
          form.model.trim(),

        year:
          form.year.trim()
            ? Number(form.year)
            : null,

        color:
          form.color.trim() ||
          null,

        vin:
          form.vin.trim()
            ? form.vin
                .trim()
                .toUpperCase()
            : null,

        registrationExpiresAt:
          form.registrationExpiresAt ||
          null,

        insuranceExpiresAt:
          form.insuranceExpiresAt ||
          null,

        lastServiceAt:
          form.lastServiceAt ||
          null,

        nextServiceDueAt:
          form.nextServiceDueAt ||
          null,

        dailyCents:
          centsFromInput(
            form.dailyCents,
          ),

        weeklyCents:
          centsFromInput(
            form.weeklyCents,
          ),

        monthlyCents:
          centsFromInput(
            form.monthlyCents,
          ),

        notes:
          form.notes.trim() ||
          null,

        photos,
      };

      if (creatingVehicle) {
        const result =
          await callFirestoreOperation<
            Record<string, unknown>,
            {
              vehicleId: string;
              registrationNumber: string;
            }
          >(
            "createVehicle",
            payload,
          );

        setNotice(
          `${result.registrationNumber} added successfully.`,
        );
      } else {
        await callFirestoreOperation<
          Record<string, unknown>,
          void
        >(
          "updateVehicleDetails",
          {
            vehicleId:
              editingVehicle!.id,
            ...payload,
          },
        );

        if (damage) {
          await callFirestoreOperation<
            {
              vehicleId: string;
              damageMarks: DamageMark[];
            },
            unknown
          >("updateVehicleDamage", {
            vehicleId: editingVehicle!.id,
            damageMarks: damage,
          });
        }

        setNotice(
          `${payload.registrationNumber} updated successfully.`,
        );
      }

      setEditingVehicle(null);
      setCreatingVehicle(false);
      setForm(null);
      setPhotos([]);
      setDamage(null);
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    vehicle: Vehicle,
    nextStatus: VehicleStatus,
  ) {
    if (
      nextStatus === vehicle.status
    ) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setBusyVehicleId(vehicle.id);

    try {
      await callFirestoreOperation<
        {
          vehicleId: string;
          status: VehicleStatus;
          note: string;
        },
        void
      >(
        "changeVehicleStatus",
        {
          vehicleId: vehicle.id,
          status: nextStatus,
          note: `Status changed from ${label(
            vehicle.status,
          )} to ${label(
            nextStatus,
          )} from Fleet.`,
        },
      );

      setNotice(
        `${vehicle.registrationNumber} changed to ${label(
          nextStatus,
        )}.`,
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setBusyVehicleId(
        undefined,
      );
    }
  }

  return (
    <AppShell
      title="Fleet"
      eyebrow={`${vehicles.length} vehicle${
        vehicles.length === 1
          ? ""
          : "s"
      } in inventory`}
    >
      <section className="fleet-summary">
        <div>
          <CarFront size={19} />

          <span>
            <strong>
              {statusCount(
                "available",
              )}
            </strong>{" "}
            available
          </span>
        </div>

        <div>
          <ShieldCheck size={19} />

          <span>
            <strong>
              {statusCount(
                "rented",
              )}
            </strong>{" "}
            on rent
          </span>
        </div>

        <div>
          <FileWarning size={19} />

          <span>
            <strong>
              {statusCount(
                "maintenance",
              ) +
                statusCount(
                  "out_of_service",
                )}
            </strong>{" "}
            unavailable
          </span>
        </div>
      </section>

      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          <FileWarning
            size={18}
          />
          {error}
        </div>
      )}

      {notice && (
        <div
          className="alert alert-success"
          role="status"
        >
          <CheckCircle2
            size={18}
          />
          {notice}
        </div>
      )}

      <section className="surface fleet-surface">
        <div className="surface-toolbar">
          <div className="search-box">
            <Search size={18} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
              placeholder="Search registration, make or VIN"
              aria-label="Search fleet"
            />
          </div>

          <button
            className="button button-primary compact"
            type="button"
            onClick={openCreator}
            disabled={saving}
          >
            <Plus size={16} />
            Add vehicle
          </button>

          <div
            className="filter-scroll"
            aria-label="Fleet status filter"
          >
            {statuses.map((item) => (
              <button
                type="button"
                className={
                  status === item
                    ? "filter-chip active"
                    : "filter-chip"
                }
                onClick={() =>
                  setStatus(item)
                }
                key={item}
              >
                {item === "all"
                  ? "All"
                  : label(item)}

                {item !== "all" && (
                  <span>
                    {statusCount(item)}
                  </span>
                )}
              </button>
            ))}

            <button
              type="button"
              className={
                documentsOnly
                  ? "filter-chip active"
                  : "filter-chip"
              }
              aria-pressed={documentsOnly}
              onClick={() =>
                setDocumentsOnly(
                  (current) => !current,
                )
              }
            >
              Documents due

              <span>
                {documentsDueCount}
              </span>
            </button>
          </div>
        </div>

        {filtered.length ? (
          <>
            <div className="table-wrap fleet-table">
              <table>
                <thead>
                  <tr>
                    <th>
                      Vehicle
                    </th>

                    <th>
                      Registration
                    </th>

                    <th>VIN</th>

                    <th>
                      Insurance
                    </th>

                    <th>
                      Registration
                    </th>

                    <th>
                      Daily rate
                    </th>

                    <th>Status</th>

                    <th />
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(
                    (vehicle) => {
                      const busy =
                        busyVehicleId ===
                        vehicle.id;

                      const registrationValid =
                        isCurrent(
                          vehicle.registrationExpiresAt,
                          evaluatedAt,
                        );

                      const insuranceValid =
                        isCurrent(
                          vehicle.insuranceExpiresAt,
                          evaluatedAt,
                        );

                      return (
                        <tr
                          key={
                            vehicle.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                vehicle.make
                              }{" "}
                              {
                                vehicle.model
                              }
                            </strong>

                            <span>
                              {vehicle.year ??
                                "Year pending"}{" "}
                              ·{" "}
                              {vehicle.color ??
                                "Colour pending"}
                            </span>
                          </td>

                          <td>
                            <strong>
                              {
                                vehicle.registrationNumber
                              }
                            </strong>
                          </td>

                          <td
                            className={
                              vehicle.vin
                                ? "mono"
                                : "missing"
                            }
                          >
                            {vehicle.vin ??
                              "VIN pending"}
                          </td>

                          <td
                            className={
                              insuranceValid
                                ? ""
                                : "missing"
                            }
                          >
                            {formatDate(
                              vehicle.insuranceExpiresAt,
                            )}
                          </td>

                          <td
                            className={
                              registrationValid
                                ? ""
                                : "missing"
                            }
                          >
                            {formatDate(
                              vehicle.registrationExpiresAt,
                            )}
                          </td>

                          <td>
                            {vehicle
                              .rates
                              .dailyCents ===
                            null ? (
                              <span className="missing">
                                Pending
                              </span>
                            ) : (
                              formatMoney(
                                vehicle
                                  .rates
                                  .dailyCents,
                              )
                            )}
                          </td>

                          <td>
                            <div className="fleet-status-control">
                              <span
                                className={`status-pill ${vehicle.status}`}
                              >
                                {label(
                                  vehicle.status,
                                )}
                              </span>

                              <select
                                value={
                                  vehicle.status
                                }
                                disabled={
                                  busy
                                }
                                aria-label={`Change status for ${vehicle.registrationNumber}`}
                                onChange={(
                                  event,
                                ) =>
                                  void changeStatus(
                                    vehicle,
                                    event
                                      .target
                                      .value as VehicleStatus,
                                  )
                                }
                              >
                                {statuses
                                  .filter(
                                    (
                                      item,
                                    ): item is VehicleStatus =>
                                      item !==
                                      "all",
                                  )
                                  .map(
                                    (
                                      item,
                                    ) => (
                                      <option
                                        key={
                                          item
                                        }
                                        value={
                                          item
                                        }
                                      >
                                        {label(
                                          item,
                                        )}
                                      </option>
                                    ),
                                  )}
                              </select>
                            </div>
                          </td>

                          <td>
                            <button
                              className="button button-secondary compact"
                              type="button"
                              onClick={() =>
                                openEditor(
                                  vehicle,
                                )
                              }
                            >
                              <Pencil
                                size={15}
                              />
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            <div className="fleet-cards">
              {filtered.map(
                (vehicle) => {
                  const busy =
                    busyVehicleId ===
                    vehicle.id;

                  return (
                    <article
                      className="vehicle-card"
                      key={
                        vehicle.id
                      }
                    >
                      <div>
                        <span
                          className={`status-pill ${vehicle.status}`}
                        >
                          {label(
                            vehicle.status,
                          )}
                        </span>

                        {vehicle.photos
                          ?.[0]?.url && (
                          <img
                            className="vehicle-card-photo"
                            src={
                              vehicle
                                .photos[0]
                                .url
                            }
                            alt={`${vehicle.registrationNumber} photo`}
                            loading="lazy"
                          />
                        )}

                        <strong>
                          {
                            vehicle.registrationNumber
                          }
                        </strong>

                        <p>
                          {
                            vehicle.make
                          }{" "}
                          {
                            vehicle.model
                          }
                        </p>
                      </div>

                      <button
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          openEditor(
                            vehicle,
                          )
                        }
                        aria-label={`Edit ${vehicle.registrationNumber}`}
                      >
                        <Pencil
                          size={17}
                        />
                      </button>

                      <dl>
                        <div>
                          <dt>
                            Insurance
                          </dt>

                          <dd>
                            {formatDate(
                              vehicle.insuranceExpiresAt,
                            )}
                          </dd>
                        </div>

                        <div>
                          <dt>
                            Registration
                          </dt>

                          <dd>
                            {formatDate(
                              vehicle.registrationExpiresAt,
                            )}
                          </dd>
                        </div>

                        <div>
                          <dt>
                            Daily rate
                          </dt>

                          <dd>
                            {vehicle
                              .rates
                              .dailyCents ===
                            null
                              ? "Pending"
                              : formatMoney(
                                  vehicle
                                    .rates
                                    .dailyCents,
                                )}
                          </dd>
                        </div>
                      </dl>

                      <select
                        value={
                          vehicle.status
                        }
                        disabled={
                          busy
                        }
                        aria-label={`Change status for ${vehicle.registrationNumber}`}
                        onChange={(
                          event,
                        ) =>
                          void changeStatus(
                            vehicle,
                            event
                              .target
                              .value as VehicleStatus,
                          )
                        }
                      >
                        {statuses
                          .filter(
                            (
                              item,
                            ): item is VehicleStatus =>
                              item !==
                              "all",
                          )
                          .map(
                            (
                              item,
                            ) => (
                              <option
                                key={
                                  item
                                }
                                value={
                                  item
                                }
                              >
                                {label(
                                  item,
                                )}
                              </option>
                            ),
                          )}
                      </select>
                    </article>
                  );
                },
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-illustration">
              <CarFront />
            </div>

            <div>
              <h2>
                {vehicles.length
                  ? "No vehicles match this view"
                  : "No fleet records yet"}
              </h2>

              <p>
                {vehicles.length
                  ? "Try a different search or status."
                  : "Import the supplied inventory from the setup guide, then verify its missing compliance details."}
              </p>
            </div>
          </div>
        )}
      </section>

      {(editingVehicle || creatingVehicle) &&
        form && (
          <div
            className="vehicle-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.currentTarget ===
                event.target
              ) {
                closeEditor();
              }
            }}
          >
            <section
              className="vehicle-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="vehicle-editor-title"
            >
              <header className="vehicle-modal-header">
                <div>
                  <p className="page-kicker">
                    Fleet record
                  </p>

                  <h2 id="vehicle-editor-title">
                    {creatingVehicle
                      ? "Add vehicle"
                      : `Edit ${editingVehicle?.registrationNumber ?? "vehicle"}`}
                  </h2>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  onClick={
                    closeEditor
                  }
                  disabled={saving}
                  aria-label="Close vehicle editor"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="vehicle-compliance-banner">
                <div>
                  {form.registrationExpiresAt ? (
                    <CheckCircle2
                      size={17}
                    />
                  ) : (
                    <FileWarning
                      size={17}
                    />
                  )}

                  <span>
                    Registration expiry:{" "}
                    <strong>
                      {form.registrationExpiresAt ||
                        "Missing"}
                    </strong>
                  </span>
                </div>

                <div>
                  {form.insuranceExpiresAt ? (
                    <CheckCircle2
                      size={17}
                    />
                  ) : (
                    <FileWarning
                      size={17}
                    />
                  )}

                  <span>
                    Insurance expiry:{" "}
                    <strong>
                      {form.insuranceExpiresAt ||
                        "Missing"}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="vehicle-editor-grid">
                <div className="field">
                  <label htmlFor="registration-number">
                    Registration number
                  </label>

                  <input
                    id="registration-number"
                    value={
                      form.registrationNumber
                    }
                    onChange={(event) =>
                      updateForm(
                        "registrationNumber",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="vin">
                    VIN
                  </label>

                  <input
                    id="vin"
                    value={form.vin}
                    onChange={(event) =>
                      updateForm(
                        "vin",
                        event.target.value,
                      )
                    }
                    maxLength={17}
                  />
                </div>

                <div className="field">
                  <label htmlFor="make">Make</label>

                  <input
                    id="make"
                    value={form.make}
                    onChange={(event) =>
                      updateForm(
                        "make",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="model">Model</label>

                  <input
                    id="model"
                    value={form.model}
                    onChange={(event) =>
                      updateForm(
                        "model",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="year">Year</label>

                  <input
                    id="year"
                    type="number"
                    min="1886"
                    max={
                      new Date().getFullYear() +
                      1
                    }
                    value={form.year}
                    onChange={(event) =>
                      updateForm(
                        "year",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="colour">
                    Colour
                  </label>

                  <input
                    id="colour"
                    value={form.color}
                    onChange={(event) =>
                      updateForm(
                        "color",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="registration-expiry">
                    Registration expiry
                  </label>

                  <input
                    id="registration-expiry"
                    type="date"
                    value={
                      form.registrationExpiresAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "registrationExpiresAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="insurance-expiry">
                    Insurance expiry
                  </label>

                  <input
                    id="insurance-expiry"
                    type="date"
                    value={
                      form.insuranceExpiresAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "insuranceExpiresAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="last-service">
                    Last service
                  </label>

                  <input
                    id="last-service"
                    type="date"
                    value={
                      form.lastServiceAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "lastServiceAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="next-service-due">
                    Next service due
                  </label>

                  <input
                    id="next-service-due"
                    type="date"
                    value={
                      form.nextServiceDueAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "nextServiceDueAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="daily-rate">
                    Daily rate
                  </label>

                  <input
                    id="daily-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.dailyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "dailyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="weekly-rate">
                    Weekly rate
                  </label>

                  <input
                    id="weekly-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.weeklyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "weeklyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="monthly-rate">
                    Monthly rate
                  </label>

                  <input
                    id="monthly-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.monthlyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "monthlyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field full">
                  <label htmlFor="notes">
                    Notes
                  </label>

                  <textarea
                    id="notes"
                    value={form.notes}
                    onChange={(event) =>
                      updateForm(
                        "notes",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field full">
                  <MediaCapture
                    stage="vehicle"
                    value={photos}
                    onChange={setPhotos}
                    label="Vehicle photos"
                    hint="Photos are uploaded to Cloudinary and saved with the fleet record."
                    maxFiles={10}
                  />
                </div>

                {editingVehicle && (
                  <div className="field full">
                    <DamageDiagram
                      label="Damage on this vehicle"
                      hint="Carried from one hire to the next and shown at every checkout. Tap a mark to clear a repair; choose a kind and tap the drawing to add damage found in the yard."
                      marks={
                        damage ??
                        sanitizeDamageMarks(
                          editingVehicle.damageMarks,
                        )
                      }
                      onChange={setDamage}
                    />
                  </div>
                )}
              </div>

              <footer className="vehicle-modal-footer">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={
                    closeEditor
                  }
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() =>
                    void saveVehicle()
                  }
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : "Save vehicle"}
                </button>
              </footer>
            </section>
          </div>
        )}
    </AppShell>
  );
}