import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";

/*
 * The storage rules resolve the caller's role through
 * users/{uid} in Firestore, so both emulators are needed here.
 */
let testEnv: RulesTestEnvironment;

const OPS = "ops-user";
const OUTSIDER = "outsider";

const jpeg = new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "fleetdesk-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", OPS), {
      email: "ops@example.test",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(context.firestore(), "users", OUTSIDER), {
      email: "outsider@example.test",
      role: null,
      status: "pending",
      requestedRole: "operations",
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Storage access policy", () => {
  it("rejects unauthenticated inspection-photo uploads", async () => {
    await assertFails(
      uploadBytes(
        ref(testEnv.unauthenticatedContext().storage(), "inspection-photos/rental_001/photo_001"),
        jpeg,
        { contentType: "image/jpeg" },
      ),
    );
  });

  it("rejects an authenticated account that has not been approved as staff", async () => {
    await assertFails(
      uploadBytes(
        ref(testEnv.authenticatedContext(OUTSIDER).storage(), "inspection-photos/rental_001/photo_001"),
        jpeg,
        { contentType: "image/jpeg" },
      ),
    );
  });

  it("allows approved staff to upload a constrained inspection image", async () => {
    await assertSucceeds(
      uploadBytes(
        ref(testEnv.authenticatedContext(OPS).storage(), "inspection-photos/rental_001/photo_001"),
        jpeg,
        { contentType: "image/jpeg" },
      ),
    );
  });

  it("rejects an executable masquerading as a customer document", async () => {
    const script = new Blob(["not a document"], { type: "application/javascript" });

    await assertFails(
      uploadBytes(
        ref(testEnv.authenticatedContext(OPS).storage(), "customer-documents/customer_001/file_001"),
        script,
        { contentType: "application/javascript" },
      ),
    );
  });

  it("keeps a stored licence image away from anyone who is not staff", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), "customer-documents/customer_001/licence_001"),
        jpeg,
        { contentType: "image/jpeg" },
      );
    });

    await assertFails(
      getBytes(ref(testEnv.unauthenticatedContext().storage(), "customer-documents/customer_001/licence_001")),
    );

    await assertFails(
      getBytes(ref(testEnv.authenticatedContext(OUTSIDER).storage(), "customer-documents/customer_001/licence_001")),
    );

    await assertSucceeds(
      getBytes(ref(testEnv.authenticatedContext(OPS).storage(), "customer-documents/customer_001/licence_001")),
    );
  });
});
