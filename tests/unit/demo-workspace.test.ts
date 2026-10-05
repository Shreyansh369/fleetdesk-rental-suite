import { beforeAll, describe, expect, it } from "vitest";

import { forceBackendMode } from "@/lib/data/mode";

/*
 * The demo runs the real workflows against the in-browser store.
 * Loading the sample business exercises nearly all of them —
 * vehicles, customers, past rentals, expenses, bookings,
 * cancellations, checkout, return, payments, discounts and
 * contract review — so a gap in the store shows up here as a
 * failed workflow rather than as a broken demo.
 */
forceBackendMode("demo");

const { loadDemoSampleData, listDemoProfiles, resetDemoWorkspace } =
  await import("@/lib/demo/demo-workspace");
const workflows = await import("@/lib/services/firestore-client");
const { getLocalBackend } = await import("@/lib/data/local-backend");

describe("demo workspace", () => {
  beforeAll(async () => {
    await resetDemoWorkspace();
  });

  it("starts with the visitor as its only, approved administrator", async () => {
    const profiles = await listDemoProfiles();

    expect(profiles).toEqual([
      expect.objectContaining({ uid: "demo-owner", role: "admin", status: "approved" }),
    ]);
    expect(getLocalBackend().auth.currentUser?.uid).toBe("demo-owner");
  });

  it(
    "loads the sample business through the real workflows",
    async () => {
      const summary = await loadDemoSampleData();

      expect(summary.vehicles).toBe(14);
      expect(summary.customers).toBe(18);
      expect(summary.pastRentals).toBeGreaterThan(50);
      expect(getLocalBackend().auth.currentUser?.uid).toBe("demo-owner");

      const dashboard = await workflows.callFirestoreOperation<
        unknown,
        { totalFleet: number; overdue: number; activeRentals: unknown[] }
      >("getOperationalDashboard", {});

      expect(dashboard.totalFleet).toBe(14);
      expect(dashboard.overdue).toBeGreaterThanOrEqual(1);
      expect(dashboard.activeRentals.length).toBeGreaterThanOrEqual(4);

      const now = new Date();
      const finance = await workflows.callFirestoreOperation<
        unknown,
        { recentEntries: unknown[] }
      >("getFinancialOverview", {
        from: new Date(now.valueOf() - 200 * 86_400_000).toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        vehicleId: null,
      });

      expect(finance.recentEntries.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it("refuses to load sample data twice", async () => {
    await expect(loadDemoSampleData()).rejects.toThrow("empty demo");
  });

  it("survives a round trip through its saved form", async () => {
    const { db } = getLocalBackend();
    const before = db.exportSerialized();

    db.importSerialized(before);

    expect(db.exportSerialized()).toBe(before);
  });

  it("empties completely on reset, keeping the administrator", async () => {
    await resetDemoWorkspace();

    const profiles = await listDemoProfiles();
    expect(profiles.map((profile) => profile.uid)).toEqual(["demo-owner"]);
  });
});
