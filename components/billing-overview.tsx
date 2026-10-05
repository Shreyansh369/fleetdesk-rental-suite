"use client";

import Link from "next/link";

import {
  AlertTriangle,
  BadgeCheck,
  CreditCard,
  Hourglass,
  LoaderCircle,
  Mail,
  ShieldAlert,
} from "@/components/icons";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  formatUsd,
  licenceStatus,
  salesEmail,
} from "@/lib/license";
import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import { billingPortalUrl } from "@/lib/services/billing";
import { recordPaymentSubmitted } from "@/lib/services/workspace";

import { AppShell } from "./app-shell";
import { useFirebaseAuth } from "./firebase-provider";
import { PricingPlans } from "./pricing-plans";
import { useMinuteClock } from "./protected-page";
import { useCheckout } from "./use-checkout";

function formatDate(value: Date | null): string {
  return value
    ? value.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Not recorded";
}

export function BillingOverview() {
  const auth = useFirebaseAuth();
  const now = useMinuteClock();
  const sales = salesEmail();
  const checkout = useCheckout(auth.workspace);

  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<
    string | null
  >(null);

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
              Only an administrator can see or change the
              plan for this workspace.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  /* The demo has no licence: it shows the plans and the way to a trial. */
  if (auth.mode === "demo" || !auth.workspace) {
    return (
      <AppShell title="Plans and billing" eyebrow="Demo">
        <section className="billing-intro">
          <p>
            This is what FleetDesk costs once you use it for
            your business. The demo itself is free and stays
            in this browser.
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
              Start the 7-day free trial
            </button>
          ) : (
            sales && (
              <a
                className="button button-primary"
                href={`mailto:${sales}?subject=${encodeURIComponent(
                  "FleetDesk free trial",
                )}`}
              >
                <Mail size={17} />
                Ask us for a trial
              </a>
            )
          )}
        </section>

        <PricingPlans />
      </AppShell>
    );
  }

  const workspace = auth.workspace;
  const licence = licenceStatus(workspace, now);

  async function openPortal() {
    setPortalBusy(true);
    setPortalError(null);

    try {
      const url = await billingPortalUrl();

      if (!url) {
        throw new Error(
          sales
            ? `Email ${sales} to change your card or get an invoice.`
            : "The billing portal is not set up yet.",
        );
      }

      window.location.assign(url);
    } catch (cause) {
      setPortalError(
        cause instanceof Error
          ? cause.message
          : "The billing portal could not be opened.",
      );
      setPortalBusy(false);
    }
  }

  if (licence.state === "paid") {
    return (
      <AppShell
        title="Plans and billing"
        eyebrow={workspace.name || "Licence"}
      >
        {workspace.billingIssue && (
          <p className="notice is-error" role="alert">
            <AlertTriangle size={17} />
            The last automatic payment did not go through.
            Update your card in the billing portal to keep
            the subscription active.
          </p>
        )}

        <section className="billing-grid">
          <article className="billing-card">
            <div className="billing-state is-paid">
              <BadgeCheck size={18} />
              {licence.plan
                ? `${licence.plan.name} plan`
                : "Licensed"}
            </div>

            <dl className="billing-facts">
              <div>
                <dt>Started</dt>
                <dd>{formatDate(licence.paidAt)}</dd>
              </div>
              {licence.plan && (
                <>
                  <div>
                    <dt>Change requests included until</dt>
                    <dd>
                      {formatDate(
                        licence.maintenanceIncludedUntil,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Monthly fee</dt>
                    <dd>
                      {formatUsd(licence.plan.monthlyCents)}
                      /month from{" "}
                      {formatDate(licence.monthlyStartsAt)}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            <p className="quiet">
              The monthly fee is charged automatically to the
              card you paid with. Change the card, download
              invoices or cancel the monthly plan in the
              billing portal.
            </p>

            {portalError && (
              <p className="form-error">{portalError}</p>
            )}

            <div className="billing-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={portalBusy}
                onClick={() => void openPortal()}
              >
                {portalBusy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <CreditCard size={17} />
                )}
                Billing portal
              </button>

              {sales && (
                <a
                  className="button button-secondary"
                  href={`mailto:${sales}?subject=${encodeURIComponent(
                    `Change request: ${workspace.name}`,
                  )}`}
                >
                  <Mail size={17} />
                  Request a change
                </a>
              )}
            </div>
          </article>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Plans and billing"
      eyebrow={workspace.name || "Licence"}
    >
      <section className="billing-intro">
        <div
          className={`billing-state ${
            licence.state === "trial"
              ? "is-trial"
              : "is-expired"
          }`}
        >
          <Hourglass size={18} />
          {licence.state === "trial"
            ? `Free trial, ${
                licence.daysLeft === 1
                  ? "last day"
                  : `${licence.daysLeft} days left`
              }`
            : "Free trial ended"}
        </div>

        <p>
          {licence.state === "trial"
            ? `Your trial ends ${licence.trialEndsAt.toLocaleString()}. Choose a plan any time before then and nothing stops; everything your team has entered carries on.`
            : "Choose a plan to open the workspace again. Everything your team entered is kept."}
        </p>
      </section>

      {workspace.paymentSubmittedAt ? (
        <p className="notice">
          <LoaderCircle size={17} className="spin" />
          Stripe has your payment and the licence is being
          switched on. This page updates by itself.
        </p>
      ) : (
        <>
          {checkout.error && (
            <p className="notice is-error" role="alert">
              {checkout.error}
            </p>
          )}

          <PricingPlans
            onChoose={(plan) => void checkout.choose(plan)}
            busyPlan={checkout.busyPlan}
          />
        </>
      )}
    </AppShell>
  );
}

/*
 * Where Stripe sends the administrator after a completed
 * checkout (the success URL). Arriving here proves nothing —
 * anyone can open this address — so it only flags the workspace
 * for us; the licence is switched on by the billing webhook, or
 * by us once the payment is matched.
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
          "Your payment went through, but we could not note it on your workspace. It is still matched from Stripe; you can also email us your receipt.",
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

        <p className="page-kicker">Payment received</p>

        <h1>Thank you</h1>

        {workspace?.plan === "paid" ? (
          <p>
            Your plan is active. A receipt is on its way from
            Stripe.
          </p>
        ) : (
          <p>
            Stripe has confirmed your payment and the licence
            is being switched on. The workspace opens by
            itself as soon as it is done, with everything
            from your trial still there.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        <Link className="button button-primary" href="/">
          Go to the workspace
        </Link>
      </section>
    </main>
  );
}
