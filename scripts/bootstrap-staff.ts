import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import process from "node:process";

type Role = "admin" | "operations";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const email = readArgument("--email")?.trim().toLowerCase();
  const role = (readArgument("--role") ?? "admin") as Role;
  const create = process.argv.includes("--create");
  const apply = process.argv.includes("--apply");
  const confirmation = readArgument("--confirm");
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Provide a valid --email address.");
  if (role !== "admin" && role !== "operations") throw new Error("--role must be admin or operations.");
  if (confirmation !== email) throw new Error("Repeat the exact email in --confirm=<email> to prevent an accidental role assignment.");
  if (!apply) { console.log(JSON.stringify({ dryRun: true, email, role, create, message: "No user or role was changed. Rerun with --apply after confirming the target Firebase project." }, null, 2)); return; }
  if (!getApps().length) initializeApp();
  const auth = getAuth();
  let user: UserRecord;
  try { user = await auth.getUserByEmail(email); }
  catch (error: unknown) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found")) throw error;
    if (!create) throw new Error("No Firebase Authentication user exists for this email. Create it in Firebase Authentication, or run again with --create and a password through standard input.");
    const password = await stdin();
    if (password.length < 12) throw new Error("The password supplied on standard input must be at least 12 characters.");
    user = await auth.createUser({ email, password });
  }
  const db = getFirestore();
  // The security rules read the role and the approval from this
  // document, not from a custom claim. Without status: "approved"
  // the account is denied every collection.
  await db.collection("users").doc(user.uid).set({ email: user.email ?? email, role, status: "approved", requestedRole: role, updatedAt: FieldValue.serverTimestamp(), updatedBy: "bootstrap-script", createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLogs").add({ actorUid: "bootstrap-script", action: "user.role_bootstrapped", target: { collection: "users", id: user.uid }, metadata: { email, role, created: create }, occurredAt: FieldValue.serverTimestamp() });
  console.log(JSON.stringify({ applied: true, uid: user.uid, email, role, created: create }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
