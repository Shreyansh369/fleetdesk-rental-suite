import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

/*
 * Roles are resolved from users/{uid} rather than from custom
 * claims: the workspace has no Admin SDK to mint claims with, so
 * a staff profile is what these tests have to seed.
 */
let testEnv: RulesTestEnvironment;

const ADMIN = "admin-user";
const OPS = "ops-user";
const PENDING = "pending-user";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "fleetdesk-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

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

function asUser(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("Firestore access policy", () => {
  it("denies unauthenticated access to every collection", async () => {
    const db = testEnv.unauthenticatedContext().firestore();

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
            testEnv.unauthenticatedContext().firestore(),
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
