import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { db } from "./firebase";

const MAX_LEDGER_ROWS = 2_000;
const MAX_OUTSTANDING_ROWS = 2_000;

function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function financialOverview(input: { from: string; to: string }) {
  const from = dayStart(input.from);
  const toExclusive = dayStart(input.to);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  if (toExclusive.getTime() - from.getTime() > 366 * 86_400_000) throw new HttpsError("invalid-argument", "Reports are limited to a 366-day period.");
  const [ledgerSnapshot, outstandingSnapshot] = await Promise.all([
    db.collection("financialLedger").where("occurredAt", ">=", Timestamp.fromDate(from)).where("occurredAt", "<", Timestamp.fromDate(toExclusive)).orderBy("occurredAt", "desc").limit(MAX_LEDGER_ROWS).get(),
    db.collection("rentalFinancials").where("outstandingCents", ">", 0).limit(MAX_OUTSTANDING_ROWS).get(),
  ]);
  if (ledgerSnapshot.size === MAX_LEDGER_ROWS || outstandingSnapshot.size === MAX_OUTSTANDING_ROWS) throw new HttpsError("resource-exhausted", "The selected report is too large. Choose a shorter date range.");
  let invoicedCents = 0;
  let receivedCents = 0;
  let refundedCents = 0;
  let expensesCents = 0;
  const byVehicle = new Map<string, { vehicleId: string; vehicleRegistration: string; invoicedCents: number; expensesCents: number; receivedCents: number }>();
  for (const entry of ledgerSnapshot.docs) {
    const data = entry.data();
    const amount = data.amountCents as number;
    const type = data.entryType as string;
    if (["rental_charge", "rental_extension", "rental_adjustment", "rental_discount"].includes(type)) invoicedCents += amount;
    if (type === "payment") receivedCents += amount;
    if (type === "refund") refundedCents += Math.abs(amount);
    if (type === "expense") expensesCents += Math.abs(amount);
    const vehicleId = data.vehicleId as string | undefined;
    if (vehicleId) {
      const current = byVehicle.get(vehicleId) ?? { vehicleId, vehicleRegistration: data.vehicleRegistration ?? "Vehicle", invoicedCents: 0, expensesCents: 0, receivedCents: 0 };
      if (["rental_charge", "rental_extension", "rental_adjustment", "rental_discount"].includes(type)) current.invoicedCents += amount;
      if (type === "expense") current.expensesCents += Math.abs(amount);
      if (type === "payment") current.receivedCents += amount;
      byVehicle.set(vehicleId, current);
    }
  }
  const outstandingCents = outstandingSnapshot.docs.reduce((sum, document) => sum + (document.get("outstandingCents") as number), 0);
  return {
    from: input.from,
    to: input.to,
    invoicedCents,
    receivedCents,
    refundedCents,
    expensesCents,
    netCashCents: receivedCents - refundedCents - expensesCents,
    operatingMarginCents: invoicedCents - expensesCents,
    outstandingCents,
    outstandingRentals: outstandingSnapshot.size,
    vehiclePerformance: [...byVehicle.values()].map((vehicle) => ({ ...vehicle, operatingMarginCents: vehicle.invoicedCents - vehicle.expensesCents })).sort((a, b) => b.operatingMarginCents - a.operatingMarginCents).slice(0, 10),
    recentEntries: ledgerSnapshot.docs.slice(0, 8).map((document) => ({ id: document.id, entryType: document.get("entryType"), vehicleRegistration: document.get("vehicleRegistration") ?? "—", amountCents: document.get("amountCents"), occurredAt: (document.get("occurredAt") as Timestamp).toDate().toISOString() })),
  };
}
