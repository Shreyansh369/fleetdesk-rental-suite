"use client";

import Link from "next/link";

import {
  BadgeCheck,
  CreditCard,
  Hourglass,
  LoaderCircle,
  Mail,
  ShieldAlert,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  INCLUDED_SUPPORT_DAYS,
  LICENCE_PRICE_CENTS,
  MAINTENANCE_MONTHLY_CENTS,
  formatUsd,
  licenceStatus,
  salesEmail,
  stripeCheckoutUrl,
} from "@/lib/license";
import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import { recordPaymentSubmitted } from "@/lib/services/workspace";

import { AppShell } from "./app-shell";
import { useFirebaseAuth } from "./firebase-provider";
import { LicenceTerms } from "./licence-terms";
import { useMinuteClock } from "./protected-page";

function formatDate(value: Date | null): string {
  return value
    ? value.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
}

export function BillingOverview() {
  const auth = useFirebaseAuth();
  const now = useMinuteClock();
  const sales = salesEmail();

  if (auth.role !== "admin") {
    return (
      <AppShell title="Billing" eyebrow="Restricted">
        <section className="empty-state prominent">
          <div className="empty-illustration">
            <ShieldAlert />
          </div>
          <div>
            <h2>Administrator access required</h2>
            <p>
              Only an administrator can see or change
              the licence for this workspace.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  /* The demo has no licence: it shows the offer. */
  if (auth.mode === "demo" || !auth.workspace) {
    return (
      <AppShell title="Billing" eyebrow="Pricing">
        <section className="billing-grid">
          <article className="billing-card">
            <h2>What it costs</h2>
            <LicenceTerms />
          </article>

          <article className="billing-card">
            <h2>Ready to try it for real?</h2>
            <p>
              The demo lives in this browser. A free
              trial is your own workspace online: your
              team signs in from their own devices, and
              everything you enter is kept when you buy
              the licence.
            </p>

            {liveBackendAvailable() ? (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setBackendMode("live");
                  reloadInto("/trial");
                }}
              >
                Start 7-day free trial
              </button>
            ) : (
              sales && (
                <a
                  className="button button-primary"
                  href={`mailto:${sales}?subject=${encodeURIComponent("FleetDesk free trial")}`}
                >
                  <Mail size={17} />
                  Ask us for a trial
                </a>
              )
            )}
          </article>
        </section>
      </AppShell>
    );
  }

  const workspace = auth.workspace;
  const licence = licenceStatus(workspace, now);
  const checkout = stripeCheckoutUrl(workspace);
  const portal =
    process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL?.trim();

  return (
    <AppShell
      title="Billing"
      eyebrow={workspace.name || "Licence"}
    >
      <section className="billing-grid">
        <article className="billing-card billing-status">
          {licence.state === "paid" ? (
            <>
              <div className="billing-state is-paid">
                <BadgeCheck size={20} />
                Licensed
              </div>

              <dl className="billing-facts">
                <div>
                  <dt>Licence bought</dt>
                  <dd>{formatDate(licence.paidAt)}</dd>
                </div>
                <div>
                  <dt>Changes included until</dt>
                  <dd>
                    {formatDate(
                      licence.includedSupportEndsAt,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Maintenance</dt>
                  <dd>
                    {formatUsd(
                      MAINTENANCE_MONTHLY_CENTS,
                    )}
                    /month
                    {licence.maintenanceActive
                      ? ""
                      : ` from ${formatDate(
                          licence.includedSupportEndsAt,
                        )}`}
                  </dd>
                </div>
              </dl>

              <p className="quiet">
                Changes you ask for in the first{" "}
                {INCLUDED_SUPPORT_DAYS} days after buying
                are included. After that, maintenance
                covers updates, fixes and support.
              </p>

              <div className="billing-actions">
                {sales && (
                  <a
                    className="button button-primary"
                    href={`mailto:${sales}?subject=${encodeURIComponent(
                      `Change request — ${workspace.name}`,
                    )}`}
                  >
                    <Mail size={17} />
                    Request a change
                  </a>
                )}

                {portal && (
                  <a
                    className="button button-secondary"
                    href={portal}
                  >
                    <CreditCard size={17} />
                    Manage maintenance billing
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className={`billing-state ${
                  licence.state === "trial"
                    ? "is-trial"
                    : "is-expired"
                }`}
              >
                <Hourglass size={20} />
                {licence.state === "trial"
                  ? `Free trial — ${
                      licence.daysLeft === 1
                        ? "last day"
                        : `${licence.daysLeft} days left`
                    }`
                  : "Free trial ended"}
              </div>

              <dl className="billing-facts">
                <div>
                  <dt>
                    {licence.state === "trial"
                      ? "Trial ends"
                      : "Trial ended"}
                  </dt>
                  <dd>
                    {licence.trialEndsAt.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Administrator</dt>
                  <dd>{workspace.adminEmail}</dd>
                </div>
              </dl>

              {workspace.paymentSubmittedAt ? (
                <p className="billing-pending">
                  <LoaderCircle
                    size={16}
                    className="spin"
                  />
                  We have your payment and are
                  activating the licence. This page
                  updates by itself.
                </p>
              ) : checkout ? (
                <a
                  className="button button-primary billing-pay"
                  href={checkout}
                >
                  <CreditCard size={18} />
                  Buy the licence ·{" "}
                  {formatUsd(LICENCE_PRICE_CENTS)}
                </a>
              ) : (
                <p className="form-error">
                  Online payment is not set up yet.
                  {sales
                    ? ` Email ${sales} and we will send you a payment link.`
                    : ""}
                </p>
              )}

              <p className="quiet">
                Paid securely with Stripe. Everything
                your team entered during the trial is
                kept.
              </p>
            </>
          )}
        </article>

        <article className="billing-card">
          <h2>Your licence</h2>
          <LicenceTerms />
        </article>
      </section>
    </AppShell>
  );
}

/*
 * Where Stripe sends the administrator after a completed
 * checkout. The payment link must be configured to redirect
 * here (see docs/billing.md). Arriving here proves nothing —
 * anyone can open this address — so it only flags the
 * workspace for us to match against the Stripe payment;
 * the licence is switched on from our side.
 */
export function PaymentReturn() {
  const auth = useFirebaseAuth();
  const recorded = useRef(false);
  const [error, setError] = useState<string | null>(
    null,
  );

  const workspace = auth.workspace;

  useEffect(() => {
    if (
      recorded.current ||
      auth.mode !== "live" ||
      auth.role !== "admin" ||
      !workspace ||
      workspace.plan === "paid" ||
      workspace.paymentSubmittedAt
    ) {
      return;
    }

    recorded.current = true;

    recordPaymentSubmitted(workspace.id).catch(
      (cause: unknown) => {
        console.error(
          "Could not record the payment:",
          cause,
        );
        setError(
          "Your payment went through, but we could not note it on your workspace. It will still be matched from Stripe — or email us your receipt.",
        );
      },
    );
  }, [auth.mode, auth.role, workspace]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-symbol">
          <BadgeCheck />
        </div>

        <p className="page-kicker">
          Payment received
        </p>

        <h1>Thank you</h1>

        {workspace?.plan === "paid" ? (
          <p>
            Your licence is active. Changes you ask
            for in the next {INCLUDED_SUPPORT_DAYS} days
            are included.
          </p>
        ) : (
          <p>
            Stripe has confirmed your payment. We are
            activating your licence now; your workspace
            opens by itself as soon as it is done, with
            everything from your trial still there.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        <Link
          className="button button-primary"
          href="/"
        >
          Go to the workspace
        </Link>
      </section>
    </main>
  );
}
