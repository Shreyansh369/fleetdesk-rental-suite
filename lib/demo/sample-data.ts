import { quoteRental } from "@/packages/domain/src/pricing";
import type { DamageMark } from "@/lib/damage";

/*
 * A fictional rental business — fleet, customers, six months of
 * history, and today's bookings, hires, payments and approvals —
 * for showing FleetDesk to a prospective operator.
 *
 * Nothing is written directly: every record is made by the same
 * workflow the screens call, signed in as the staff member it is
 * attributed to, so the data has exactly the shape the screens
 * read and stays correct when the workflows change. The host
 * decides where it lands: `pnpm demo:seed` runs it against the
 * emulators or a hosted demo project, and the in-browser demo
 * runs it against the visitor's local store.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/* ---------------------------------------------------------------
   Staff
   --------------------------------------------------------------- */

export type SampleStaff = {
  key: string;
  email: string;
  fullName: string;
  /* What the person does, shown on the demo sign-in screen. */
  title: string;
  mobile: string;
  age: number;
  role: "admin" | "operations";
  status: "approved" | "pending";
};

/*
 * The demo's sign-ins. Every account uses DEMO_PASSWORD. The two
 * administrators see everything; the operations accounts see the
 * desk work but not Finance, Staff or Billing; the new hire is
 * waiting for an administrator to approve them, which is how the
 * approval flow can be tried.
 *
 * The keys are what the sample workflows below act as.
 */
export const DEMO_PASSWORD = "Demo@1234";

export const SAMPLE_STAFF: readonly SampleStaff[] = [
  { key: "admin", email: "demo.admin@gmail.com", fullName: "Alex Morgan", title: "Owner", mobile: "+1 555 010 1001", age: 41, role: "admin", status: "approved" },
  { key: "manager", email: "demo.manager@gmail.com", fullName: "Daniel Reyes", title: "Branch manager", mobile: "+1 555 010 1006", age: 38, role: "admin", status: "approved" },
  { key: "maria", email: "demo.frontdesk@gmail.com", fullName: "Maria Lopez", title: "Front desk", mobile: "+1 555 010 1002", age: 29, role: "operations", status: "approved" },
  { key: "james", email: "demo.fleet@gmail.com", fullName: "James Carter", title: "Fleet and workshop", mobile: "+1 555 010 1003", age: 34, role: "operations", status: "approved" },
  { key: "priya", email: "demo.accounts@gmail.com", fullName: "Priya Shah", title: "Accounts", mobile: "+1 555 010 1004", age: 26, role: "operations", status: "approved" },
  { key: "hr", email: "demo.hr@gmail.com", fullName: "Hannah Brooks", title: "HR", mobile: "+1 555 010 1007", age: 31, role: "operations", status: "approved" },
  { key: "tom", email: "demo.newhire@gmail.com", fullName: "Tom Reed", title: "New hire, awaiting approval", mobile: "+1 555 010 1005", age: 22, role: "operations", status: "pending" },
];

/* The CLI seed's name for the same password. */
export const SAMPLE_PASSWORD = DEMO_PASSWORD;

export type SampleDataHost = {
  /* Runs a named workflow from lib/services/firestore-client.ts. */
  op<T>(name: string, data: unknown): Promise<T>;
  /* Creates the staff profiles and returns their uids by key. */
  createStaff(
    staff: readonly SampleStaff[],
  ): Promise<Record<string, string>>;
  /* Makes the following workflow calls act as this member. */
  signInAs(member: SampleStaff, uid: string): Promise<void>;
  /* Dates every isHistorical reservation, rental and financial
     record back to its pickup. */
  backdateHistorical(): Promise<void>;
  progress?(message: string): void;
};

export type SampleDataSummary = {
  vehicles: number;
  customers: number;
  pastRentals: number;
  expenses: number;
};

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export async function loadSampleData(
  host: SampleDataHost,
): Promise<SampleDataSummary> {
  const op = <T,>(name: string, data: unknown) =>
    host.op<T>(name, data);

  /* ---------------------------------------------------------------
     Deterministic randomness, so every seed looks the same
     --------------------------------------------------------------- */

  let seed = 20_261_003;
  function random(): number {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  }
  function pick<T>(values: readonly T[]): T {
    return values[Math.floor(random() * values.length)];
  }
  function between(low: number, high: number): number {
    return low + Math.floor(random() * (high - low + 1));
  }

  const now = Date.now();
  /* Whole hours read like times an office would actually write. */
  function at(dayOffset: number, hour: number): string {
    const date = new Date(now + dayOffset * DAY);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  }
  /* The next whole hour at least this many hours ahead. */
  function hoursAhead(hours: number): string {
    const date = new Date(now + hours * HOUR);
    date.setUTCMinutes(0, 0, 0);
    return new Date(date.valueOf() + HOUR).toISOString();
  }
  function dateOnly(dayOffset: number): string {
    return new Date(now + dayOffset * DAY).toISOString().slice(0, 10);
  }

  /* ---------------------------------------------------------------
     Staff
     --------------------------------------------------------------- */

  let uidOf: Record<string, string> = {};

  let signedInAs = "";
  async function as(key: string): Promise<void> {
    if (signedInAs === key) return;
    const member = SAMPLE_STAFF.find((entry) => entry.key === key)!;
    await host.signInAs(member, uidOf[key]);
    signedInAs = key;
  }

  const DESK_STAFF = ["maria", "james", "priya"] as const;

  /* ---------------------------------------------------------------
     Fleet
     --------------------------------------------------------------- */

  type VehicleSeed = { registration: string; make: string; model: string; year: number; color: string; vin: string; daily: number; weekly: number; monthly: number; insuranceDays?: number; serviceDueDays?: number; notes?: string };

  const VEHICLES: VehicleSeed[] = [
    { registration: "FD-1001", make: "TOYOTA", model: "Corolla", year: 2022, color: "White", vin: "2T1BURHE0NC100101", daily: 55, weekly: 330, monthly: 1150 },
    { registration: "FD-1002", make: "TOYOTA", model: "RAV4", year: 2023, color: "Silver", vin: "2T3P1RFV1PC100102", daily: 85, weekly: 510, monthly: 1800 },
    { registration: "FD-1003", make: "HONDA", model: "Civic", year: 2022, color: "Blue", vin: "2HGFE2F59NH100103", daily: 58, weekly: 345, monthly: 1200 },
    { registration: "FD-1004", make: "HONDA", model: "CR-V", year: 2023, color: "Grey", vin: "5J6RS4H48PL100104", daily: 80, weekly: 480, monthly: 1700 },
    { registration: "FD-1005", make: "SUZUKI", model: "Grand Vitara", year: 2021, color: "Green", vin: "JS3TD94V2M4100105", daily: 70, weekly: 420, monthly: 1500 },
    { registration: "FD-1006", make: "JEEP", model: "Wrangler", year: 2023, color: "Black", vin: "1C4HJXDG5PW100106", daily: 115, weekly: 690, monthly: 2400 },
    { registration: "FD-1007", make: "KIA", model: "Picanto", year: 2022, color: "Red", vin: "KNAB2512AN7100107", daily: 42, weekly: 250, monthly: 880 },
    { registration: "FD-1008", make: "KIA", model: "Sportage", year: 2023, color: "White", vin: "KNDPMCAC9P7100108", daily: 78, weekly: 465, monthly: 1650 },
    { registration: "FD-1009", make: "HYUNDAI", model: "Tucson", year: 2022, color: "Silver", vin: "KM8J3CA46NU100109", daily: 75, weekly: 450, monthly: 1600 },
    { registration: "FD-1010", make: "NISSAN", model: "Versa", year: 2021, color: "Blue", vin: "3N1CN8EV0ML100110", daily: 48, weekly: 285, monthly: 1000, insuranceDays: 12 },
    { registration: "FD-1011", make: "MITSUBISHI", model: "Outlander", year: 2021, color: "Grey", vin: "JA4J4UA86MZ100111", daily: 72, weekly: 430, monthly: 1520, serviceDueDays: -3 },
    { registration: "FD-1012", make: "FORD", model: "Ranger", year: 2022, color: "White", vin: "1FTER4FH5NL100112", daily: 95, weekly: 570, monthly: 2000, notes: "Pickup truck. Tow bar fitted." },
    { registration: "FD-1013", make: "TOYOTA", model: "Hiace", year: 2021, color: "White", vin: "JTFSX23P5M6100113", daily: 120, weekly: 720, monthly: 2500, notes: "12-seater van." },
    { registration: "FD-1014", make: "SUZUKI", model: "Swift", year: 2023, color: "Yellow", vin: "JS2ZC83S0P6100114", daily: 45, weekly: 270, monthly: 950 },
  ];

  const vehicleId: Record<string, string> = {};

  async function createFleet(): Promise<void> {
    await as("admin");
    for (const vehicle of VEHICLES) {
      const result = await op<{ vehicleId: string }>("createVehicle", {
        registrationNumber: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        vin: vehicle.vin,
        registrationExpiresAt: dateOnly(between(120, 330)),
        insuranceExpiresAt: dateOnly(vehicle.insuranceDays ?? between(90, 300)),
        lastServiceAt: dateOnly(-between(20, 80)),
        nextServiceDueAt: dateOnly(vehicle.serviceDueDays ?? between(30, 120)),
        dailyCents: vehicle.daily * 100,
        weeklyCents: vehicle.weekly * 100,
        monthlyCents: vehicle.monthly * 100,
        notes: vehicle.notes ?? null,
        photos: [],
      });
      vehicleId[vehicle.registration] = result.vehicleId;
    }
  }

  function ratesOf(registration: string) {
    const vehicle = VEHICLES.find((entry) => entry.registration === registration)!;
    return { currency: "USD" as const, dailyCents: vehicle.daily * 100, weeklyCents: vehicle.weekly * 100, monthlyCents: vehicle.monthly * 100 };
  }

  /* ---------------------------------------------------------------
     Customers — every name, number and address is invented
     --------------------------------------------------------------- */

  type CustomerSeed = { fullName: string; country: string; city: string };

  const CUSTOMERS: CustomerSeed[] = [
    { fullName: "Daniel Brooks", country: "US", city: "Austin, TX" },
    { fullName: "Sophie Turner", country: "GB", city: "Bristol" },
    { fullName: "Lucas Martin", country: "FR", city: "Lyon" },
    { fullName: "Emma Schneider", country: "DE", city: "Hamburg" },
    { fullName: "Olivia Bennett", country: "CA", city: "Toronto, ON" },
    { fullName: "Noah Williams", country: "US", city: "Denver, CO" },
    { fullName: "Isabella Rossi", country: "IT", city: "Turin" },
    { fullName: "Liam O'Connor", country: "IE", city: "Cork" },
    { fullName: "Ava Johnson", country: "US", city: "Portland, OR" },
    { fullName: "Mateo Garcia", country: "ES", city: "Valencia" },
    { fullName: "Chloe Dubois", country: "CA", city: "Montreal, QC" },
    { fullName: "Ethan Clarke", country: "AU", city: "Brisbane" },
    { fullName: "Grace Kim", country: "US", city: "Seattle, WA" },
    { fullName: "Samuel Okafor", country: "GB", city: "Leeds" },
    { fullName: "Hannah Larsen", country: "NL", city: "Utrecht" },
    { fullName: "Ryan Patel", country: "US", city: "Chicago, IL" },
    { fullName: "Mia Thompson", country: "NZ", city: "Wellington" },
    { fullName: "Jack Wilson", country: "US", city: "Miami, FL" },
  ];

  const customerIds: string[] = [];

  async function createCustomers(): Promise<void> {
    await as(pick(DESK_STAFF));
    for (const [index, customer] of CUSTOMERS.entries()) {
      await as(DESK_STAFF[index % DESK_STAFF.length]);
      const slug = customer.fullName.toLowerCase().replace(/[^a-z]+/g, ".");
      const result = await op<{ customerId: string }>("createOrUpdateCustomer", {
        fullName: customer.fullName,
        telephone: `+1 555 01${String(20 + index).padStart(2, "0")} ${String(between(1000, 9999))}`,
        email: `${slug}@example.com`,
        address: `${between(10, 980)} Sample Street, ${customer.city}`,
        dateOfBirth: `${between(1962, 2000)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`,
        licenceNumber: `${customer.country}-DEMO-${String(100_000 + index * 7_919).slice(0, 6)}`,
        licenceCountry: customer.country,
        licenceExpiresAt: dateOnly(between(200, 1_500)),
      });
      customerIds.push(result.customerId);
    }
  }

  /* ---------------------------------------------------------------
     Six months of finished rentals, and what the fleet cost to run
     --------------------------------------------------------------- */

  async function createHistory(): Promise<number> {
    await as("admin");
    let count = 0;
    for (const vehicle of VEHICLES) {
      /* Walk back from a week ago, one hire after another, so no two overlap. */
      let end = -between(6, 9);
      while (end > -180) {
        const days = pick([2, 3, 3, 4, 5, 7, 7, 10, 14]);
        const start = end - days;
        if (start < -182) break;
        const pickupAt = at(start, pick([8, 9, 10, 13, 15]));
        const returnedAt = at(end, pick([9, 11, 14, 16, 17]));
        const quote = quoteRental({ pickupAt, expectedReturnAt: returnedAt }, ratesOf(vehicle.registration));
        const extras = random() < 0.35 ? pick([1_500, 2_500, 4_000, 6_000, 15_000]) : 0;
        const owed = quote.baseRentalCents + extras;
        /* A few recent hires were never fully settled. */
        const paid = end > -40 && random() < 0.15 ? Math.round(owed * 0.5) : owed;
        await op("recordPastRental", {
          customerId: pick(customerIds),
          vehicleId: vehicleId[vehicle.registration],
          pickupAt,
          returnedAt,
          handledByUid: uidOf[pick(DESK_STAFF)],
          baseRentalCents: quote.baseRentalCents,
          additionalChargesCents: extras,
          paidCents: paid,
          paymentMethod: pick(["card", "card", "card", "cash", "bank_transfer"]),
          pickupLocation: pick(["Main office", "Main office", "Airport desk", "Ferry terminal", "Hotel delivery"]),
          dropoffLocation: pick(["Main office", "Main office", "Airport desk", "Ferry terminal"]),
          notes: extras ? pick(["Car seat added.", "Returned low on fuel.", "Extra cleaning required.", "Additional driver added."]) : null,
          idempotencyKey: newId(),
        });
        count += 1;
        end = start - between(3, 12);
      }
    }

    /*
     * A past booking is stamped with the moment it was entered,
     * and Finance counts revenue from that stamp. Entered today,
     * six months of hires would all land in this week, so each one
     * is dated back to its pickup, as if it had been booked at the
     * time.
     */
    await host.backdateHistorical();
    return count;
  }

  const EXPENSES = [
    { category: "service", vendor: "City Auto Service", note: "Scheduled service and oil change", low: 120, high: 260 },
    { category: "repair", vendor: "Precision Panel Works", note: "Bumper scuff repaired", low: 180, high: 650 },
    { category: "parts", vendor: "Parts Direct", note: "Replacement tyres", low: 240, high: 520 },
    { category: "fuel", vendor: "Harbour Fuel", note: "Refuel before handover", low: 40, high: 90 },
    { category: "cleaning", vendor: "Sparkle Valet", note: "Deep clean after sandy return", low: 60, high: 140 },
    { category: "insurance", vendor: "Coastal Insurance Co.", note: "Monthly fleet premium", low: 300, high: 450 },
    { category: "licensing", vendor: "Licensing Office", note: "Annual registration renewal", low: 90, high: 180 },
    { category: "maintenance", vendor: "City Auto Service", note: "Brake pads replaced", low: 150, high: 320 },
  ] as const;

  async function createExpenses(): Promise<number> {
    let count = 0;
    for (let day = -178; day <= -1; day += between(4, 9)) {
      const expense = pick(EXPENSES);
      await as(pick(["admin", ...DESK_STAFF]));
      await op("recordVehicleExpense", {
        vehicleId: vehicleId[pick(VEHICLES).registration],
        category: expense.category,
        amountCents: between(expense.low, expense.high) * 100,
        occurredAt: at(day, between(9, 16)),
        vendor: expense.vendor,
        note: expense.note,
        idempotencyKey: newId(),
      });
      count += 1;
    }
    return count;
  }

  /* ---------------------------------------------------------------
     Today: bookings ahead, vehicles out, one late, one just back
     --------------------------------------------------------------- */

  async function book(staff: string, registration: string, customer: number, pickupAt: string, expectedReturnAt: string, backdated: boolean, notes: string | null = null) {
    await as(staff);
    const result = await op<{ reservationId: string }>("createReservation", {
      customerId: customerIds[customer],
      vehicleId: vehicleId[registration],
      pickupAt,
      expectedReturnAt,
      pickupLocation: pick(["Main office", "Airport desk", "Ferry terminal"]),
      dropoffLocation: "Main office",
      notes,
      bookingMedia: [],
      backdated,
    });
    return { reservationId: result.reservationId, registration, customer, pickupAt, expectedReturnAt };
  }

  function mark(view: DamageMark["view"], x: number, y: number, kind: DamageMark["kind"], note: string): DamageMark {
    return { id: newId(), view, x, y, kind, note, notedAt: new Date(now).toISOString() } as DamageMark;
  }

  async function checkout(staff: string, booking: Awaited<ReturnType<typeof book>>, options: { paidNow: number; insurance?: number; carSeat?: number; damage?: DamageMark[]; method?: string }) {
    await as(staff);
    const quote = quoteRental({ pickupAt: booking.pickupAt, expectedReturnAt: booking.expectedReturnAt }, ratesOf(booking.registration));
    const rates = ratesOf(booking.registration);
    const charges = {
      daily: quote.dailyUnits * rates.dailyCents,
      weekly: quote.weeklyUnits * rates.weeklyCents,
      monthly: quote.monthlyUnits * rates.monthlyCents,
      insurance: options.insurance ?? 0,
      carSeat: options.carSeat ?? 0,
      other: 0,
    };
    const owed = quote.baseRentalCents + charges.insurance + charges.carSeat;
    const result = await op<{ rentalId: string; outstandingCents: number }>("checkoutReservation", {
      reservationId: booking.reservationId,
      pickupFuelLevel: "full",
      pickupOdometer: { value: between(8_000, 62_000), unit: "km" },
      notes: null,
      checkoutMedia: [],
      customerSignatureDataUrl: null,
      customerSignatureName: CUSTOMERS[booking.customer].fullName,
      additionalDriver: null,
      waivers: {},
      depositCents: 25_000,
      paymentMethod: options.method ?? "credit",
      paymentReferenceLast4: options.method === "cash" ? null : String(between(1000, 9999)),
      paymentCardHolder: options.method === "cash" ? null : CUSTOMERS[booking.customer].fullName,
      charges,
      specialInstructions: null,
      extraHours: 0,
      damageMarks: options.damage ?? [],
      discount: null,
      paidNowCents: Math.min(options.paidNow, owed),
    });
    return result.rentalId;
  }

  async function createLiveActivity(): Promise<void> {
    /* Upcoming bookings, the first a couple of hours from now. */
    await book("maria", "FD-1001", 0, hoursAhead(2), hoursAhead(74), false, "Arriving on the evening ferry.");
    await book("james", "FD-1004", 1, at(1, 10), at(6, 10), false, "Needs a child seat.");
    await book("priya", "FD-1006", 2, at(2, 9), at(9, 9), false, null);
    await book("maria", "FD-1012", 3, at(4, 14), at(7, 14), false, null);
    await book("james", "FD-1013", 4, at(8, 8), at(15, 8), false, "Group of 10 — airport pickup.");

    /* Two cancelled bookings, each with its reason. */
    const cancelA = await book("priya", "FD-1007", 5, at(3, 11), at(5, 11), false);
    await as("priya");
    await op("cancelReservation", { reservationId: cancelA.reservationId, reason: "Customer's flight was cancelled." });
    const cancelB = await book("maria", "FD-1007", 6, at(10, 9), at(12, 9), false);
    await as("admin");
    await op("cancelReservation", { reservationId: cancelB.reservationId, reason: "Customer booked twice by mistake." });

    /* Vehicles out on hire right now, booked when they went out. */
    const outA = await book("maria", "FD-1002", 7, at(-3, 9), at(2, 9), true);
    const rentalA = await checkout("maria", outA, { paidNow: 20_000, insurance: 4_500, damage: [mark("left", 0.32, 0.55, "scratch", "Light scratch on rear door"), mark("front", 0.7, 0.62, "chip", "Stone chip on bumper")] });

    const outB = await book("james", "FD-1003", 8, at(-2, 10), at(5, 10), true);
    const rentalB = await checkout("james", outB, { paidNow: 999_999, carSeat: 3_000 });

    const outC = await book("priya", "FD-1008", 9, at(-1, 14), at(1, 14), true);
    const rentalC = await checkout("priya", outC, { paidNow: 0, method: "cash" });

    const outD = await book("maria", "FD-1009", 10, at(-12, 9), at(16, 9), true, "Monthly hire for a work contract.");
    const rentalD = await checkout("maria", outD, { paidNow: 50_000, damage: [mark("back", 0.5, 0.4, "dent", "Small dent on tailgate")] });

    /* Late: due back yesterday and not returned. */
    const late = await book("james", "FD-1014", 11, at(-5, 9), at(-1, 9), true);
    await checkout("james", late, { paidNow: 999_999 });

    /* Back today, with fuel and cleaning to settle. */
    const back = await book("priya", "FD-1005", 12, at(-4, 9), at(0, 9), true);
    const backRental = await checkout("priya", back, { paidNow: 999_999 });
    await as("priya");
    await op("returnRental", {
      rentalId: backRental,
      actualReturnAt: new Date(now - HOUR).toISOString(),
      returnFuelLevel: "half",
      returnOdometer: { value: 70_000, unit: "km" },
      adjustments: [
        { type: "fuel", amountCents: 5_000, note: "Returned at half a tank" },
        { type: "cleaning", amountCents: 15_000, note: "Sand throughout the interior" },
      ],
      waivers: {},
      extraHours: 0,
      notes: "Customer will settle the balance by card tomorrow.",
      returnMedia: [],
    });

    /* Payments taken against vehicles that are out. */
    await as("james");
    await op("recordRentalPayment", { rentalId: rentalA, amountCents: 15_000, method: "card", externalReference: null, idempotencyKey: newId() });
    await as("maria");
    await op("recordRentalPayment", { rentalId: rentalD, amountCents: 40_000, method: "bank_transfer", externalReference: "TRF-20418", idempotencyKey: newId() });

    /* A discount an employee offered, waiting for an administrator. */
    await as("priya");
    await op("requestRentalDiscount", { rentalId: rentalC, amountCents: 2_000, reason: "Returning customer — loyalty discount.", idempotencyKey: newId() });

    /* Agreements: one approved, one waiting for review. */
    await as("maria");
    await op("submitContractForReview", { reservationId: outA.reservationId, rentalId: rentalA });
    await as("james");
    await op("submitContractForReview", { reservationId: outB.reservationId, rentalId: rentalB });
    await as("admin");
    await op("reviewContract", { reservationId: outA.reservationId, decision: "approve", note: null });

    /* One vehicle in the workshop. */
    await op("changeVehicleStatus", { vehicleId: vehicleId["FD-1011"], status: "maintenance", note: "Service overdue — booked in at City Auto Service." });

  }

  uidOf = await host.createStaff(SAMPLE_STAFF);
  await createFleet();
  host.progress?.(`${VEHICLES.length} vehicles`);
  await createCustomers();
  host.progress?.(`${CUSTOMERS.length} customers`);
  const pastRentals = await createHistory();
  host.progress?.(`${pastRentals} past rentals over six months`);
  const expenses = await createExpenses();
  host.progress?.(`${expenses} expenses`);
  await createLiveActivity();
  host.progress?.(
    "today's bookings, rentals out, a late return, payments, a discount request and agreements",
  );

  return {
    vehicles: VEHICLES.length,
    customers: CUSTOMERS.length,
    pastRentals,
    expenses,
  };
}
