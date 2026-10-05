"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  ArrowRight,
  Desktop,
  DeviceMobile,
  Television,
} from "@/components/icons";

import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import { DEMO_PASSWORD } from "@/lib/demo/sample-data";
import {
  TRIAL_DAYS,
  salesEmail,
} from "@/lib/license";

import { LegalFooter } from "./legal-footer";
import { PricingPlans } from "./pricing-plans";
import { SiteHeader } from "./site-header";

const DAY = [
  {
    heading: "At the counter",
    points: [
      "Book a vehicle against live availability; overlapping bookings are refused.",
      "Check the renter out with a signed agreement, the deposit and the first payment in one step.",
      "Extend a hire, add extra hours or take a part payment without starting over.",
    ],
  },
  {
    heading: "On the lot",
    points: [
      "Mark scratches, dents and chips on the vehicle drawing at handover and at return.",
      "New damage at return shows in red against what was already there.",
      "Service dates, insurance and registration expiry are flagged before they lapse.",
    ],
  },
  {
    heading: "In the office",
    points: [
      "Every payment, discount and expense lands in one ledger that cannot be edited after the fact.",
      "Discounts from staff wait for an administrator; agreements are reviewed before they go out.",
      "Revenue, costs and margin per vehicle for any date range, each line printable as a bill.",
    ],
  },
  {
    heading: "For the owner",
    points: [
      "Staff join from an invite link and only see what their role allows.",
      "Finance, staff approval and billing stay with administrators.",
      "Each business's data is kept apart from every other's and enforced on the server.",
    ],
  },
];

const FAQ = [
  {
    question: "Do I need a card to start the trial?",
    answer: `No. The ${TRIAL_DAYS}-day trial needs only an email address. You choose a plan, and pay through Stripe, when you decide to keep going.`,
  },
  {
    question: "Is anything I type into the demo sent to you?",
    answer:
      "No. The demo runs in your browser and keeps its data on your device. It is a good place for your own vehicles and rates, but not for real customers' details.",
  },
  {
    question: "What happens to the trial data when I pay?",
    answer:
      "Nothing. The workspace your team used during the trial is the one you keep, with everything still in it.",
  },
  {
    question: "Which devices does it run on?",
    answer:
      "Any current browser on Windows, macOS, Linux, Android, iPhone, iPad or a smart TV. It can be added to the home screen and opens like an app.",
  },
  {
    question: "Are hosting and the database extra?",
    answer:
      "No. Hosting, the database, backups and security updates are included in both plans. The only extras are an Android store listing or your own domain, at cost, if you want them.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes. The monthly fee can be cancelled at any time from the billing portal, and upfront payments can be refunded within 14 days.",
  },
];

/*
 * The front door. A visitor either tries everything in this
 * browser with nothing to sign up for, starts a trial when they
 * want their team on it, or signs in to a workspace they have.
 */
export function WelcomePage() {
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    queueMicrotask(() => setLive(liveBackendAvailable()));
  }, []);

  const sales = salesEmail();

  function openDemo() {
    setBackendMode("demo");
    reloadInto("/login");
  }

  function startTrial() {
    setBackendMode("live");
    reloadInto("/trial");
  }

  return (
    <div className="site">
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Bookings, handovers and agreements for car rental
              offices.
            </h1>

            <p className="hero-lede">
              FleetDesk keeps your fleet, customers, rentals and
              money in one workspace your whole team can use from
              the counter, the lot or the office. Try the full
              product with your own numbers today, then run it
              for real with a {TRIAL_DAYS}-day trial.
            </p>

            <div className="hero-actions">
              <button
                type="button"
                className="button button-primary button-large"
                onClick={openDemo}
              >
                Open the demo
                <ArrowRight size={18} />
              </button>

              {live ? (
                <button
                  type="button"
                  className="button button-secondary button-large"
                  onClick={startTrial}
                >
                  Start a {TRIAL_DAYS}-day trial
                </button>
              ) : (
                live === false &&
                sales && (
                  <a
                    className="button button-secondary button-large"
                    href={`mailto:${sales}?subject=${encodeURIComponent(
                      "FleetDesk trial",
                    )}`}
                  >
                    Ask for a {TRIAL_DAYS}-day trial
                  </a>
                )
              )}
            </div>

            <p className="hero-demo-note">
              Demo sign-in: <code>demo.admin@gmail.com</code>{" "}
              with password <code>{DEMO_PASSWORD}</code>. No
              account needed; everything stays in your browser.
            </p>
          </div>

          <figure className="hero-shot">
            <img
              src="/marketing/dashboard.png"
              alt="The FleetDesk overview: fleet counts, vehicles out on hire, today's pickups and returns."
              width={1440}
              height={900}
            />
          </figure>
        </section>

        <section className="section" id="features">
          <div className="section-head">
            <h2>What it handles</h2>
            <p>
              Built around the work a rental office does every
              day, not a generic booking calendar.
            </p>
          </div>

          <div className="day-grid">
            {DAY.map((part) => (
              <div key={part.heading} className="day-part">
                <h3>{part.heading}</h3>
                <ul>
                  {part.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-steps">
          <div className="section-head">
            <h2>How to start</h2>
          </div>

          <ol className="steps">
            <li>
              <h3>Try it on your own</h3>
              <p>
                Open the demo and sign in as the owner, a
                manager or a desk employee. Add your vehicles
                and rates, or load the sample business.
              </p>
            </li>
            <li>
              <h3>Run a trial with your team</h3>
              <p>
                Start a {TRIAL_DAYS}-day trial with your email.
                You get a private online workspace and an invite
                link for your staff.
              </p>
            </li>
            <li>
              <h3>Choose a plan</h3>
              <p>
                Pay by card through Stripe. The trial workspace
                becomes yours, with everything your team entered.
              </p>
            </li>
          </ol>
        </section>

        <section className="section" id="pricing">
          <div className="section-head">
            <h2>Pricing</h2>
            <p>
              One workspace for the whole business. No charge per
              user, per vehicle or per booking.
            </p>
          </div>

          <PricingPlans />

          {live && (
            <p className="section-cta">
              <button
                type="button"
                className="button button-primary"
                onClick={startTrial}
              >
                Start the free trial
              </button>
            </p>
          )}
        </section>

        <section className="section devices">
          <div className="section-head">
            <h2>On the devices you already have</h2>
            <p>
              The same workspace adapts to whatever is in front
              of the person using it.
            </p>
          </div>

          <ul className="device-list">
            <li>
              <Desktop size={22} />
              <div>
                <h3>Office computers</h3>
                <p>
                  Full-width tables for finance, the fleet and
                  the booking history.
                </p>
              </div>
            </li>
            <li>
              <DeviceMobile size={22} />
              <div>
                <h3>Phones and tablets</h3>
                <p>
                  Handover on the lot: photos, damage marks and
                  the customer&apos;s signature on screen.
                </p>
              </div>
            </li>
            <li>
              <Television size={22} />
              <div>
                <h3>A screen on the wall</h3>
                <p>
                  Today&apos;s pickups, returns and overdue hires,
                  readable from across the room.
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section className="section faq">
          <div className="section-head">
            <h2>Questions</h2>
          </div>

          <div className="faq-list">
            {FAQ.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}
