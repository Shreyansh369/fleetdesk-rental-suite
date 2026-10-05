"use client";

import {
  ensureDemoAccounts,
  getLocalBackend,
} from "@/lib/data/local-backend";
import {
  executeQuery,
  localDoc,
  localServerTimestamp,
  localWriteBatch,
} from "@/lib/data/local-firestore";
import {
  loadSampleData,
  type SampleDataSummary,
} from "./sample-data";

/*
 * What the demo bar can do to the demo workspace: fill it with
 * the sample business, wipe it, add a staff member the way a
 * colleague would sign up, and switch whose eyes the visitor
 * sees the workspace through.
 */

export type DemoProfile = {
  uid: string;
  fullName: string;
  email: string;
  role: "admin" | "operations" | null;
  status: string;
};

export async function demoHasVehicles(): Promise<boolean> {
  const { db } = getLocalBackend();
  await db.ready;

  return (
    executeQuery(db, "vehicles", [
      { kind: "limit", count: 1 },
    ]).length > 0
  );
}

export async function listDemoProfiles(): Promise<
  DemoProfile[]
> {
  const { db } = getLocalBackend();
  await db.ready;

  return executeQuery(db, "users", [
    { kind: "orderBy", field: "fullName", direction: "asc" },
  ]).map((row) => ({
    uid: row.id,
    fullName: String(row.data.fullName ?? row.id),
    email: String(row.data.email ?? ""),
    role:
      row.data.role === "admin" ||
      row.data.role === "operations"
        ? row.data.role
        : null,
    status: String(row.data.status ?? ""),
  }));
}

export async function signInToDemo(
  email: string,
  password: string,
): Promise<void> {
  await getLocalBackend().auth.signInWithPassword(
    email,
    password,
  );
}

export async function signOutOfDemo(): Promise<void> {
  await getLocalBackend().auth.signOut();
}

/*
 * The demo stand-in for a colleague registering from the invite
 * link: a pending profile that an administrator then approves,
 * with a role, on the Staff screen.
 */
export async function addDemoStaffRequest(input: {
  fullName: string;
  email: string;
  requestedRole: "admin" | "operations";
}): Promise<void> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  if (fullName.length < 2) {
    throw new Error("Enter the staff member's full name.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const { db } = getLocalBackend();
  await db.ready;

  const batch = localWriteBatch(db);

  batch.set(
    localDoc(
      db,
      "users",
      `demo-${globalThis.crypto.randomUUID()}`,
    ),
    {
      fullName,
      email,
      mobile: "+1 555 010 9999",
      age: 30,
      requestedRole: input.requestedRole,
      role: null,
      status: "pending",
      emailVerified: false,
      createdAt: localServerTimestamp(),
      updatedAt: localServerTimestamp(),
    },
  );

  await batch.commit();
}

export async function resetDemoWorkspace(): Promise<void> {
  const { db, auth } = getLocalBackend();

  await db.reset();
  await auth.restart();
}

export async function loadDemoSampleData(
  onProgress?: (message: string) => void,
): Promise<SampleDataSummary> {
  const { db, auth } = getLocalBackend();
  await auth.ready;

  if (await demoHasVehicles()) {
    throw new Error(
      "Sample data can only be loaded into an empty demo. Reset the demo first.",
    );
  }

  const workflows = await import(
    "@/lib/services/firestore-client"
  );

  const owner = auth.currentUser;
  const impersonation: {
    restore: (() => void) | null;
  } = { restore: null };

  try {
    return await db.withNotificationsPaused(() =>
      loadSampleData({
        op: (name, data) =>
          workflows.callFirestoreOperation(name, data),

        /* The demo accounts are the sample business's staff. */
        createStaff: () => ensureDemoAccounts(db),

        async signInAs(member, uid) {
          const profile = db.readStored(
            `users/${uid}`,
          )?.data;

          const undo = auth.impersonate(
            uid,
            String(profile?.email ?? member.email),
            String(profile?.fullName ?? member.fullName),
          );

          impersonation.restore ??= undo;
        },

        async backdateHistorical() {
          const batch = localWriteBatch(db);

          for (const name of [
            "reservations",
            "rentals",
            "rentalFinancials",
          ]) {
            for (const row of executeQuery(db, name, [
              {
                kind: "where",
                field: "isHistorical",
                op: "==",
                value: true,
              },
            ])) {
              if (row.data.pickupAt) {
                batch.update(localDoc(db, row.path), {
                  createdAt: row.data.pickupAt,
                });
              }
            }
          }

          await batch.commit();
        },

        progress: onProgress,
      }),
    );
  } finally {
    if (impersonation.restore) {
      impersonation.restore();
    } else if (owner) {
      auth.currentUser = owner;
    }

    await db.flush();
  }
}

/*
 * The demo's data as a file, so a visitor can keep what they
 * entered, or hand it to us when their trial is set up.
 */
export async function exportDemoWorkspace(): Promise<Blob> {
  const { db } = getLocalBackend();
  await db.ready;

  return new Blob([db.exportSerialized()], {
    type: "application/json",
  });
}
