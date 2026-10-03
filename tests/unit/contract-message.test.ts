import { describe, expect, it } from "vitest";

import {
  agreementBody,
  agreementSubject,
  gmailComposeUrl,
  mailtoUrl,
} from "../../lib/contract-message";

import type { RentalAgreementView } from "../../lib/services/firestore-client";

const agreement = {
  rentalId: "rent_1",
  reservationId: "res_1",
  status: "active",
  createdAt: "2026-09-10T14:00:00.000Z",

  renter: {
    fullName: "Riley Customer",
    address: "12 Harbour Road",
    state: "Springfield",
    localAddress: null,
    dateOfBirth: "1990-04-02",
    licenceNumber: "D1234567",
    licenceCountry: "US",
    licenceExpiresAt: "2030-01-01",
    telephone: "+1 555 0100",
    email: "riley@example.test",
  },

  additionalDriver: null,

  vehicle: {
    registration: "RT-900",
    make: "Toyota",
    model: "Corolla",
    year: 2023,
    color: "Silver",
  },

  dateOut: "2026-09-10T14:00:00.000Z",
  dateIn: "2026-09-12T14:00:00.000Z",
  actualTimeIn: null,
  extraHours: 0,
  odometerOut: { value: 42000, unit: "km" },
  odometerIn: null,
  totalDistance: null,
  gasOut: "quarter",
  gasIn: null,

  waivers: {
    liabilityWaiver: true,
    windscreenWaiver: false,
    personalAccidentInsurance: false,
  },

  depositCents: 30000,

  payment: {
    method: "credit",
    referenceLast4: "4242",
    cardHolder: "Riley Customer",
  },

  charges: {
    daily: 16000,
    weekly: 0,
    monthly: 0,
    extraHours: 0,
    fuel: 0,
    detailing: 12000,
    liabilityWaiver: 0,
    windscreenWaiver: 0,
    insurance: 0,
    other: 0,
  },

  chargeTotalCents: 28000,
  specialInstructions: null,
  preparedBy: "Sam Operations",
  checkedOutBy: "Sam Operations",
  customerSignatureDataUrl: null,
  customerSignatureName: "Riley Customer",
  customerSignatureMethod: "typed",
  additionalDriverSignatureDataUrl: null,
  additionalDriverSignatureName: null,
  media: [],
} as unknown as RentalAgreementView;

describe("the agreement handed to the office's own mail account", () => {
  it("names the rental and the vehicle in the subject", () => {
    expect(agreementSubject(agreement)).toBe(
      "Rental agreement rent_1 - RT-900",
    );
  });

  it("carries the filled-in form", () => {
    const body = agreementBody(agreement);

    for (const fragment of [
      "Name: Riley Customer",
      "Registration #: RT-900",
      "KM out: 42000 km",
      "Gas out: ¼ tank",
      "Liability waiver: Yes",
      "Windscreen waiver: No",
      "Deposit: $300.00",
      "Daily: $160.00",
      "Detailing / cleaning: $120.00",
      "TOTAL: $280.00",
      "Method: Credit card",
      "Accepted by: Riley Customer",
    ]) {
      expect(body).toContain(fragment);
    }

    /* Charge rows left at zero are omitted. */
    expect(body).not.toContain("Weekly:");
  });

  it("records only the last four digits of the card", () => {
    const body = agreementBody(agreement);

    expect(body).toContain(
      "Card / check last 4: **** 4242",
    );

    expect(body).not.toContain("4242 4242");
  });

  it("points the renter at the signed copy for the terms", () => {
    expect(agreementBody(agreement)).toContain(
      "The signed copy, with the full terms and conditions, is attached.",
    );
  });

  /*
   * The message travels in a URL, so a body that outgrows one
   * would be silently truncated by the mail client. The form
   * without the clauses stays well inside what Gmail accepts.
   */
  it("stays short enough to survive a compose URL", () => {
    expect(
      gmailComposeUrl(agreement).length,
    ).toBeLessThan(8000);
  });

  it("addresses Gmail's compose window to the renter", () => {
    const url = new URL(
      gmailComposeUrl(agreement),
    );

    expect(url.origin).toBe(
      "https://mail.google.com",
    );

    expect(url.searchParams.get("view")).toBe(
      "cm",
    );

    expect(url.searchParams.get("to")).toBe(
      "riley@example.test",
    );

    expect(url.searchParams.get("su")).toBe(
      agreementSubject(agreement),
    );

    expect(url.searchParams.get("body")).toBe(
      agreementBody(agreement),
    );
  });

  it("leaves the recipient blank when the customer has no address", () => {
    const anonymous = {
      ...agreement,

      renter: {
        ...agreement.renter,
        email: null,
      },
    } as RentalAgreementView;

    expect(
      new URL(
        gmailComposeUrl(anonymous),
      ).searchParams.get("to"),
    ).toBe("");

    expect(
      mailtoUrl(anonymous).startsWith("mailto:?"),
    ).toBe(true);
  });

  it("hands the same message to a plain mail client", () => {
    const url = mailtoUrl(agreement);

    expect(url.startsWith("mailto:")).toBe(true);

    expect(url).toContain(
      "riley%40example.test",
    );

    const query = new URLSearchParams(
      url.slice(url.indexOf("?") + 1),
    );

    expect(query.get("body")).toBe(
      agreementBody(agreement),
    );
  });

  it("includes the additional renter when there is one", () => {
    const shared = {
      ...agreement,

      additionalDriver: {
        fullName: "Jordan Second",
        address: null,
        state: null,
        localAddress: null,
        dateOfBirth: null,
        licenceNumber: "D9999999",
        licenceExpiresAt: null,
        telephone: null,
      },
    } as RentalAgreementView;

    const body = agreementBody(shared);

    expect(body).toContain("ADDITIONAL RENTER");
    expect(body).toContain("Jordan Second");
    expect(body).toContain("D9999999");
  });
});
