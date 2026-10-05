import Link from "next/link";
import type { ReactNode } from "react";

import {
  ADD_ONS,
  PLANS,
  TRIAL_DAYS,
  formatUsd,
} from "@/lib/license";
import { legalDetails } from "@/lib/legal";

/*
 * The text of the legal pages, written for how FleetDesk
 * actually works. Prices are read from lib/license.ts so the
 * terms can never disagree with the pricing page.
 */

export type LegalSection = {
  id: string;
  heading: string;
  body: ReactNode;
};

export type LegalDocument = {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
};

const sub = PLANS.subscription;
const buy = PLANS.buyout;
const android = ADD_ONS.find((addOn) => addOn.id === "android")!;
const domain = ADD_ONS.find((addOn) => addOn.id === "domain")!;

function Contact() {
  const legal = legalDetails();

  return legal.email ? (
    <a href={`mailto:${legal.email}`}>{legal.email}</a>
  ) : (
    <>{legal.contact}</>
  );
}

export function termsDocument(): LegalDocument {
  const legal = legalDetails();

  return {
    title: "Terms of service",
    intro: (
      <p>
        These terms are an agreement between {legal.entity}{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the business that
        uses {legal.product} (&ldquo;you&rdquo;). By starting a
        trial, choosing a plan or using the service you accept
        them on behalf of that business, and you confirm you are
        authorised to do so.
      </p>
    ),
    sections: [
      {
        id: "service",
        heading: "The service",
        body: (
          <>
            <p>
              {legal.product} is software for running a car rental
              business: vehicles, customers, bookings, handover and
              return, rental agreements, damage records, payments,
              expenses, finance reporting and staff access. We host
              it and keep it running; you decide what goes into it.
            </p>
            <p>
              It is offered in three ways: a free demo that runs in
              your browser, a free {TRIAL_DAYS}-day trial workspace,
              and a paid plan.
            </p>
          </>
        ),
      },
      {
        id: "demo",
        heading: "The demo",
        body: (
          <p>
            The demo stores everything you enter in your own
            browser on your own device. We do not receive it, cannot
            recover it, and it is lost if you clear your browser
            data. The demo accounts and password are public; do not
            enter real customer information into the demo.
          </p>
        ),
      },
      {
        id: "trial",
        heading: "The free trial",
        body: (
          <>
            <p>
              A trial gives one administrator email a private
              workspace for {TRIAL_DAYS} days from the moment it is
              created, with as many staff as the administrator
              approves. One trial is available per email address.
              No payment details are needed to start.
            </p>
            <p>
              When the trial ends the workspace closes until a plan
              is chosen. What you entered is kept for 30 days after
              the trial ends so you can carry on where you left off;
              after that we may delete it.
            </p>
          </>
        ),
      },
      {
        id: "accounts",
        heading: "Your accounts and your team",
        body: (
          <p>
            The administrator who starts the workspace controls it:
            who may join, which role each person has, and when
            access is removed. You are responsible for everything
            done under your workspace&apos;s accounts, for keeping
            passwords private, and for removing people who should no
            longer have access. Tell us straight away if you think an
            account has been misused.
          </p>
        ),
      },
      {
        id: "plans",
        heading: "Plans, prices and payment",
        body: (
          <>
            <p>There are two plans. Prices are in US dollars.</p>
            <ul>
              <li>
                <strong>{sub.name}.</strong>{" "}
                {formatUsd(sub.upfrontCents)} when you start, then{" "}
                {formatUsd(sub.monthlyCents)} a month from the start
                of month {sub.monthlyStartsAfterMonths + 1}. The
                monthly fee covers hosting, updates, maintenance and
                support.
              </li>
              <li>
                <strong>{buy.name}.</strong>{" "}
                {formatUsd(buy.upfrontCents)} once, covering the first
                12 months with no monthly fee. Maintenance and change
                requests are included for the first{" "}
                {buy.includedMaintenanceMonths} months. From the start
                of month {buy.monthlyStartsAfterMonths + 1} the{" "}
                {formatUsd(buy.monthlyCents)} monthly fee applies.
              </li>
            </ul>
            <p>
              Payments are processed by Stripe. By choosing a plan you
              authorise us, through Stripe, to charge the upfront
              amount on purchase and the monthly fee automatically on
              the same day each month once it starts, until you
              cancel. Sales tax, VAT or similar taxes are added where
              the law requires.
            </p>
            <p>
              Hosting, the database, backups and security updates are
              included in both plans. We may change the monthly fee
              for future months by telling you at least 30 days in
              advance; the change applies from your next billing date
              after that notice.
            </p>
          </>
        ),
      },
      {
        id: "extras",
        heading: "Optional extras",
        body: (
          <p>
            An Android app listing ({formatUsd(android.cents)}{" "}
            {android.period}) and your own web address (
            {formatUsd(domain.cents)} {domain.period}) are charged at
            what they cost us when you ask for them. Installing the
            web app on a phone, tablet, computer or TV from its
            browser is free.
          </p>
        ),
      },
      {
        id: "maintenance",
        heading: "Maintenance and change requests",
        body: (
          <p>
            Maintenance means keeping the service working, secure
            and up to date, and making reasonable changes you ask for
            to how it works for your business. While maintenance is
            included or paid for, we will agree each change with you
            before starting it. Changes that amount to new products,
            integrations with other systems or work for other
            businesses are quoted separately. Between month{" "}
            {buy.includedMaintenanceMonths + 1} and month{" "}
            {buy.monthlyStartsAfterMonths} of the {buy.name} plan,
            change requests are quoted individually; keeping the
            service running and secure is always included.
          </p>
        ),
      },
      {
        id: "data",
        heading: "Your data",
        body: (
          <>
            <p>
              The information your business puts into the workspace
              is yours. We use it only to provide the service to you,
              as described in our{" "}
              <Link href="/privacy">privacy policy</Link>, where we act
              as your processor for your customers&apos; personal
              data.
            </p>
            <p>
              You are responsible for having a lawful basis for the
              personal data you enter, including copies of driving
              licences and signatures, and for telling your customers
              how you use it. You can ask us for an export of your
              workspace at any time while it is active and for 30 days
              after it closes.
            </p>
          </>
        ),
      },
      {
        id: "use",
        heading: "Acceptable use",
        body: (
          <p>
            You agree to follow our{" "}
            <Link href="/acceptable-use">acceptable use policy</Link>.
            We may suspend access that puts the service, other
            customers or the public at risk, telling you why as soon
            as we reasonably can.
          </p>
        ),
      },
      {
        id: "availability",
        heading: "Availability and support",
        body: (
          <p>
            We aim to keep the service available at all times, but it
            runs on third-party infrastructure and may occasionally be
            unavailable for maintenance or for reasons outside our
            control. We do not promise uninterrupted availability
            unless we have agreed a service level with you in writing.
            Support is by email at <Contact />.
          </p>
        ),
      },
      {
        id: "ending",
        heading: "Cancelling and ending",
        body: (
          <p>
            You can cancel the monthly fee at any time from the
            billing portal; our{" "}
            <Link href="/refunds">refund and cancellation policy</Link>{" "}
            explains what happens next. We may end the agreement if
            you seriously breach these terms and do not put it right
            within 14 days of us asking, or if payment remains unpaid
            14 days after it failed.
          </p>
        ),
      },
      {
        id: "liability",
        heading: "Warranties and liability",
        body: (
          <>
            <p>
              We will provide the service with reasonable skill and
              care. Apart from that, it is provided as it is, and you
              remain responsible for the decisions you make with it,
              including the prices you charge and the agreements you
              sign with your customers.
            </p>
            <p>
              Neither of us is liable to the other for indirect or
              consequential loss, or for loss of profit, revenue or
              goodwill. Our total liability in any 12 months is
              limited to the amount you paid us in those 12 months.
              Nothing in these terms limits liability that cannot be
              limited by law.
            </p>
          </>
        ),
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        body: (
          <p>
            We may update these terms. We will tell workspace
            administrators about material changes at least 30 days
            before they apply. If you do not agree, you may cancel
            before they take effect.
          </p>
        ),
      },
      {
        id: "law",
        heading: "Governing law",
        body: (
          <p>
            These terms are governed by the laws of{" "}
            {legal.jurisdiction}, and its courts have jurisdiction
            over any dispute, unless the law where your business is
            established requires otherwise.
          </p>
        ),
      },
      {
        id: "contact",
        heading: "Contact",
        body: (
          <p>
            {legal.entity}
            {legal.address ? `, ${legal.address}` : ""}. Email{" "}
            <Contact />.
          </p>
        ),
      },
    ],
  };
}

export function privacyDocument(): LegalDocument {
  const legal = legalDetails();

  return {
    title: "Privacy policy",
    intro: (
      <p>
        This policy explains what personal data {legal.product}{" "}
        handles, why, where it is kept and the choices you have. It
        applies to this website, the demo, trial workspaces and paid
        workspaces.
      </p>
    ),
    sections: [
      {
        id: "roles",
        heading: "Who is responsible",
        body: (
          <>
            <p>
              For the accounts of the people who use{" "}
              {legal.product}, and for billing, {legal.entity} is the
              controller.
            </p>
            <p>
              For the information a rental business enters about its
              own customers (names, contact details, dates of birth,
              driving licence details and photographs, signatures,
              rentals and payments), that business is the controller
              and we process it on its behalf, only on its
              instructions. If you rented a vehicle and have a
              question about your data, please contact the rental
              company first.
            </p>
          </>
        ),
      },
      {
        id: "collect",
        heading: "What we collect",
        body: (
          <ul>
            <li>
              <strong>Account details:</strong> name, email address,
              mobile number, age, role, and when an account was
              approved.
            </li>
            <li>
              <strong>Workspace content:</strong> whatever your
              business records in the workspace, including vehicle,
              customer, rental, payment and expense records and the
              photographs attached to them.
            </li>
            <li>
              <strong>Billing:</strong> the plan chosen, payment status
              and Stripe customer and subscription references. Card
              details are entered on Stripe&apos;s pages and never
              reach us.
            </li>
            <li>
              <strong>Technical data:</strong> sign-in tokens and the
              settings described in our{" "}
              <Link href="/cookies">cookie policy</Link>, and the
              security logs our hosting provider keeps.
            </li>
            <li>
              <strong>Messages</strong> you send us.
            </li>
          </ul>
        ),
      },
      {
        id: "demo",
        heading: "The demo",
        body: (
          <p>
            The demo keeps everything in your browser. We do not
            receive what you enter there, and we do not collect
            anything about how you use it.
          </p>
        ),
      },
      {
        id: "use",
        heading: "How we use it, and why",
        body: (
          <ul>
            <li>
              To provide the workspace, sign people in and keep it
              secure (performing our contract with you).
            </li>
            <li>
              To take payment and keep tax records (contract, and our
              legal obligations).
            </li>
            <li>
              To answer support requests and tell administrators
              about changes to the service or these policies
              (contract and legitimate interests).
            </li>
          </ul>
        ),
      },
      {
        id: "never",
        heading: "What we do not do",
        body: (
          <p>
            We do not sell personal data, use it for advertising,
            build profiles of your customers, or use workspace content
            for any purpose other than providing the service to the
            business that entered it.
          </p>
        ),
      },
      {
        id: "processors",
        heading: "Who processes it for us",
        body: (
          <ul>
            <li>
              <strong>Google Cloud (Firebase):</strong>{" "}
              authentication, database and website hosting.
            </li>
            <li>
              <strong>Cloudinary:</strong> storage of vehicle
              condition and licence photographs.
            </li>
            <li>
              <strong>Stripe:</strong> payments, invoices and the
              billing portal.
            </li>
          </ul>
        ),
      },
      {
        id: "transfers",
        heading: "International transfers",
        body: (
          <p>
            These providers may process data outside your country,
            including in the United States. Where the law requires
            it, transfers are covered by the providers&apos; standard
            contractual clauses or an equivalent safeguard.
          </p>
        ),
      },
      {
        id: "retention",
        heading: "How long we keep it",
        body: (
          <p>
            Workspace content is kept while the workspace is active
            and for 30 days after it closes, then deleted. Billing
            records are kept for as long as tax law requires,
            typically up to seven years. Demo data stays in your
            browser until you reset the demo or clear your browser
            data.
          </p>
        ),
      },
      {
        id: "security",
        heading: "Security",
        body: (
          <p>
            Data is encrypted in transit and at rest by our hosting
            provider. Access inside a workspace is controlled by
            role, enforced on the server, and each business&apos;s
            data is kept separate from every other&apos;s. Financial
            and audit records cannot be altered from a browser.
          </p>
        ),
      },
      {
        id: "rights",
        heading: "Your rights",
        body: (
          <p>
            Depending on where you live, you may have the right to
            access, correct, delete or receive a copy of your personal
            data, to object to or restrict how it is used, and to
            complain to your data protection authority. To use these
            rights, email <Contact />. We will answer within one month.
          </p>
        ),
      },
      {
        id: "age",
        heading: "Age",
        body: (
          <p>
            {legal.product} is a business service for people aged 18
            or over.
          </p>
        ),
      },
      {
        id: "changes",
        heading: "Changes",
        body: (
          <p>
            We will post any change here and update the date at the
            top. Material changes are announced to workspace
            administrators in advance.
          </p>
        ),
      },
    ],
  };
}

const STORAGE = [
  {
    name: "Firebase Authentication",
    kind: "IndexedDB",
    purpose: "Keeps you signed in to a trial or paid workspace.",
    lasts: "Until you sign out",
  },
  {
    name: "fleetdesk.mode",
    kind: "Local storage",
    purpose: "Remembers whether this browser is using the demo or a workspace.",
    lasts: "Until cleared",
  },
  {
    name: "fleetdesk-demo",
    kind: "IndexedDB",
    purpose: "Holds everything entered in the demo, on this device only.",
    lasts: "Until you reset the demo or clear browser data",
  },
  {
    name: "fleetdesk.demo.uid",
    kind: "Local storage",
    purpose: "Remembers which demo account is signed in.",
    lasts: "Until you sign out of the demo",
  },
  {
    name: "aar:cancellations-seen:…",
    kind: "Local storage",
    purpose: "Remembers which cancelled bookings you have already seen.",
    lasts: "Until cleared",
  },
  {
    name: "fleetdesk.cookie-notice",
    kind: "Local storage",
    purpose: "Remembers that you have read the notice about this storage.",
    lasts: "Until cleared",
  },
];

export function cookiesDocument(): LegalDocument {
  const legal = legalDetails();

  return {
    title: "Cookie policy",
    intro: (
      <p>
        {legal.product} does not use advertising, tracking or
        analytics cookies. It stores a small amount of information
        in your browser because the service cannot work without it.
        This page lists all of it.
      </p>
    ),
    sections: [
      {
        id: "what",
        heading: "What is stored on your device",
        body: (
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Kept</th>
                </tr>
              </thead>
              <tbody>
                {STORAGE.map((item) => (
                  <tr key={item.name}>
                    <th scope="row">
                      <code>{item.name}</code>
                    </th>
                    <td>{item.kind}</td>
                    <td>{item.purpose}</td>
                    <td>{item.lasts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "necessary",
        heading: "Why we do not ask for consent",
        body: (
          <p>
            Everything above is strictly necessary to provide the
            service you asked for, so the law does not require
            consent for it. If we ever add anything that is not
            necessary, such as analytics, we will ask first and you
            will be able to refuse.
          </p>
        ),
      },
      {
        id: "third",
        heading: "Third parties",
        body: (
          <p>
            When you pay, you are taken to Stripe&apos;s pages, which
            set their own cookies for fraud prevention under
            Stripe&apos;s cookie policy. If bot protection is enabled
            on a workspace, Google reCAPTCHA may set cookies to tell
            people from automated traffic.
          </p>
        ),
      },
      {
        id: "control",
        heading: "Your choices",
        body: (
          <p>
            You can clear this storage at any time in your
            browser&apos;s settings. Doing so signs you out and deletes
            any demo data on that device.
          </p>
        ),
      },
    ],
  };
}

export function refundsDocument(): LegalDocument {
  return {
    title: "Refunds and cancellation",
    intro: (
      <p>
        We want you to pay only for something that works for your
        business. This is how cancelling and refunds work.
      </p>
    ),
    sections: [
      {
        id: "trial",
        heading: "The free trial",
        body: (
          <p>
            The {TRIAL_DAYS}-day trial is free and needs no card.
            There is nothing to cancel: if you do not choose a plan,
            the workspace simply closes when the trial ends.
          </p>
        ),
      },
      {
        id: "upfront",
        heading: "Upfront payments",
        body: (
          <p>
            If you are not satisfied, ask for a refund within 14 days
            of paying the upfront amount ({formatUsd(sub.upfrontCents)}{" "}
            for {sub.name}, {formatUsd(buy.upfrontCents)} for{" "}
            {buy.name}) and we will refund it in full, and close the
            workspace. After 14 days upfront payments are not
            refundable, except where the law gives you a right to one.
          </p>
        ),
      },
      {
        id: "monthly",
        heading: "Monthly fee",
        body: (
          <p>
            You can cancel the monthly fee at any time from the
            billing portal. Cancellation takes effect at the end of
            the month already paid for, and the workspace stays open
            until then. Months already started are not refunded.
          </p>
        ),
      },
      {
        id: "after",
        heading: "After you cancel",
        body: (
          <p>
            When the last paid period ends the workspace closes. You
            can ask for an export of your data for 30 days after that;
            then it is deleted. Choosing a plan again within those 30
            days reopens the workspace with everything in place.
          </p>
        ),
      },
      {
        id: "failed",
        heading: "Failed payments",
        body: (
          <p>
            If an automatic payment fails, Stripe retries it and we
            let the administrator know so the card can be updated. If
            the payment is still outstanding 14 days later we may
            close the workspace until it is paid.
          </p>
        ),
      },
      {
        id: "how",
        heading: "How to ask",
        body: (
          <p>
            Email <Contact /> from the administrator&apos;s address
            with the workspace name. Refunds go back to the original
            card and usually arrive within 5 to 10 working days.
          </p>
        ),
      },
    ],
  };
}

export function acceptableUseDocument(): LegalDocument {
  return {
    title: "Acceptable use",
    intro: (
      <p>
        {legalDetails().product} is shared infrastructure. These
        rules keep it safe and lawful for every business on it.
      </p>
    ),
    sections: [
      {
        id: "do",
        heading: "Use it lawfully",
        body: (
          <ul>
            <li>
              Collect customers&apos; personal data, licence images and
              signatures only where you are allowed to, and tell them
              how you use it.
            </li>
            <li>
              Keep the content you enter accurate and keep it only as
              long as you need it.
            </li>
            <li>
              Give each person their own account; do not share
              sign-ins.
            </li>
          </ul>
        ),
      },
      {
        id: "dont",
        heading: "Do not",
        body: (
          <ul>
            <li>
              Use the service for anything unlawful, fraudulent or
              deceptive.
            </li>
            <li>
              Upload malware, or content you have no right to store.
            </li>
            <li>
              Try to reach another business&apos;s data, get around
              roles or the trial limits, or test the service&apos;s
              security without our written permission.
            </li>
            <li>
              Overload the service with automated requests, or copy,
              resell or rent it to others.
            </li>
          </ul>
        ),
      },
      {
        id: "report",
        heading: "Reporting a problem",
        body: (
          <p>
            If you find a security issue or see the service being
            misused, email <Contact />. We investigate every report.
          </p>
        ),
      },
    ],
  };
}
