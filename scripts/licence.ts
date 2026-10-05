/*
 * The vendor's side of licensing: see who is on trial, who has
 * paid, and switch a licence on once a Stripe payment is matched
 * to its workspace.
 *
 * Payment is confirmed by hand for now. Stripe shows each
 * payment's client_reference_id — the workspace id the Billing
 * page put on the checkout link — so a payment is matched with
 * `list`, then switched on with `activate`. Once orders justify
 * it, a Stripe webhook can call activateWorkspace() below instead
 * (see docs/billing.md); nothing in the application changes.
 *
 * Uses the Admin SDK, which bypasses the security rules, with
 * Application Default Credentials for the project in
 * GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT (or --project):
 *
 *   gcloud auth application-default login
 *   pnpm licence list    [--project <id>] [--all]
 *   pnpm licence activate <workspaceId|admin email> [--reference <Stripe payment id>]
 *   pnpm licence restart-trial <workspaceId|admin email>
 *   pnpm licence revoke <workspaceId|admin email>
 *
 * Against the emulators, set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.
 */
import process from "node:process";
import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";

import {
  INCLUDED_SUPPORT_DAYS,
  licenceStatus,
} from "../lib/license";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index !== -1) {
    return process.argv[index + 1];
  }

  return process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function positional(): string[] {
  const values: string[] = [];
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--") continue;

    if (value.startsWith("--")) {
      if (!value.includes("=") && ["--project", "--reference"].includes(value)) {
        index += 1;
      }
      continue;
    }

    values.push(value);
  }

  return values;
}

function connect(): Firestore {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  }

  const projectId =
    option("--project") ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "Name the Firebase project with --project <id> or GOOGLE_CLOUD_PROJECT.",
    );
  }

  if (!getApps().length) {
    initializeApp({ projectId });
  }

  return getFirestore();
}

function dateOf(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function describe(snapshot: DocumentSnapshot) {
  const data = snapshot.data() ?? {};
  const licence = licenceStatus({
    plan: String(data.plan ?? ""),
    trialStartedAt: dateOf(data.trialStartedAt),
    paidAt: dateOf(data.paidAt),
    paymentSubmittedAt: dateOf(data.paymentSubmittedAt),
  });

  return {
    id: snapshot.id,
    name: String(data.name ?? ""),
    adminEmail: String(data.adminEmail ?? ""),
    state:
      licence.state === "trial"
        ? `trial (${licence.daysLeft}d left)`
        : licence.state === "expired"
          ? licence.paymentSubmitted
            ? "expired — PAYMENT SUBMITTED"
            : "expired"
          : "paid",
    createdAt: dateOf(data.createdAt)?.toISOString().slice(0, 10) ?? "",
    paymentSubmittedAt:
      dateOf(data.paymentSubmittedAt)?.toISOString().slice(0, 16) ?? "",
    paidAt: dateOf(data.paidAt)?.toISOString().slice(0, 10) ?? "",
  };
}

/*
 * Finds a workspace by its id, or by its administrator's email —
 * whichever the Stripe receipt or the customer gave us.
 */
async function findWorkspace(
  db: Firestore,
  key: string,
): Promise<DocumentSnapshot> {
  const direct = await db.collection("workspaces").doc(key).get();

  if (direct.exists) {
    return direct;
  }

  const byEmail = await db
    .collection("workspaces")
    .where("adminEmail", "==", key.trim().toLowerCase())
    .limit(2)
    .get();

  if (byEmail.size === 1) {
    return byEmail.docs[0];
  }

  throw new Error(
    byEmail.size > 1
      ? `More than one workspace is administered by ${key}; use the workspace id.`
      : `No workspace has the id or administrator email ${key}.`,
  );
}

/*
 * Switches a licence on. Safe to repeat: a workspace that is
 * already paid keeps its original payment date.
 */
export async function activateWorkspace(
  db: Firestore,
  workspaceId: string,
  paymentReference: string | null,
): Promise<"activated" | "already-paid"> {
  const ref = db.collection("workspaces").doc(workspaceId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      throw new Error(`Workspace ${workspaceId} does not exist.`);
    }

    if (snapshot.get("plan") === "paid") {
      return "already-paid";
    }

    transaction.update(ref, {
      plan: "paid",
      paidAt: FieldValue.serverTimestamp(),
      paymentReference,
      activatedAt: FieldValue.serverTimestamp(),
    });

    return "activated";
  });
}

async function main(): Promise<void> {
  const [command, key] = positional();
  const db = connect();

  switch (command) {
    case "list": {
      const snapshot = await db
        .collection("workspaces")
        .orderBy("createdAt", "desc")
        .limit(500)
        .get();

      const rows = snapshot.docs
        .map(describe)
        .filter(
          (row) =>
            process.argv.includes("--all") ||
            row.state !== "paid",
        );

      console.table(rows);
      console.log(
        `${rows.length} workspace(s)${process.argv.includes("--all") ? "" : " not yet paid — add --all to include paid ones"}.`,
      );
      return;
    }

    case "activate": {
      if (!key) throw new Error("Usage: pnpm licence activate <workspaceId|admin email> [--reference <id>]");

      const workspace = await findWorkspace(db, key);
      const result = await activateWorkspace(
        db,
        workspace.id,
        option("--reference") ?? null,
      );

      console.log(
        result === "already-paid"
          ? `${workspace.id} (${workspace.get("name")}) was already paid; nothing changed.`
          : `Activated ${workspace.id} (${workspace.get("name")}). Changes are included for ${INCLUDED_SUPPORT_DAYS} days; start the maintenance subscription after that.`,
      );
      return;
    }

    case "restart-trial": {
      if (!key) throw new Error("Usage: pnpm licence restart-trial <workspaceId|admin email>");

      const workspace = await findWorkspace(db, key);

      if (workspace.get("plan") === "paid") {
        throw new Error(`${workspace.id} is paid; there is no trial to restart.`);
      }

      await workspace.ref.update({
        trialStartedAt: FieldValue.serverTimestamp(),
      });

      console.log(`Restarted the 7-day trial for ${workspace.id} (${workspace.get("name")}) from now.`);
      return;
    }

    case "revoke": {
      if (!key) throw new Error("Usage: pnpm licence revoke <workspaceId|admin email>");

      const workspace = await findWorkspace(db, key);

      await workspace.ref.update({
        plan: "trial",
        paidAt: FieldValue.delete(),
        paymentSubmittedAt: FieldValue.delete(),
        revokedAt: FieldValue.serverTimestamp(),
      });

      console.log(`Revoked the licence for ${workspace.id}; it is back on its original trial dates, which close it once they have passed.`);
      return;
    }

    default:
      throw new Error(
        "Usage: pnpm licence <list|activate|restart-trial|revoke> …",
      );
  }
}

if (process.argv[1]?.endsWith("licence.ts")) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
