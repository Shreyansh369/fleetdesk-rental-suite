"use client";

import {
  CreditCard,
  Hourglass,
  LogOut,
  Mail,
} from "lucide-react";

import { signOut } from "@/lib/data/auth";
import { reloadInto } from "@/lib/data/mode";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  LICENCE_PRICE_CENTS,
  formatUsd,
  salesEmail,
  stripeCheckoutUrl,
  type WorkspaceRecord,
} from "@/lib/license";

import { LicenceTerms } from "./licence-terms";

/*
 * What a workspace shows once its trial has run out and it has
 * not been paid for. The data is all still there — the rules
 * simply stop serving it — so paying picks up exactly where the
 * trial left off.
 */
export function LicencePaywall({
  workspace,
  isAdmin,
  paymentSubmitted,
}: {
  workspace: WorkspaceRecord;
  isAdmin: boolean;
  paymentSubmitted: boolean;
}) {
  const checkout = stripeCheckoutUrl(workspace);
  const sales = salesEmail();

  async function leave() {
    try {
      await signOut(getFirebaseClient().auth);
    } finally {
      reloadInto("/login");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card paywall-card">
        <div className="auth-symbol">
          <Hourglass />
        </div>

        <p className="page-kicker">
          {workspace.name || "Your workspace"}
        </p>

        <h1>Your free trial has ended</h1>

        {paymentSubmitted ? (
          <p>
            Thank you — we have your payment and are
            activating the licence. This page opens by
            itself as soon as it is done; there is no
            need to sign in again.
          </p>
        ) : isAdmin ? (
          <p>
            Everything your team entered is kept. Buy
            the licence to carry on exactly where you
            left off.
          </p>
        ) : (
          <p>
            Everything your team entered is kept. Ask
            your administrator
            {workspace.adminEmail
              ? ` (${workspace.adminEmail})`
              : ""}{" "}
            to buy the licence, and this workspace
            opens again for everyone.
          </p>
        )}

        {isAdmin && !paymentSubmitted && (
          <>
            <LicenceTerms compact />

            {checkout ? (
              <a
                className="button button-primary paywall-action"
                href={checkout}
              >
                <CreditCard size={18} />
                Pay {formatUsd(LICENCE_PRICE_CENTS)} with
                Stripe
              </a>
            ) : (
              <p className="form-error">
                Online payment is not set up for this
                site yet.
                {sales
                  ? ` Email ${sales} and we will send you a payment link.`
                  : ""}
              </p>
            )}
          </>
        )}

        <div className="paywall-secondary">
          {sales && (
            <a
              className="button button-secondary"
              href={`mailto:${sales}?subject=${encodeURIComponent(
                `FleetDesk licence — ${workspace.name || workspace.id}`,
              )}`}
            >
              <Mail size={17} />
              Contact us
            </a>
          )}

          <button
            type="button"
            className="button button-secondary"
            onClick={() => void leave()}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
