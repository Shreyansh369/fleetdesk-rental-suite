import {
  AGREEMENT_NOTICES,
  CHARGE_ROWS,
  COMPANY,
  GAS_LEVELS,
  PAYMENT_METHODS,
} from "@/lib/agreement";

import { formatMoney } from "@/lib/presentation";

import type { RentalAgreementView } from "@/lib/services/firestore-client";

/*
 * The agreement as an email the office sends itself.
 *
 * Sending through a provider needs a domain the business owns
 * and an endpoint to keep the key on. Handing the finished
 * message to the account the office already has needs
 * neither, costs nothing, and the renter gets it from the
 * address they would reply to anyway — so this is the route
 * that works on the day it is installed.
 *
 * The body is the filled-in form. The terms are not repeated
 * in it: fourteen clauses do not survive a URL, and the copy
 * the renter signs is the printed one, which the operator
 * attaches.
 */
function moment(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function gasLabel(value: string | null): string {
  return (
    GAS_LEVELS.find(
      (level) => level.value === value,
    )?.label ?? "Not recorded"
  );
}

function paymentLabel(
  value: string | null,
): string {
  return (
    PAYMENT_METHODS.find(
      (method) => method.value === value,
    )?.label ?? "Not recorded"
  );
}

function readingLabel(
  value: { value: number; unit: string } | null,
): string {
  return value
    ? `${value.value} ${value.unit}`
    : "Not recorded";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

export function agreementSubject(
  agreement: RentalAgreementView,
): string {
  return `Rental agreement ${agreement.rentalId} - ${agreement.vehicle.registration}`;
}

export function agreementBody(
  agreement: RentalAgreementView,
): string {
  const lines = [
    COMPANY.name.toUpperCase(),
    `T ${COMPANY.telephone} | E ${COMPANY.email}`,
    COMPANY.address,
    "",
    "RENTAL AGREEMENT",
    "",
    "RENTER",
    `Name: ${agreement.renter.fullName}`,
    `Address: ${
      agreement.renter.address ?? "Not recorded"
    }`,
    `Telephone: ${
      agreement.renter.telephone ||
      "Not recorded"
    }`,
    `Local license no.: ${
      agreement.renter.licenceNumber ||
      "Not recorded"
    }`,
    `Expiration date: ${
      agreement.renter.licenceExpiresAt ??
      "Not recorded"
    }`,
  ];

  if (agreement.additionalDriver) {
    lines.push(
      "",
      "ADDITIONAL RENTER",
      `Name: ${agreement.additionalDriver.fullName}`,
      `Local license no.: ${
        agreement.additionalDriver
          .licenceNumber ?? "Not recorded"
      }`,
    );
  }

  lines.push(
    "",
    "VEHICLE",
    `Registration #: ${agreement.vehicle.registration}`,
    `Make / model: ${`${agreement.vehicle.make} ${agreement.vehicle.model}`.trim()}`,
    "",
    "RENTAL PERIOD",
    `Date out: ${moment(agreement.dateOut)}`,
    `Date in: ${moment(agreement.dateIn)}`,
    `Extra hours: ${agreement.extraHours}`,
    `KM out: ${readingLabel(
      agreement.odometerOut,
    )}`,
    `KM in: ${readingLabel(
      agreement.odometerIn,
    )}`,
    `Gas out: ${gasLabel(agreement.gasOut)}`,
    `Gas in: ${gasLabel(agreement.gasIn)}`,
    "",
    "WAIVERS AND DEPOSIT",
    `Liability waiver: ${yesNo(
      agreement.waivers.liabilityWaiver,
    )}`,
    `Windscreen waiver: ${yesNo(
      agreement.waivers.windscreenWaiver,
    )}`,
    `Personal accident insurance: ${yesNo(
      agreement.waivers
        .personalAccidentInsurance,
    )}`,
    `Deposit: ${formatMoney(
      agreement.depositCents,
    )}`,
    "",
    "CHARGES",
  );

  for (const row of CHARGE_ROWS) {
    const cents = agreement.charges[row.key];

    if (cents) {
      lines.push(
        `${row.label}: ${formatMoney(cents)}`,
      );
    }
  }

  lines.push(
    `TOTAL: ${formatMoney(
      agreement.chargeTotalCents,
    )}`,
    "",
    "PAYMENT INFORMATION",
    `Method: ${paymentLabel(
      agreement.payment.method,
    )}`,
  );

  if (agreement.payment.referenceLast4) {
    lines.push(
      `Card / check last 4: **** ${agreement.payment.referenceLast4}`,
    );
  }

  if (agreement.specialInstructions) {
    lines.push(
      "",
      "SPECIAL INSTRUCTION, ADDITIONAL INFORMATION",
      agreement.specialInstructions,
    );
  }

  lines.push(
    "",
    `${
      agreement.customerSignatureMethod ===
      "typed"
        ? "Accepted by"
        : "Signed by"
    }: ${
      agreement.customerSignatureName ||
      agreement.renter.fullName
    }`,
    `Checked out by: ${agreement.checkedOutBy}`,
    "",
    AGREEMENT_NOTICES.property,
    "",
    `${AGREEMENT_NOTICES.territory} ${AGREEMENT_NOTICES.traffic}`,
    "",
    "The signed copy, with the full terms and conditions, is attached.",
  );

  return lines.join("\n");
}

/*
 * Gmail's compose window, opened with the message already
 * written. `view=cm` is the compose view and `fs=1` makes it
 * a full window rather than a docked panel; on a phone the
 * Gmail app takes the link over from the browser.
 */
export function gmailComposeUrl(
  agreement: RentalAgreementView,
): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: agreement.renter.email ?? "",
    su: agreementSubject(agreement),
    body: agreementBody(agreement),
  });

  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** The same message, for whatever mail client is installed. */
export function mailtoUrl(
  agreement: RentalAgreementView,
): string {
  const params = new URLSearchParams({
    subject: agreementSubject(agreement),
    body: agreementBody(agreement),
  });

  return `mailto:${encodeURIComponent(
    agreement.renter.email ?? "",
  )}?${params.toString()}`;
}
