import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";

import { db } from "./firebase";
import { audit } from "./audit";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: () => Date }).toDate;

    if (typeof toDate === "function") {
      return toDate().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
  }

  const parsed = new Date(String(value ?? ""));

  return Number.isNaN(parsed.valueOf())
    ? "—"
    : parsed.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function buildRentalAgreementHtml(input: {
  reservationId: string;
  customerName: string;
  telephone: string;
  email: string | null;
  vehicleRegistration: string;
  pickupAt: unknown;
  expectedReturnAt: unknown;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  quote: {
    baseRentalCents: number;
    chargedDays: number;
  };
  signatureDataUrl?: string | null;
}): string {
  const signature = input.signatureDataUrl
    ? `<img
        src="${escapeHtml(input.signatureDataUrl)}"
        alt="Customer signature"
        style="max-width:360px;max-height:140px;display:block;border-bottom:1px solid #d1d5db;"
      />`
    : `<span>Signature recorded on booking device.</span>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />
  <title>
    Sample Rental Agreement ${escapeHtml(input.reservationId)}
  </title>

  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.6;
      margin: 0;
      padding: 40px;
    }

    .document {
      max-width: 900px;
      margin: 0 auto;
    }

    .sample-banner {
      background: #fff7ed;
      border: 1px solid #fdba74;
      color: #9a3412;
      padding: 12px 16px;
      margin-bottom: 24px;
      border-radius: 6px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.2px;
    }

    .header {
      border-bottom: 2px solid #111827;
      padding-bottom: 18px;
      margin-bottom: 26px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
    }

    h2 {
      margin-top: 30px;
      margin-bottom: 12px;
      font-size: 19px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
    }

    h3 {
      margin-top: 20px;
      margin-bottom: 8px;
      font-size: 15px;
    }

    p {
      margin: 8px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    td {
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }

    td:first-child {
      width: 32%;
      font-weight: 700;
      padding-right: 18px;
    }

    ol {
      padding-left: 22px;
    }

    li {
      margin-bottom: 10px;
    }

    .amount {
      font-size: 18px;
      font-weight: 700;
    }

    .signature {
      margin-top: 40px;
    }

    .signature-box {
      margin-top: 20px;
      min-height: 90px;
      border-bottom: 1px solid #111827;
      display: flex;
      align-items: flex-end;
      padding-bottom: 8px;
    }

    .signature-label {
      margin-top: 8px;
      font-size: 12px;
      color: #6b7280;
    }

    .small {
      color: #6b7280;
      font-size: 12px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #d1d5db;
      color: #6b7280;
      font-size: 12px;
    }

    .acknowledgement {
      margin-top: 24px;
      padding: 16px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #f9fafb;
    }

    @media print {
      body {
        padding: 20px;
      }

      .sample-banner {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>

<body>
  <div class="document">

    <div class="sample-banner">
      SAMPLE CONTRACT — DRAFT FOR CLIENT REVIEW
    </div>

    <div class="header">
      <h1>Demo Car Rentals</h1>
      <div class="small">
        Vehicle Rental Agreement
      </div>
      <div class="small">
        Sample USVI Rental Agreement
      </div>
    </div>

    <h2>1. Reservation Details</h2>

    <table>
      <tr>
        <td>Reservation ID</td>
        <td>${escapeHtml(input.reservationId)}</td>
      </tr>

      <tr>
        <td>Customer</td>
        <td>${escapeHtml(input.customerName)}</td>
      </tr>

      <tr>
        <td>Telephone</td>
        <td>${escapeHtml(input.telephone || "Not provided")}</td>
      </tr>

      <tr>
        <td>Email</td>
        <td>${escapeHtml(input.email ?? "Not provided")}</td>
      </tr>

      <tr>
        <td>Vehicle</td>
        <td>${escapeHtml(input.vehicleRegistration || "Not specified")}</td>
      </tr>

      <tr>
        <td>Pickup</td>
        <td>${escapeHtml(formatDate(input.pickupAt))}</td>
      </tr>

      <tr>
        <td>Expected Return</td>
        <td>${escapeHtml(formatDate(input.expectedReturnAt))}</td>
      </tr>

      <tr>
        <td>Pickup Location</td>
        <td>
          ${escapeHtml(input.pickupLocation ?? "Not specified")}
        </td>
      </tr>

      <tr>
        <td>Drop-off Location</td>
        <td>
          ${escapeHtml(input.dropoffLocation ?? "Not specified")}
        </td>
      </tr>

      <tr>
        <td>Rental Period</td>
        <td>${input.quote.chargedDays} day(s)</td>
      </tr>

      <tr>
        <td>Base Rental Amount</td>
        <td class="amount">
          ${money(input.quote.baseRentalCents)}
        </td>
      </tr>
    </table>

    <p class="small">
      This sample document records the reservation information currently
      captured by Demo Car Rentals. Final contractual wording,
      policies, fees, insurance provisions, cancellation terms, deposit
      requirements, age requirements, driver requirements, and other
      business-specific conditions must be reviewed and approved before
      production use.
    </p>

    <h2>2. Rental Terms and Conditions</h2>

    <ol>
      <li>
        The customer confirms that the information provided for the rental
        reservation is accurate and complete.
      </li>

      <li>
        The renter must provide a valid driver's license and any other
        identification or documentation required by Demo Car Rentals.
      </li>

      <li>
        Only authorized drivers may operate the rental vehicle.
      </li>

      <li>
        The rental vehicle must be operated responsibly, lawfully, and in
        accordance with applicable traffic and safety requirements.
      </li>

      <li>
        The vehicle must be returned on or before the agreed return time
        unless an extension has been approved by Demo Car Rentals.
      </li>

      <li>
        Additional charges may apply for late return, refueling,
        cleaning/detailing, smoking, damage, optional equipment,
        insurance products, services, or other charges applicable to the
        rental.
      </li>

      <li>
        The renter is responsible for applicable traffic violations,
        parking violations, tolls, and other charges resulting from the
        use of the vehicle, subject to the final approved rental terms.
      </li>

      <li>
        Accidents, vehicle damage, theft, mechanical problems, or other
        incidents involving the rental vehicle must be reported to Demo Car
        Rentals promptly.
      </li>

      <li>
        The rental vehicle may not be used for prohibited activities or
        purposes specified by the final approved rental policy.
      </li>

      <li>
        Demo Car Rentals may require additional authorization,
        identification, payment verification, deposit information, or
        insurance documentation before releasing the vehicle.
      </li>
    </ol>

    <h2>3. Charges</h2>

    <table>
      <tr>
        <td>Base Rental</td>
        <td>${money(input.quote.baseRentalCents)}</td>
      </tr>

      <tr>
        <td>Additional Charges</td>
        <td>To be determined from the finalized rental account.</td>
      </tr>

      <tr>
        <td>Total</td>
        <td>
          To be determined from the finalized rental account.
        </td>
      </tr>
    </table>

    <p class="small">
      Additional charges may include applicable taxes, fees, optional
      equipment, insurance, fuel/refueling, cleaning/detailing, smoking
      fees, late-return charges, damage-related charges, or other approved
      rental charges.
    </p>

    <h2>4. Vehicle Condition and Return</h2>

    <p>
      The renter acknowledges that the vehicle should be inspected at
      pickup and that any existing damage or condition issues should be
      reported before or at the beginning of the rental period.
    </p>

    <p>
      The vehicle must be returned in the condition required by the final
      approved rental agreement, subject to normal wear and any documented
      pre-existing condition.
    </p>

    <h2>5. Fuel and Mileage</h2>

    <p>
      The vehicle's fuel level and mileage/odometer reading may be recorded
      at pickup and return. Any fuel, mileage, or related charges will be
      determined according to the final approved rental policy.
    </p>

    <h2>6. Insurance and Responsibility</h2>

    <p>
      Applicable insurance coverage, renter responsibility, deductibles,
      exclusions, and liability provisions will be defined by the final
      approved rental agreement and applicable business policies.
    </p>

    <h2>7. Electronic Acceptance</h2>

    <div class="acknowledgement">
      <p>
        The renter acknowledges that they have reviewed the reservation
        information provided in this document and agree to the applicable
        rental terms and conditions presented by Demo Car Rentals,
        subject to the final approved contract and company policies.
      </p>
    </div>

    <div class="signature">
      <h2>8. Customer Signature</h2>

      <div class="signature-box">
        ${signature}
      </div>

      <div class="signature-label">
        Customer / Renter Signature
      </div>

      <table style="margin-top:24px;">
        <tr>
          <td>Customer Name</td>
          <td>${escapeHtml(input.customerName)}</td>
        </tr>

        <tr>
          <td>Date</td>
          <td>${escapeHtml(formatDate(new Date()))}</td>
        </tr>
      </table>
    </div>

    <div class="footer">
      <strong>IMPORTANT:</strong>
      This is a sample/draft contract prepared for client review.
      It is not the final approved legal agreement.

      <br /><br />

      Final production wording must be reviewed and approved by the
      rental business. Business-specific terms may include, but are not
      limited to, cancellation policy, deposit requirements, age
      restrictions, additional-driver requirements, insurance options,
      damage responsibility, roadside assistance, geographic restrictions,
      fuel policy, mileage limits, late-return fees, cleaning fees,
      smoking fees, refueling fees, and other applicable rental rules.
    </div>

  </div>
</body>
</html>`;
}

export async function sendReservationContractEmail(input: {
  reservationId: string;
  actorUid: string;
  resendApiKey: string;
  fromEmail: string;
  signatureDataUrl: string | null;
}): Promise<{ emailId: string }> {
  const reservationRef = db
    .collection("reservations")
    .doc(input.reservationId);

  const reservation = await reservationRef.get();

  if (!reservation.exists) {
    throw new HttpsError("not-found", "Reservation was not found.");
  }

  const data = reservation.data()!;

  const customerId = String(data.customerId ?? "");

  if (!customerId) {
    throw new HttpsError(
      "failed-precondition",
      "Reservation has no customer.",
    );
  }

  const customer = await db
    .collection("customers")
    .doc(customerId)
    .get();

  if (!customer.exists) {
    throw new HttpsError("not-found", "Customer was not found.");
  }

  const email = String(customer.get("email") ?? "").trim();

  if (!email) {
    throw new HttpsError(
      "failed-precondition",
      "Customer does not have an email address.",
    );
  }

  const existingSignaturePath =
    data.customerSignatureStoragePath ?? null;

  const signaturePath =
    typeof existingSignaturePath === "string"
      ? existingSignaturePath
      : null;

  let resolvedSignatureDataUrl = input.signatureDataUrl;

  if (!resolvedSignatureDataUrl && signaturePath) {
    const [bytes] = await getStorage()
      .bucket()
      .file(signaturePath)
      .download();

    resolvedSignatureDataUrl =
      `data:image/png;base64,${bytes.toString("base64")}`;
  }

  const html = buildRentalAgreementHtml({
    reservationId: input.reservationId,
    customerName: String(
      customer.get("fullName") ?? "Customer",
    ),
    telephone: String(
      customer.get("telephone") ?? "",
    ),
    email,
    vehicleRegistration: String(
      data.vehicleRegistrationSnapshot ?? "",
    ),
    pickupAt: data.pickupAt,
    expectedReturnAt: data.expectedReturnAt,
    pickupLocation: data.pickupLocation ?? null,
    dropoffLocation: data.dropoffLocation ?? null,
    quote: {
      baseRentalCents: Number(
        data.quote?.baseRentalCents ?? 0,
      ),
      chargedDays: Number(
        data.quote?.chargedDays ?? 0,
      ),
    },
    signatureDataUrl: resolvedSignatureDataUrl,
  });

  const payload = {
    from: input.fromEmail,
    to: [email],
    subject:
      `Demo Car Rentals — Reservation ${input.reservationId}`,

    html,

    attachments: [
      {
        filename:
          `rental-agreement-${input.reservationId}.html`,
        content: Buffer.from(html, "utf8").toString("base64"),
      },
    ],

    tags: [
      {
        name: "category",
        value: "rental_agreement",
      },
      {
        name: "reservation_id",
        value: input.reservationId,
      },
    ],
  };

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          `Bearer ${input.resendApiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const responseData = (await response.json()) as {
    id?: string;
    message?: string;
  };

  if (!response.ok || !responseData.id) {
    throw new HttpsError(
      "internal",
      responseData.message ||
        "The contract email could not be sent.",
    );
  }

  await reservationRef.update({
    contractEmailSentAt:
      FieldValue.serverTimestamp(),

    contractEmailId:
      responseData.id,

    contractEmailAddressSnapshot:
      email,

    updatedAt:
      FieldValue.serverTimestamp(),

    updatedBy:
      input.actorUid,
  });

  await db.runTransaction(async (transaction) => {
    audit(
      transaction,
      input.actorUid,
      "reservation.contract.email.sent",
      {
        collection: "reservations",
        id: input.reservationId,
      },
      {
        emailId: responseData.id,
      },
    );
  });

  return {
    emailId: responseData.id,
  };
}