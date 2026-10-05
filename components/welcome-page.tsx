"use client";

import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CarFront,
  ClipboardCheck,
  FileSignature,
  FlaskConical,
  Mail,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import {
  useEffect,
  useState,
} from "react";

import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import {
  TRIAL_DAYS,
  salesEmail,
} from "@/lib/license";

import { LicenceTerms } from "./licence-terms";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Bookings to returns",
    text: "Book, check out, extend and return, with overlap checks and rates locked at booking.",
  },
  {
    icon: FileSignature,
    title: "Agreements",
    text: "Printable rental agreements, signed on screen, reviewed and approved before they go out.",
  },
  {
    icon: ClipboardCheck,
    title: "Damage records",
    text: "Mark damage on the vehicle drawings at handover and return; new damage shows in red.",
  },
  {
    icon: ReceiptText,
    title: "Payments and expenses",
    text: "Deposits, balances, discounts that wait for approval, and what the fleet costs to run.",
  },
  {
    icon: BarChart3,
    title: "Finance",
    text: "Revenue, costs and margin per vehicle, with every entry opening as a printable bill.",
  },
  {
    icon: UsersRound,
    title: "Your team",
    text: "Staff sign up from your invite link; you approve them as Operations or Administrator.",
  },
];

/*
 * The front door. A visitor either tries everything in this
 * browser with nothing to sign up for, starts a trial when they
 * want their team on it, or signs in to a workspace they have.
 */
export function WelcomePage() {
  /* Decided after mount: the page is pre-rendered without env access in the browser. */
  const [live, setLive] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    queueMicrotask(() =>
      setLive(liveBackendAvailable()),
    );
  }, []);

  const sales = salesEmail();

  function tryDemo() {
    setBackendMode("demo");
    reloadInto("/");
  }

  function goLive(path: string) {
    setBackendMode("live");
    reloadInto(path);
  }

  return (
    <main className="welcome">
      <header className="welcome-nav">
        <div className="welcome-brand">
          <img
            src="/brand/logo.svg"
            alt=""
            width={34}
            height={34}
          />
          <strong>FleetDesk</strong>
        </div>

        {live && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => goLive("/login")}
          >
            Sign in
          </button>
        )}
      </header>

      <section className="welcome-hero">
        <p className="page-kicker">
          Car rental operations software
        </p>

        <h1>
          Run your rental desk in one place.
        </h1>

        <p className="welcome-lede">
          Bookings, handovers, agreements, damage,
          payments, expenses and finance — for you
          and your staff. Try it with your own
          numbers right now; nothing to sign up for.
        </p>

        <div className="welcome-actions">
          <button
            type="button"
            className="button button-primary welcome-cta"
            onClick={tryDemo}
          >
            <FlaskConical size={18} />
            Try it now — free, no sign-up
            <ArrowRight size={18} />
          </button>

          {live ? (
            <button
              type="button"
              className="button button-secondary welcome-cta"
              onClick={() => goLive("/trial")}
            >
              Start {TRIAL_DAYS}-day free trial
            </button>
          ) : (
            live === false &&
            sales && (
              <a
                className="button button-secondary welcome-cta"
                href={`mailto:${sales}?subject=${encodeURIComponent(
                  "FleetDesk free trial",
                )}`}
              >
                <Mail size={18} />
                Ask for a {TRIAL_DAYS}-day trial
              </a>
            )
          )}
        </div>

        <p className="welcome-note">
          <ShieldCheck size={16} />
          The demo runs entirely in your browser:
          what you enter stays on this device.
        </p>
      </section>

      <section className="welcome-steps">
        <article>
          <span>1</span>
          <h2>Try it yourself</h2>
          <p>
            Open the demo, add your vehicles, rates
            and a few customers, and run a booking
            through checkout and return. Or load a
            sample business to look around first.
          </p>
        </article>

        <article>
          <span>2</span>
          <h2>Test it with your team</h2>
          <p>
            Start a {TRIAL_DAYS}-day free trial with
            your email. You get your own private
            online workspace; invite your staff with
            a link and run it for real.
          </p>
        </article>

        <article>
          <span>3</span>
          <h2>Keep it</h2>
          <p>
            Pay once to keep going — everything from
            the trial carries on. The first month of
            changes is on us.
          </p>
        </article>
      </section>

      <section className="welcome-features">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={20} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="welcome-pricing">
        <div>
          <p className="page-kicker">Pricing</p>
          <h2>One licence. No per-seat fees.</h2>
          <p>
            Your whole team uses the same workspace.
            Maintenance keeps it updated and supported
            after the first month.
          </p>
        </div>

        <div className="billing-card">
          <LicenceTerms />

          <button
            type="button"
            className="button button-primary"
            onClick={
              live
                ? () => goLive("/trial")
                : tryDemo
            }
          >
            {live
              ? `Start the ${TRIAL_DAYS}-day free trial`
              : "Try the demo"}
          </button>
        </div>
      </section>

      <footer className="welcome-footer">
        <CarFront size={16} />
        <span>FleetDesk</span>
        {sales && (
          <a href={`mailto:${sales}`}>{sales}</a>
        )}
      </footer>
    </main>
  );
}
