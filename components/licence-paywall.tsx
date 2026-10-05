"use client";

import {
  Hourglass,
  LogOut,
  Mail,
} from "@/components/icons";

import { signOut } from "@/lib/data/auth";
import { reloadInto } from "@/lib/data/mode";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  salesEmail,
  type WorkspaceRecord,
} from "@/lib/license";

import { LegalFooter } from "./legal-footer";
import { PricingPlans } from "./pricing-plans";
import { useCheckout } from "./use-checkout";

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
  const sales = salesEmail();
  const checkout = useCheckout(workspace);

  async function leave() {
    try {
      await signOut(getFirebaseClient().auth);
    } finally {
      reloadInto("/login");
    }
  }

  return (
    <div className="entry">
      <header className="entry-bar">
        <span className="entry-brand">
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
          />
          <span>FleetDesk</span>
        </span>

        <button
          type="button"
          className="button button-secondary compact"
          onClick={() => void leave()}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </header>

      <main className="paywall">
        <section className="paywall-head">
          <p className="eyebrow">
            <Hourglass size={16} />
            {workspace.name || "Your workspace"}
          </p>

          <h1>Your free trial has ended</h1>

          {paymentSubmitted ? (
            <p>
              Thank you. Stripe has your payment and the
              licence is being switched on. This page opens
              the workspace by itself as soon as it is done;
              there is no need to sign in again.
            </p>
          ) : isAdmin ? (
            <p>
              Everything your team entered is kept. Choose a
              plan to carry on exactly where you left off.
              Payment is taken securely by Stripe.
            </p>
          ) : (
            <p>
              Everything your team entered is kept. Ask your
              administrator
              {workspace.adminEmail
                ? ` (${workspace.adminEmail})`
                : ""}{" "}
              to choose a plan, and the workspace opens again
              for everyone.
            </p>
          )}
        </section>

        {isAdmin && !paymentSubmitted && (
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

        {sales && (
          <p className="paywall-contact">
            Questions about a plan?{" "}
            <a
              href={`mailto:${sales}?subject=${encodeURIComponent(
                `FleetDesk plans: ${workspace.name || workspace.id}`,
              )}`}
            >
              <Mail size={15} />
              {sales}
            </a>
          </p>
        )}
      </main>

      <LegalFooter />
    </div>
  );
}
