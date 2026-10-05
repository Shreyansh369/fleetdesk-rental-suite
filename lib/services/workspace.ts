"use client";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "@/lib/data/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * The writes that create and join workspaces in the shared
 * Firebase project. Each is a single transaction because the
 * security rules check the documents against each other — a
 * workspace may only be created together with its owner's
 * account entry, administrator profile and email claim, and a
 * colleague's pending profile only together with the account
 * entry that names the workspace — so none of them can exist
 * without the others.
 */

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function createTrialWorkspace(input: {
  uid: string;
  email: string;
  emailVerified: boolean;
  companyName: string;
  fullName: string;
  mobile: string;
}): Promise<string> {
  const email = normaliseEmail(input.email);
  const companyName = input.companyName.trim();
  const fullName = input.fullName.trim();
  const mobile = input.mobile.trim();

  if (companyName.length < 2 || companyName.length > 80) {
    throw new Error(
      "Enter your company name (2 to 80 characters).",
    );
  }

  if (fullName.length < 2) {
    throw new Error("Enter your full name.");
  }

  if (mobile.length < 7) {
    throw new Error("Enter a valid mobile number.");
  }

  if (!email || email.includes("/")) {
    throw new Error("This sign-in has no usable email address.");
  }

  const { db } = getFirebaseClient();

  const accountRef = doc(db, "accounts", input.uid);
  const claimRef = doc(db, "trialEmails", email);
  const workspaceRef = doc(collection(db, "workspaces"));
  const workspaceId = workspaceRef.id;

  await runTransaction(db, async (transaction) => {
    const [account, claim] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(claimRef),
    ]);

    if (account.exists()) {
      throw new Error(
        "This account already belongs to a workspace. Sign in instead.",
      );
    }

    if (claim.exists()) {
      throw new Error(
        `A free trial has already been used with ${email}. Sign in to that workspace, or contact us to continue.`,
      );
    }

    transaction.set(workspaceRef, {
      name: companyName,
      ownerUid: input.uid,
      adminEmail: email,
      plan: "trial",
      trialStartedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });

    transaction.set(claimRef, {
      uid: input.uid,
      workspaceId,
      createdAt: serverTimestamp(),
    });

    transaction.set(accountRef, {
      workspaceId,
      email,
      createdAt: serverTimestamp(),
    });

    transaction.set(
      doc(db, "workspaces", workspaceId, "users", input.uid),
      {
        fullName,
        email,
        mobile,
        age: null,
        requestedRole: "admin",
        role: "admin",
        status: "approved",
        emailVerified: input.emailVerified,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
  });

  return workspaceId;
}

export async function joinWorkspace(input: {
  workspaceId: string;
  uid: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  mobile: string;
  age: number;
  requestedRole: "admin" | "operations";
}): Promise<void> {
  const { db } = getFirebaseClient();
  const email = normaliseEmail(input.email);

  const accountRef = doc(db, "accounts", input.uid);
  const profileRef = doc(
    db,
    "workspaces",
    input.workspaceId,
    "users",
    input.uid,
  );

  try {
    await runTransaction(db, async (transaction) => {
      const account = await transaction.get(accountRef);

      if (account.exists()) {
        throw new Error(
          account.get("workspaceId") === input.workspaceId
            ? "A staff profile already exists for this account. Please sign in instead."
            : "This account already belongs to another FleetDesk workspace. Use a different email to join this one.",
        );
      }

      transaction.set(accountRef, {
        workspaceId: input.workspaceId,
        email,
        createdAt: serverTimestamp(),
      });

      transaction.set(profileRef, {
        fullName: input.fullName,
        email,
        mobile: input.mobile,
        age: input.age,
        requestedRole: input.requestedRole,
        role: null,
        status: "pending",
        emailVerified: input.emailVerified,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    /*
     * The rules refuse an account entry for a workspace that
     * does not exist, which is what a mistyped or truncated
     * invite link looks like from here.
     */
    if (
      error instanceof Error &&
      /permission/i.test(error.message)
    ) {
      throw new Error(
        "This invite link is not valid. Ask your administrator to send it again.",
      );
    }

    throw error;
  }
}

/*
 * Called when Stripe returns the administrator to the site after
 * a completed checkout. It only flags the workspace for us to
 * confirm the payment; the licence itself is switched on from
 * the vendor side (scripts/licence.ts), never from a browser.
 */
export async function recordPaymentSubmitted(
  workspaceId: string,
): Promise<void> {
  const { db } = getFirebaseClient();

  await updateDoc(doc(db, "workspaces", workspaceId), {
    paymentSubmittedAt: serverTimestamp(),
  });
}

/*
 * The link a colleague registers from. It is the only way into a
 * workspace other than starting one; the colleague still waits
 * for an administrator to approve them and assign a role.
 */
export function inviteLink(workspaceId: string): string {
  const origin =
    typeof window === "undefined"
      ? ""
      : window.location.origin;

  return `${origin}/signup?workspace=${encodeURIComponent(
    workspaceId,
  )}`;
}
