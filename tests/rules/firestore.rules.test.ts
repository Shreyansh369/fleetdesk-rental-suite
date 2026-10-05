import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection as rootCollection,
  doc as rootDoc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

import { scopedSegments } from "../../lib/data/firestore";

/*
 * Roles are resolved from workspaces/{id}/users/{uid} rather
 * than from custom claims: the workspace has no Admin SDK to mint
 * claims with, so a staff profile is what these tests have to
 * seed.
 *
 * The single-workspace policy below runs inside one paid
 * workspace, addressed exactly as the application addresses it:
 * a path such as ("vehicles", id) is placed under
 * workspaces/{WORKSPACE}/ by the same scoping the client uses.
 * The multi-workspace policy — trials, invites, expiry and
 * isolation — follows it and addresses paths in full.
 */
let testEnv: RulesTestEnvironment;

const WORKSPACE = "ws-main";

function doc(db: Firestore, ...segments: string[]) {
  const [first, ...rest] = scopedSegments(segments, WORKSPACE);
  return rootDoc(db, first, ...rest);
}

function collection(db: Firestore, ...segments: string[]) {
  const [first, ...rest] = scopedSegments(segments, WORKSPACE);
  return rootCollection(db, first, ...rest);
}

const ADMIN = "admin-user";
const OPS = "ops-user";
const PENDING = "pending-user";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "fleetdesk-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;

    await setDoc(rootDoc(db, "workspaces", WORKSPACE), {
      name: "Main Rentals",
      ownerUid: ADMIN,
      adminEmail: "admin@example.test",
      plan: "paid",
      trialStartedAt: new Date(Date.now() - 40 * 86_400_000),
      paidAt: new Date(Date.now() - 30 * 86_400_000),
    });

    for (const uid of [ADMIN, OPS, PENDING, "removable-user"]) {
      await setDoc(rootDoc(db, "accounts", uid), {
        workspaceId: WORKSPACE,
        email: `${uid}@example.test`,
      });
    }

    await setDoc(doc(db, "users", ADMIN), {
      email: "admin@example.test",
      role: "admin",
      status: "approved",
      requestedRole: "admin",
    });

    await setDoc(doc(db, "users", OPS), {
      email: "ops@example.test",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(db, "users", PENDING), {
      email: "pending@example.test",
      role: null,
      status: "pending",
      requestedRole: "operations",
    });

    /* A disposable profile for the deletion test, so removing
       it cannot pull the ground from under the accounts the
       rest of these tests sign in as. */
    await setDoc(doc(db, "users", "removable-user"), {
      email: "removable@example.test",
      fullName: "Removable Account",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(db, "vehicles", "vehicle_001"), { registrationNumber: "RT-001" });
    await setDoc(doc(db, "customers", "customer_001"), { fullName: "Sample Customer" });
    await setDoc(doc(db, "rentalFinancials", "rental_001"), { totalCents: 10000 });
    await setDoc(doc(db, "vehicleExpenses", "expense_001"), {
      amountCents: 5000,
      recordedBy: ADMIN,
    });

    await setDoc(doc(db, "vehicleExpenses", "expense_ops"), {
      amountCents: 2500,
      recordedBy: OPS,
    });
    await setDoc(doc(db, "financialLedger", "entry_001"), { amountCents: 5000 });
    await setDoc(doc(db, "auditLogs", "audit_001"), { action: "vehicle.created" });
    await setDoc(doc(db, "idempotencyKeys", "payment_001"), { response: { outstandingCents: 0 } });
    await setDoc(doc(db, "vehicleRegistry", "reg_RT-001"), { vehicleId: "vehicle_001", value: "RT-001" });
    await setDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001"), { extensionCents: 1000 });

    await setDoc(doc(db, "reservationContracts", "contract_review"), {
      status: "in_review",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_rejected"), {
      status: "rejected",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_approved"), {
      status: "approved",
      version: 1,
      approvedVersion: 1,
    });

    await setDoc(
      doc(db, "reservationContracts", "contract_approved", "versions", "v1"),
      { reservationId: "contract_approved", version: 1, baseRentalCents: 16000 },
    );

    await setDoc(
      doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      { status: "sent", providerMessageId: "msg_001", contractVersion: 1 },
    );

    await setDoc(doc(db, "reservationContracts", "contract_admin_review"), {
      status: "in_review",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_ops_review"), {
      status: "in_review",
      version: 1,
    });

    await setDoc(doc(db, "rentalDiscounts", "discount_pending"), {
      rentalId: "rental_001",
      amountCents: 2500,
      status: "pending",
      requestedBy: OPS,
    });

    await setDoc(doc(db, "rentalDiscounts", "discount_decided"), {
      rentalId: "rental_001",
      amountCents: 1000,
      status: "rejected",
      requestedBy: OPS,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function asUser(uid: string, email?: string): Firestore {
  return testEnv
    .authenticatedContext(uid, email ? { email } : undefined)
    .firestore() as unknown as Firestore;
}

describe("Firestore access policy", () => {
  it("denies unauthenticated access to every collection", async () => {
    const db = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

    await assertFails(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(getDoc(doc(db, "customers", "customer_001")));
    await assertFails(setDoc(doc(db, "vehicles", "vehicle_002"), { registrationNumber: "RT-002" }));
  });

  it("denies an account that has not been approved", async () => {
    const db = asUser(PENDING);

    await assertFails(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(setDoc(doc(db, "customers", "customer_002"), { fullName: "Blocked" }));
  });

  it("lets approved staff run the operational workflows from the browser", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertSucceeds(setDoc(doc(db, "vehicles", "vehicle_002"), { registrationNumber: "RT-002" }));
    await assertSucceeds(setDoc(doc(db, "customers", "customer_002"), { fullName: "New Customer" }));
    await assertSucceeds(setDoc(doc(db, "reservations", "reservation_001"), { status: "confirmed" }));
    await assertSucceeds(setDoc(doc(db, "rentals", "rental_001"), { status: "active" }));
  });

  it("only cancels a booking that says why", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "reservations", "reservation_cancel"), { status: "confirmed" }));
    await assertFails(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: null,
      }),
    );
    await assertFails(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: "   ",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: "Customer changed their travel dates",
      }),
    );
  });

  it("keeps profit reporting away from operations staff", async () => {
    const db = asUser(OPS);

    await assertFails(getDoc(doc(db, "vehicleExpenses", "expense_001")));
    await assertFails(getDoc(doc(db, "financialLedger", "entry_001")));
    await assertFails(getDoc(doc(db, "auditLogs", "audit_001")));
    await assertFails(getDoc(doc(db, "refunds", "refund_001")));
  });

  /*
   * Recording what the fleet costs to run is operational
   * work, so an operations account may add an expense and
   * read back its own. Everybody else's entries — and so the
   * cost side of the business — stay with an administrator,
   * which is why the unfiltered listing is refused and the
   * filtered one is not.
   */
  it("lets operations record an expense and read back only its own", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "vehicleExpenses", "expense_ops_2"), {
        amountCents: 1500,
        recordedBy: OPS,
      }),
    );

    await assertSucceeds(
      getDoc(doc(db, "vehicleExpenses", "expense_ops")),
    );

    await assertFails(
      getDoc(doc(db, "vehicleExpenses", "expense_001")),
    );

    await assertSucceeds(
      getDocs(
        query(
          collection(db, "vehicleExpenses"),
          where("recordedBy", "==", OPS),
          limit(50),
        ),
      ),
    );

    await assertFails(
      getDocs(
        query(collection(db, "vehicleExpenses"), limit(50)),
      ),
    );
  });

  it("stops an expense being attributed to somebody else", async () => {
    const db = asUser(OPS);

    await assertFails(
      setDoc(doc(db, "vehicleExpenses", "expense_forged"), {
        amountCents: 1500,
        recordedBy: ADMIN,
      }),
    );
  });

  it("keeps an expense unrewritable once it is recorded", async () => {
    const db = asUser(OPS);

    await assertFails(
      updateDoc(doc(db, "vehicleExpenses", "expense_ops"), {
        amountCents: 1,
      }),
    );

    await assertFails(
      deleteDoc(doc(db, "vehicleExpenses", "expense_ops")),
    );
  });

  /*
   * Correcting a staff member's name is an administrator's
   * write to somebody else's profile, which no operations
   * account may make. An account may still fix its own
   * registration details, and neither may reach for a role.
   */
  it("lets only an administrator edit another staff profile", async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(ADMIN), "users", OPS), {
        fullName: "Corrected Name",
        mobile: "5550000000",
        age: 31,
      }),
    );

    await assertFails(
      updateDoc(doc(asUser(OPS), "users", PENDING), {
        fullName: "Not mine to change",
      }),
    );
  });

  /*
   * Removing the profile is what removes the access: the
   * rules read role and status from it. It is therefore an
   * administrator's decision and nobody else's.
   */
  it("lets only an administrator remove a staff profile", async () => {
    await assertFails(
      deleteDoc(
        doc(asUser(OPS), "users", "removable-user"),
      ),
    );

    await assertSucceeds(
      deleteDoc(
        doc(asUser(ADMIN), "users", "removable-user"),
      ),
    );
  });

  it("stops an account granting itself a role while editing its own details", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      updateDoc(doc(db, "users", OPS), {
        fullName: "Own Name",
        mobile: "5551111111",
      }),
    );

    await assertFails(
      updateDoc(doc(db, "users", OPS), {
        role: "admin",
      }),
    );
  });

  /*
   * A past booking is written as a closed rental with its
   * financial record and an append-only ledger entry, so
   * every document it touches has to be writable by the
   * account entering it.
   */
  it("lets staff enter a historical rental record", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "rentals", "rental_history_001"), {
        status: "returned",
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "rentalFinancials", "rental_history_001"), {
        totalCents: 20000,
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "payments", "payment_history_001"), {
        amountCents: 20000,
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "idempotencyKeys", "past_rental_001"), {
        response: { rentalId: "rental_history_001" },
      }),
    );
  });

  it("keeps the ledger and audit trail append-only for operations staff", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "financialLedger", "entry_002"), { amountCents: 100 }));
    await assertFails(updateDoc(doc(db, "financialLedger", "entry_001"), { amountCents: 1 }));
    await assertFails(deleteDoc(doc(db, "financialLedger", "entry_001")));
    await assertFails(updateDoc(doc(db, "auditLogs", "audit_001"), { action: "tampered" }));
    await assertFails(deleteDoc(doc(db, "auditLogs", "audit_001")));
  });

  it("stops an idempotency record being cleared so a payment could be replayed", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "idempotencyKeys", "payment_002"), { response: {} }));
    await assertFails(deleteDoc(doc(db, "idempotencyKeys", "payment_001")));
    await assertFails(updateDoc(doc(db, "idempotencyKeys", "payment_001"), { response: {} }));
  });

  it("stops staff deleting operational records", async () => {
    const db = asUser(OPS);

    await assertFails(deleteDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(deleteDoc(doc(db, "customers", "customer_001")));
    await assertFails(deleteDoc(doc(db, "rentals", "rental_001")));
  });

  it("lets staff claim and release a vehicle uniqueness key", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "vehicleRegistry", "reg_RT-001")));
    await assertSucceeds(setDoc(doc(db, "vehicleRegistry", "reg_RT-002"), { vehicleId: "vehicle_002", value: "RT-002" }));
    await assertSucceeds(deleteDoc(doc(db, "vehicleRegistry", "reg_RT-002")));
  });

  it("keeps vehicle uniqueness keys away from an unapproved account", async () => {
    const db = asUser(PENDING);

    await assertFails(getDoc(doc(db, "vehicleRegistry", "reg_RT-001")));
    await assertFails(setDoc(doc(db, "vehicleRegistry", "reg_RT-003"), { vehicleId: "x", value: "RT-003" }));
  });

  it("lets staff record a rental extension but never rewrite one", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001")));
    await assertSucceeds(setDoc(doc(db, "rentals", "rental_001", "extensions", "ext_002"), { extensionCents: 2000 }));
    await assertFails(updateDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001"), { extensionCents: 1 }));
    await assertFails(deleteDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001")));
  });

  it("lets staff open a contract for review but never declare it approved", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "reservationContracts", "contract_new"), {
        status: "in_review",
        version: 1,
      }),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_forged"), {
        status: "approved",
        version: 1,
      }),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_skipped"), {
        status: "in_review",
        version: 4,
      }),
    );
  });

  it("lets a rejected contract be resubmitted at the next version only", async () => {
    const db = asUser(OPS);

    await assertFails(
      updateDoc(doc(db, "reservationContracts", "contract_rejected"), {
        status: "in_review",
        version: 1,
      }),
    );

    await assertSucceeds(
      updateDoc(doc(db, "reservationContracts", "contract_rejected"), {
        status: "in_review",
        version: 2,
      }),
    );
  });

  it("keeps the approve and reject decision with an administrator", async () => {
    await assertFails(
      updateDoc(
        doc(asUser(OPS), "reservationContracts", "contract_ops_review"),
        { status: "approved", version: 1 },
      ),
    );

    await assertSucceeds(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_admin_review"),
        { status: "approved", version: 1 },
      ),
    );
  });

  it("lets staff offer a discount only as a request waiting for approval", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "rentalDiscounts", "discount_ops_request"), {
        rentalId: "rental_001",
        amountCents: 1500,
        status: "pending",
        requestedBy: OPS,
      }),
    );

    await assertFails(
      setDoc(doc(db, "rentalDiscounts", "discount_ops_self_approved"), {
        rentalId: "rental_001",
        amountCents: 1500,
        status: "approved",
        requestedBy: OPS,
      }),
    );

    await assertFails(
      setDoc(doc(db, "rentalDiscounts", "discount_in_another_name"), {
        rentalId: "rental_001",
        amountCents: 1500,
        status: "pending",
        requestedBy: ADMIN,
      }),
    );

    await assertSucceeds(
      getDocs(
        query(
          collection(db, "rentalDiscounts"),
          where("rentalId", "==", "rental_001"),
          where("status", "==", "pending"),
          limit(1),
        ),
      ),
    );
  });

  it("keeps the discount decision with an administrator, once, as asked", async () => {
    await assertFails(
      updateDoc(doc(asUser(OPS), "rentalDiscounts", "discount_pending"), {
        status: "approved",
      }),
    );

    await assertFails(
      updateDoc(doc(asUser(ADMIN), "rentalDiscounts", "discount_pending"), {
        status: "approved",
        amountCents: 9000,
      }),
    );

    await assertSucceeds(
      updateDoc(doc(asUser(ADMIN), "rentalDiscounts", "discount_pending"), {
        status: "approved",
      }),
    );

    await assertFails(
      updateDoc(doc(asUser(ADMIN), "rentalDiscounts", "discount_decided"), {
        status: "approved",
      }),
    );

    await assertSucceeds(
      setDoc(doc(asUser(ADMIN), "rentalDiscounts", "discount_admin_own"), {
        rentalId: "rental_001",
        amountCents: 500,
        status: "approved",
        requestedBy: ADMIN,
      }),
    );

    await assertFails(
      deleteDoc(doc(asUser(ADMIN), "rentalDiscounts", "discount_decided")),
    );
  });

  it("treats an approved contract as final, even for an administrator", async () => {
    await assertFails(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved"),
        { status: "in_review", version: 2 },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved"),
      ),
    );
  });

  it("lets only an administrator freeze a contract version, and nobody rewrite one", async () => {
    await assertSucceeds(
      getDoc(
        doc(asUser(OPS), "reservationContracts", "contract_approved", "versions", "v1"),
      ),
    );

    await assertFails(
      setDoc(
        doc(asUser(OPS), "reservationContracts", "contract_approved", "versions", "v9"),
        { version: 9 },
      ),
    );

    await assertSucceeds(
      setDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v2"),
        { version: 2, baseRentalCents: 16000 },
      ),
    );

    await assertFails(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v1"),
        { baseRentalCents: 1 },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v1"),
      ),
    );
  });

  it("keeps email delivery receipts append-only", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      getDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      ),
    );

    await assertSucceeds(
      setDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_002"),
        { status: "sent", providerMessageId: "msg_002", contractVersion: 1 },
      ),
    );

    await assertFails(
      updateDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
        { status: "failed" },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      ),
    );
  });

  it("keeps contracts away from an account that has not been approved", async () => {
    const db = asUser(PENDING);

    await assertFails(
      getDoc(doc(db, "reservationContracts", "contract_approved")),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_pending"), {
        status: "in_review",
        version: 1,
      }),
    );
  });

  /*
   * A collection the application reads but the rules never
   * match falls through to the default deny, and the screen
   * that reads it reports a permission error to a user who
   * has every permission. That has happened twice now — the
   * rental extensions subcollection, and the contract review
   * queue — so every path the client touches is asserted to
   * be matched by a rule rather than reaching the fallthrough.
   *
   * Keep this list in step with lib/services/firestore-client.ts.
   */
  const CLIENT_PATHS: string[][] = [
    ["users", ADMIN],
    ["vehicles", "vehicle_001"],
    ["vehicles", "vehicle_001", "serviceRecords", "service_001"],
    ["vehicleRegistry", "reg_RT-001"],
    ["customers", "customer_001"],
    ["reservations", "reservation_001"],
    ["reservationContracts", "contract_approved"],
    ["reservationContracts", "contract_approved", "versions", "v1"],
    ["reservationContracts", "contract_approved", "deliveries", "delivery_001"],
    ["rentals", "rental_001"],
    ["rentals", "rental_001", "inspections", "inspection_001"],
    ["rentals", "rental_001", "extensions", "ext_001"],
    ["rentalFinancials", "rental_001"],
    ["payments", "payment_001"],
    ["refunds", "refund_001"],
    ["financialLedger", "entry_001"],
    ["vehicleExpenses", "expense_001"],
    ["auditLogs", "audit_001"],
    ["idempotencyKeys", "payment_001"],
    ["rentalDiscounts", "discount_decided"],
  ];

  it("matches every collection the application reads with a rule", async () => {
    const db = asUser(ADMIN);

    for (const path of CLIENT_PATHS) {
      const [first, ...rest] = path;

      await assertSucceeds(
        getDoc(doc(db, first, ...rest)),
      );
    }
  });

  it("lets staff run the review queue query the booking screen issues", async () => {
    /* A get() passing is not evidence that a list() passes: the
       rules engine evaluates a query without a document. This is
       the exact query components/reservation-composer.tsx runs. */
    for (const uid of [OPS, ADMIN]) {
      await assertSucceeds(
        getDocs(
          query(
            collection(asUser(uid), "reservationContracts"),
            where("status", "in", ["in_review", "rejected"]),
            limit(50),
          ),
        ),
      );
    }

    await assertFails(
      getDocs(
        query(
          collection(
            testEnv.unauthenticatedContext().firestore() as unknown as Firestore,
            "reservationContracts",
          ),
          where("status", "in", ["in_review", "rejected"]),
          limit(50),
        ),
      ),
    );
  });

  it("gives an administrator the financial reporting reads", async () => {
    const db = asUser(ADMIN);

    await assertSucceeds(getDoc(doc(db, "rentalFinancials", "rental_001")));
    await assertSucceeds(getDoc(doc(db, "vehicleExpenses", "expense_001")));
    await assertSucceeds(getDoc(doc(db, "financialLedger", "entry_001")));
  });

  it("stops a pending account approving itself or claiming a role", async () => {
    const db = asUser(PENDING);

    await assertFails(updateDoc(doc(db, "users", PENDING), { status: "approved" }));
    await assertFails(updateDoc(doc(db, "users", PENDING), { role: "admin" }));
    await assertSucceeds(updateDoc(doc(db, "users", PENDING), { fullName: "Pending Person" }));
  });

  it("stops staff reading another staff member's profile", async () => {
    await assertFails(getDoc(doc(asUser(OPS), "users", ADMIN)));
    await assertSucceeds(getDoc(doc(asUser(ADMIN), "users", OPS)));
  });

  it("lets an administrator see the approval queue and decide it", async () => {
    const db = asUser(ADMIN);

    await assertSucceeds(
      getDocs(query(collection(db, "users"), where("status", "==", "pending"))),
    );

    await assertSucceeds(
      updateDoc(doc(db, "users", PENDING), {
        status: "approved",
        role: "operations",
        decidedBy: ADMIN,
      }),
    );

    /* Put the fixture back for the tests that follow. */
    await assertSucceeds(
      updateDoc(doc(db, "users", PENDING), { status: "pending", role: null }),
    );
  });

  it("stops operations listing or deciding staff accounts", async () => {
    const db = asUser(OPS);

    await assertFails(getDocs(collection(db, "users")));

    await assertFails(
      updateDoc(doc(db, "users", PENDING), { status: "approved", role: "operations" }),
    );
  });
});

describe("Workspaces, trials and licences", () => {
  const DAY = 86_400_000;

  /*
   * The writes the trial page makes, in one batch: the
   * workspace, the owner's account entry and administrator
   * profile, and the claim on the owner's email.
   */
  async function startTrial(
    uid: string,
    email: string,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const db = asUser(uid, email);
    const { serverTimestamp, writeBatch } = await import("firebase/firestore");
    const batch = writeBatch(db);

    batch.set(rootDoc(db, "workspaces", workspaceId), {
      name: "Sunrise Car Hire",
      ownerUid: uid,
      adminEmail: email,
      plan: "trial",
      trialStartedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      ...overrides,
    });
    batch.set(rootDoc(db, "trialEmails", email), {
      uid,
      workspaceId,
      createdAt: serverTimestamp(),
    });
    batch.set(rootDoc(db, "accounts", uid), {
      workspaceId,
      email,
      createdAt: serverTimestamp(),
    });
    batch.set(rootDoc(db, "workspaces", workspaceId, "users", uid), {
      fullName: "Sam Owner",
      email,
      requestedRole: "admin",
      role: "admin",
      status: "approved",
    });

    return batch.commit();
  }

  async function seedWorkspace(
    workspaceId: string,
    plan: string,
    trialStartedAt: Date,
    members: Array<{ uid: string; role: "admin" | "operations" }>,
  ) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;

      await setDoc(rootDoc(db, "workspaces", workspaceId), {
        name: workspaceId,
        ownerUid: members[0].uid,
        adminEmail: `${members[0].uid}@example.test`,
        plan,
        trialStartedAt,
      });

      for (const member of members) {
        await setDoc(rootDoc(db, "accounts", member.uid), {
          workspaceId,
          email: `${member.uid}@example.test`,
        });
        await setDoc(rootDoc(db, "workspaces", workspaceId, "users", member.uid), {
          email: `${member.uid}@example.test`,
          role: member.role,
          status: "approved",
          requestedRole: member.role,
        });
      }

      await setDoc(rootDoc(db, "workspaces", workspaceId, "vehicles", "v1"), {
        registrationNumber: `${workspaceId}-1`,
      });
    });
  }

  it("starts a trial for a new account, as its administrator", async () => {
    await assertSucceeds(startTrial("trial-owner", "owner@sunrise.test", "ws-sunrise"));

    const db = asUser("trial-owner", "owner@sunrise.test");

    await assertSucceeds(getDoc(rootDoc(db, "workspaces", "ws-sunrise")));
    await assertSucceeds(setDoc(rootDoc(db, "workspaces", "ws-sunrise", "vehicles", "v9"), { registrationNumber: "SR-9" }));
    await assertSucceeds(getDocs(rootCollection(db, "workspaces", "ws-sunrise", "users")));
  });

  it("allows one trial per email address", async () => {
    await assertFails(startTrial("second-owner", "owner@sunrise.test", "ws-again"));
  });

  it("allows one workspace per account", async () => {
    await assertFails(startTrial("trial-owner", "other@sunrise.test", "ws-another"));
  });

  it("only starts a trial — never a paid or backdated workspace", async () => {
    await assertFails(startTrial("cheat-1", "cheat1@example.test", "ws-cheat-1", { plan: "paid" }));
    await assertFails(
      startTrial("cheat-2", "cheat2@example.test", "ws-cheat-2", {
        trialStartedAt: new Date(Date.now() + 365 * DAY),
      }),
    );
    await assertFails(
      startTrial("cheat-3", "someone-else@example.test", "ws-cheat-3", {
        adminEmail: "victim@example.test",
      }),
    );
  });

  it("never creates an approved administrator in a workspace that already exists", async () => {
    const db = asUser("intruder", "intruder@example.test");

    await assertFails(
      setDoc(rootDoc(db, "workspaces", WORKSPACE, "users", "intruder"), {
        email: "intruder@example.test",
        requestedRole: "admin",
        role: "admin",
        status: "approved",
      }),
    );
  });

  it("lets a colleague join from the invite link, pending approval", async () => {
    const db = asUser("joiner", "joiner@example.test");
    const { serverTimestamp, writeBatch } = await import("firebase/firestore");

    const join = (role: string | null, status: string) => {
      const batch = writeBatch(db);
      batch.set(rootDoc(db, "accounts", "joiner"), {
        workspaceId: WORKSPACE,
        email: "joiner@example.test",
        createdAt: serverTimestamp(),
      });
      batch.set(rootDoc(db, "workspaces", WORKSPACE, "users", "joiner"), {
        fullName: "Jo Iner",
        email: "joiner@example.test",
        requestedRole: "operations",
        role,
        status,
      });
      return batch.commit();
    };

    await assertFails(join("operations", "approved"));
    await assertSucceeds(join(null, "pending"));

    /* Pending: the profile and the workspace are visible, the data is not. */
    await assertSucceeds(getDoc(rootDoc(db, "workspaces", WORKSPACE, "users", "joiner")));
    await assertFails(getDoc(rootDoc(db, "workspaces", WORKSPACE, "vehicles", "vehicle_001")));

    /* And the account cannot be moved to another workspace. */
    await assertFails(
      setDoc(rootDoc(db, "accounts", "joiner"), { workspaceId: "ws-sunrise", email: "joiner@example.test" }),
    );
  });

  it("refuses an invite to a workspace that does not exist", async () => {
    const db = asUser("lost", "lost@example.test");
    const { serverTimestamp } = await import("firebase/firestore");

    await assertFails(
      setDoc(rootDoc(db, "accounts", "lost"), {
        workspaceId: "ws-nowhere",
        email: "lost@example.test",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("keeps each workspace's data to its own members", async () => {
    await seedWorkspace("ws-other", "paid", new Date(Date.now() - 60 * DAY), [
      { uid: "other-admin", role: "admin" },
    ]);

    await assertFails(getDoc(rootDoc(asUser(ADMIN), "workspaces", "ws-other", "vehicles", "v1")));
    await assertFails(getDoc(rootDoc(asUser(ADMIN), "workspaces", "ws-other")));
    await assertFails(getDocs(rootCollection(asUser(ADMIN), "workspaces", "ws-other", "users")));
    await assertFails(getDoc(rootDoc(asUser("other-admin"), "workspaces", WORKSPACE, "vehicles", "vehicle_001")));
    await assertSucceeds(getDoc(rootDoc(asUser("other-admin"), "workspaces", "ws-other", "vehicles", "v1")));
  });

  it("opens a trial for seven days and closes it after", async () => {
    await seedWorkspace("ws-day-six", "trial", new Date(Date.now() - 6 * DAY), [
      { uid: "six-admin", role: "admin" },
      { uid: "six-ops", role: "operations" },
    ]);
    await seedWorkspace("ws-day-eight", "trial", new Date(Date.now() - 8 * DAY), [
      { uid: "eight-admin", role: "admin" },
      { uid: "eight-ops", role: "operations" },
    ]);

    await assertSucceeds(getDoc(rootDoc(asUser("six-ops"), "workspaces", "ws-day-six", "vehicles", "v1")));
    await assertSucceeds(setDoc(rootDoc(asUser("six-admin"), "workspaces", "ws-day-six", "customers", "c1"), { fullName: "C" }));

    for (const uid of ["eight-admin", "eight-ops"]) {
      const db = asUser(uid);

      await assertFails(getDoc(rootDoc(db, "workspaces", "ws-day-eight", "vehicles", "v1")));
      await assertFails(setDoc(rootDoc(db, "workspaces", "ws-day-eight", "customers", "c1"), { fullName: "C" }));
      /* What it takes to show the paywall stays readable. */
      await assertSucceeds(getDoc(rootDoc(db, "workspaces", "ws-day-eight")));
      await assertSucceeds(getDoc(rootDoc(db, "workspaces", "ws-day-eight", "users", uid)));
    }
  });

  it("opens an expired trial again once it is paid", async () => {
    await seedWorkspace("ws-paid-late", "paid", new Date(Date.now() - 20 * DAY), [
      { uid: "late-admin", role: "admin" },
    ]);

    await assertSucceeds(getDoc(rootDoc(asUser("late-admin"), "workspaces", "ws-paid-late", "vehicles", "v1")));
  });

  it("never lets a browser mark a workspace paid or extend its trial", async () => {
    const db = asUser("eight-admin");

    await assertFails(updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), { plan: "paid" }));
    await assertFails(updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), { trialStartedAt: new Date() }));
    await assertFails(updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), { paidAt: new Date() }));
  });

  it("lets an administrator record a completed checkout once", async () => {
    const { serverTimestamp } = await import("firebase/firestore");

    await assertFails(
      updateDoc(rootDoc(asUser("eight-ops"), "workspaces", "ws-day-eight"), {
        paymentSubmittedAt: serverTimestamp(),
      }),
    );

    const db = asUser("eight-admin");

    await assertFails(
      updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), {
        paymentSubmittedAt: new Date(Date.now() - DAY),
      }),
    );
    await assertSucceeds(
      updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), {
        paymentSubmittedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), {
        paymentSubmittedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(rootDoc(db, "workspaces", "ws-day-eight"), { name: "Eight Day Rentals" }),
    );
  });

  it("keeps the trial claims and account index private", async () => {
    await assertFails(getDocs(rootCollection(asUser(ADMIN), "trialEmails")));
    await assertFails(getDoc(rootDoc(asUser(ADMIN, "admin@example.test"), "trialEmails", "owner@sunrise.test")));
    await assertFails(getDoc(rootDoc(asUser(ADMIN), "accounts", OPS)));
  });
});
