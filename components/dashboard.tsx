"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarArrowDown,
  CalendarArrowUp,
  CarFront,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "./app-shell";
import { RentalHistory } from "./rental-history";

import {
  callFirestoreOperation,
  type DashboardSummary,
} from "@/lib/services/firestore-client";

import {
  firebaseErrorMessage,
  formatDate,
} from "@/lib/presentation";

const cards: Array<{
  key: keyof Pick<
    DashboardSummary,
    | "totalFleet"
    | "available"
    | "reserved"
    | "todayPickups"
    | "todayReturns"
    | "overdue"
    | "maintenanceDue"
    | "expiringDocuments"
  >;
  label: string;
  icon: typeof CarFront;
  tone: string;
  href: string;
}> = [
  {
    key: "totalFleet",
    label: "Fleet",
    icon: CarFront,
    tone: "navy",
    href: "/vehicles",
  },
  {
    key: "available",
    label: "Available",
    icon: CheckCircle2,
    tone: "green",
    href: "/vehicles",
  },
  {
    key: "reserved",
    label: "Reserved",
    icon: CalendarArrowUp,
    tone: "blue",
    href: "/vehicles",
  },
  {
    key: "todayPickups",
    label: "Pickups today",
    icon: CalendarArrowUp,
    tone: "purple",
    href: "/rentals",
  },
  {
    key: "todayReturns",
    label: "Returns today",
    icon: CalendarArrowDown,
    tone: "orange",
    href: "/rentals",
  },
  {
    key: "overdue",
    label: "Overdue",
    icon: Clock3,
    tone: "red",
    href: "/rentals",
  },
  {
    key: "maintenanceDue",
    label: "Service due",
    icon: Wrench,
    tone: "orange",
    href: "/vehicles",
  },
  {
    key: "expiringDocuments",
    label: "Documents due",
    icon: AlertTriangle,
    tone: "yellow",
    href: "/vehicles?view=documents",
  },
];

export function Dashboard() {
  const [summary, setSummary] =
    useState<DashboardSummary>();

  const [error, setError] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  const [reloadToken, setReloadToken] =
    useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result =
          await callFirestoreOperation<
            Record<string, never>,
            DashboardSummary
          >(
            "getOperationalDashboard",
            {},
          );

        if (cancelled) {
          return;
        }

        setSummary(result);
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
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(undefined);
    setReloadToken(
      (token) => token + 1,
    );
  }, []);

  const todayLabel =
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date());

  return (
    <AppShell
      title="Today"
      eyebrow={todayLabel}
      action={
        <>
          <button
            type="button"
            className="button button-secondary compact"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh dashboard"
          >
            <RefreshCw
              size={16}
              className={
                loading ? "spin" : undefined
              }
            />
            <span>Refresh</span>
          </button>

          <Link
            href="/rentals"
            className="button button-primary header-primary"
          >
            New booking
          </Link>
        </>
      }
    >
      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section
        className="metric-grid"
        aria-label="Fleet activity"
      >
        {cards.map(
          ({
            key,
            label,
            icon: Icon,
            tone,
            href,
          }) => (
            <Link
              className="metric-card metric-card-link"
              key={key}
              href={href}
              aria-label={`${label}: ${
                summary ? summary[key] : "—"
              }. Open ${
                href.startsWith("/vehicles")
                  ? "fleet"
                  : "rentals"
              }.`}
            >
              <div
                className={`metric-icon ${tone}`}
              >
                <Icon size={19} />
              </div>

              <div>
                <p>{label}</p>

                <strong>
                  {summary
                    ? summary[key]
                    : "—"}
                </strong>
              </div>
            </Link>
          ),
        )}
      </section>

      {summary?.totalFleet === 0 && (
        <section className="empty-state prominent">
          <div className="empty-illustration">
            <CarFront />
          </div>

          <div>
            <h2>Start with your fleet</h2>

            <p>
              Import the reviewed inventory
              before accepting bookings.
            </p>
          </div>

          <Link
            className="button button-primary"
            href="/vehicles"
          >
            Open fleet
          </Link>
        </section>
      )}

      <section className="dashboard-grid">
        <article className="surface upcoming-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Currently on rent
              </p>

              <h2>Active rentals</h2>
            </div>

            <Link
              className="text-link"
              href="/rentals"
            >
              Manage rentals
            </Link>
          </div>

          {summary?.activeRentals.length ? (
            <div className="list-table">
              {summary.activeRentals.map(
                (rental) => (
                  <div
                    className="pickup-row"
                    key={rental.id}
                  >
                    <div className="pickup-time">
                      <strong>
                        {formatDate(
                          rental.expectedReturnAt,
                          {
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </strong>

                      <span>
                        {new Intl.DateTimeFormat(
                          "en-US",
                          {
                            hour: "numeric",
                            minute: "2-digit",
                          },
                        ).format(
                          new Date(
                            rental.expectedReturnAt,
                          ),
                        )}
                      </span>
                    </div>

                    <div className="pickup-customer">
                      <strong>
                        {rental.customerName}
                      </strong>

                      <span>
                        {rental.vehicleRegistration}
                        {" · "}
                        {rental.checkedOutBy}
                      </span>
                    </div>

                    <span
                      className={`status-pill ${rental.status}`}
                    >
                      {rental.status === "overdue"
                        ? "Overdue"
                        : "Rented"}
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="inline-empty">
              No active rentals.
            </div>
          )}
        </article>

        <article className="surface upcoming-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Next 7 days
              </p>

              <h2>Upcoming pickups</h2>
            </div>

            <Link
              className="text-link"
              href="/rentals"
            >
              View bookings
            </Link>
          </div>

          {summary?.upcomingReservations
            .length ? (
            <div className="list-table">
              {summary.upcomingReservations.map(
                (reservation) => (
                  <div
                    className="pickup-row"
                    key={reservation.id}
                  >
                    <div className="pickup-time">
                      <strong>
                        {formatDate(
                          reservation.pickupAt,
                          {
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </strong>

                      <span>
                        {new Intl.DateTimeFormat(
                          "en-US",
                          {
                            hour: "numeric",
                            minute: "2-digit",
                          },
                        ).format(
                          new Date(
                            reservation.pickupAt,
                          ),
                        )}
                      </span>
                    </div>

                    <div className="pickup-customer">
                      <strong>
                        {reservation.customerName}
                      </strong>

                      <span>
                        {
                          reservation.vehicleRegistration
                        }
                      </span>
                    </div>

                    <span className="status-pill reserved">
                      Reserved
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="inline-empty">
              No upcoming pickups.
            </div>
          )}
        </article>

        <article className="surface attention-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Needs attention
              </p>

              <h2>Daily checks</h2>
            </div>
          </div>

          <div className="attention-list">
            <Link
              href="/rentals"
              className="attention-link"
              aria-label="View overdue rentals"
            >
              <span
                className={
                  summary?.overdue
                    ? "attention-dot danger"
                    : "attention-dot"
                }
              />

              <p>
                <strong>
                  {summary?.overdue ?? 0} overdue
                  rental
                  {summary?.overdue === 1
                    ? ""
                    : "s"}
                </strong>

                <span>
                  Follow up before close of
                  day
                </span>
              </p>
            </Link>

            <Link
              href="/vehicles"
              className="attention-link"
              aria-label="View vehicles needing service"
            >
              <span
                className={
                  summary?.maintenanceDue
                    ? "attention-dot warning"
                    : "attention-dot"
                }
              />

              <p>
                <strong>
                  {summary?.maintenanceDue ?? 0}{" "}
                  service item
                  {summary?.maintenanceDue === 1
                    ? ""
                    : "s"}{" "}
                  due
                </strong>

                <span>
                  Review fleet readiness
                </span>
              </p>
            </Link>

            <Link
              href="/vehicles?view=documents"
              className="attention-link"
              aria-label="View vehicle compliance documents"
            >
              <span
                className={
                  summary?.expiringDocuments
                    ? "attention-dot warning"
                    : "attention-dot"
                }
              />

              <p>
                <strong>
                  {summary?.expiringDocuments ??
                    0}{" "}
                  document
                  {summary?.expiringDocuments ===
                  1
                    ? ""
                    : "s"}{" "}
                  due
                </strong>

                <span>
                  Registration or insurance
                </span>
              </p>
            </Link>
          </div>
        </article>
      </section>

      <section className="surface history-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">
              Recent activity
            </p>

            <h2>Rental history</h2>
          </div>

          <Link
            className="text-link"
            href="/customers?view=history"
          >
            Full history
          </Link>
        </div>

        {/*
          * Its own read, so a history that cannot be loaded
          * costs the dashboard its bottom panel and nothing
          * else.
          */}
        <RentalHistory
          compact
          limit={8}
          reloadToken={reloadToken}
        />
      </section>
    </AppShell>
  );
}