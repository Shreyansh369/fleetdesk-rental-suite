/*
 * Fills a Firebase project with fictional demo data, for showing
 * the application to prospective operators.
 *
 * Nothing is written directly: every record is made by the same
 * workflow the screens call — create a vehicle, book, check out,
 * return, take a payment, record an expense — signed in as the
 * staff member it is attributed to. The data therefore has
 * exactly the shape the screens read, and stays correct when
 * the workflows change.
 *
 * The data itself is lib/demo/sample-data.ts, shared with the
 * in-browser demo's "Load sample business". Here it is written
 * into one paid workspace (id "demo" unless --workspace=<id>) of
 * a Firebase project, with a sign-in for each staff member.
 *
 * Runs against the local emulators by default. A hosted project
 * needs --remote and --confirm=<projectId>, and the script
 * refuses a workspace that already has vehicles, so it cannot be
 * pointed at an operator's live data by mistake.
 *
 *   pnpm demo:seed
 *   pnpm demo:seed -- --remote --confirm=<projectId>
 */
import process from "node:process";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { setWorkspaceScope } from "../lib/data/firestore";
import { SAMPLE_PASSWORD, SAMPLE_STAFF, loadSampleData, type SampleStaff } from "../lib/demo/sample-data";

const remote = process.argv.includes("--remote");
const confirmation = process.argv.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length);
const workspaceId = process.argv.find((value) => value.startsWith("--workspace="))?.slice("--workspace=".length) ?? "demo";

/* ---------------------------------------------------------------
   Connection
   --------------------------------------------------------------- */

if (remote) {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
    throw new Error("--remote cannot be combined with NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.");
  }
  if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || confirmation !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error("Seeding a hosted project needs --confirm=<projectId> matching NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  }
} else {
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "demo-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "demo-fleetdesk.firebaseapp.com";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "demo-fleetdesk";
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= "000000000000";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:000000000000:web:demo";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!getAdminApps().length) initializeAdminApp({ projectId });
const adminAuth = getAdminAuth();
const adminDb = getAdminFirestore();

/*
 * The workflows reach Firebase through getFirebaseClient(), which
 * reuses an app that already exists. It is created here first so
 * the emulators can be connected outside a browser, where the
 * client module deliberately does not connect them itself.
 */
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
if (!remote) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);
  connectStorageEmulator(getStorage(app), "127.0.0.1", 9199);
}

/* Imported once the app above exists, so the workflows reuse it. */
let workflows: typeof import("../lib/services/firestore-client") | undefined;

const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);

/* ---------------------------------------------------------------
   Staff: a sign-in, an account entry and a workspace profile each
   --------------------------------------------------------------- */

async function createStaff(staff: readonly SampleStaff[]): Promise<Record<string, string>> {
  const uidOf: Record<string, string> = {};
  for (const member of staff) {
    let uid: string;
    try {
      uid = (await adminAuth.getUserByEmail(member.email)).uid;
      await adminAuth.updateUser(uid, { password: SAMPLE_PASSWORD, displayName: member.fullName });
    } catch {
      uid = (await adminAuth.createUser({ email: member.email, password: SAMPLE_PASSWORD, displayName: member.fullName, emailVerified: true })).uid;
    }
    uidOf[member.key] = uid;
    await adminDb.collection("accounts").doc(uid).set({ workspaceId, email: member.email, createdAt: FieldValue.serverTimestamp() });
    await workspaceRef.collection("users").doc(uid).set({
      uid,
      email: member.email,
      fullName: member.fullName,
      mobile: member.mobile,
      age: member.age,
      requestedRole: member.role,
      ...(member.status === "approved"
        ? { role: member.role, status: "approved", decidedAt: FieldValue.serverTimestamp(), decidedByNameSnapshot: "Alex Morgan" }
        : { role: null, status: "pending" }),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return uidOf;
}

let signedInAs = "";
async function signInAs(member: SampleStaff): Promise<void> {
  if (signedInAs === member.key) return;
  if (auth.currentUser) await signOut(auth);
  await signInWithEmailAndPassword(auth, member.email, SAMPLE_PASSWORD);
  signedInAs = member.key;
}

/*
 * A past booking is stamped with the moment it was entered, and
 * Finance counts revenue from that stamp, so each one is dated
 * back to its pickup.
 */
async function backdateHistorical(): Promise<void> {
  for (const name of ["reservations", "rentals", "rentalFinancials"]) {
    const snapshot = await workspaceRef.collection(name).where("isHistorical", "==", true).get();
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = adminDb.batch();
      for (const document of snapshot.docs.slice(index, index + 400)) {
        const pickupAt = document.get("pickupAt");
        if (pickupAt) batch.update(document.ref, { createdAt: pickupAt });
      }
      await batch.commit();
    }
  }
}

/* ---------------------------------------------------------------
   Run
   --------------------------------------------------------------- */

async function main(): Promise<void> {
  workflows = await import("../lib/services/firestore-client");

  const existing = await workspaceRef.collection("vehicles").limit(1).get();
  if (!existing.empty) {
    throw new Error(
      remote
        ? `Workspace ${workspaceId} already has vehicles. Demo data is only seeded into an empty workspace.`
        : "The emulator already has data. Restart the emulators to clear it, then seed again.",
    );
  }

  console.log(`Seeding demo data into ${projectId}${remote ? "" : " (emulators)"}, workspace ${workspaceId}…`);

  /* A paid workspace, so the demo never runs into the trial's end. */
  await workspaceRef.set({
    name: "Demo Car Rentals",
    ownerUid: "",
    adminEmail: "demo.admin@gmail.com",
    plan: "paid",
    licenceType: "buyout",
    trialStartedAt: FieldValue.serverTimestamp(),
    paidAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  setWorkspaceScope(workspaceId);

  await loadSampleData({
    op: (name, data) => workflows!.callFirestoreOperation(name, data),
    createStaff: async (staff) => {
      const uidOf = await createStaff(staff);
      await workspaceRef.update({ ownerUid: uidOf.admin });
      return uidOf;
    },
    signInAs: (member) => signInAs(member),
    backdateHistorical,
    progress: (message) => console.log(`  ${message}`),
  });
  await signOut(auth);

  console.log("");
  console.log(`Demo accounts (password for all: ${SAMPLE_PASSWORD})`);
  for (const member of SAMPLE_STAFF) {
    console.log(`  ${member.email.padEnd(28)} ${member.role}${member.status === "pending" ? " (waiting for approval)" : ""}`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
