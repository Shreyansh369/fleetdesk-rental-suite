import process from "node:process";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = process.argv.slice(2).filter((value) => value !== "--");
const email = args[0];
const password = args[1];
const workspaceId = args[2] ?? "local";

if (!email || !password) {
  console.error(
    "Usage: pnpm bootstrap:admin -- <email> <password> [workspaceId]",
  );
  process.exit(1);
}

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
  throw new Error(
    "Refusing to bootstrap an admin unless NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.",
  );
}

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "demo-fleetdesk";

if (!getApps().length) {
  initializeApp({
    projectId: process.env.GCLOUD_PROJECT,
  });
}

const auth = getAuth();
const db = getFirestore();

let user;

try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({
    email,
    password,
    emailVerified: true,
    disabled: false,
  });
}

/*
 * Authorisation is read from workspaces/{id}/users/{uid} by the
 * security rules, not from a custom claim, and the rules require
 * status: "approved" before any collection opens. A local
 * workspace is created paid, so development never runs into the
 * end of a trial; accounts/{uid} is how the client finds it.
 */
const workspaceRef = db.collection("workspaces").doc(workspaceId);

if (!(await workspaceRef.get()).exists) {
  await workspaceRef.set({
    name: "Local Development",
    ownerUid: user.uid,
    adminEmail: email.toLowerCase(),
    plan: "paid",
    licenceType: "buyout",
    trialStartedAt: FieldValue.serverTimestamp(),
    paidAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
}

await db.collection("accounts").doc(user.uid).set({
  workspaceId,
  email: email.toLowerCase(),
  createdAt: FieldValue.serverTimestamp(),
});

await workspaceRef.collection("users").doc(user.uid).set(
  {
    uid: user.uid,
    email,
    role: "admin",
    status: "approved",
    requestedRole: "admin",
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log("");
console.log("Local admin ready.");
console.log(`Email: ${email}`);
console.log(`UID: ${user.uid}`);
console.log(`Workspace: ${workspaceId} (paid)`);
console.log("Role: admin (approved)");
