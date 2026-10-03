import type { CallableRequest } from "firebase-functions/https";
import { HttpsError } from "firebase-functions/https";

import type { UserRole } from "../../../packages/domain/src/types";
import { db } from "./firebase";

const ROLES: readonly UserRole[] = [
  "admin",
  "operations",
];

export async function requireRole(
  request: CallableRequest<unknown>,
  ...allowed: UserRole[]
): Promise<{
  uid: string;
  role: UserRole;
}> {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in is required.",
    );
  }

  const uid = request.auth.uid;

  const profileSnapshot = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!profileSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Your staff account is not approved for application access.",
    );
  }

  const profile =
    profileSnapshot.data() ?? {};

  const role = profile.role;

  const status =
    String(
      profile.status ?? "",
    ).toLowerCase();

  if (status !== "approved") {
    throw new HttpsError(
      "permission-denied",
      "Your staff account is not approved for application access.",
    );
  }

  if (
    typeof role !== "string" ||
    !ROLES.includes(
      role as UserRole,
    ) ||
    !allowed.includes(
      role as UserRole,
    )
  ) {
    throw new HttpsError(
      "permission-denied",
      "Your role is not permitted to perform this operation.",
    );
  }

  return {
    uid,
    role: role as UserRole,
  };
}

export async function requireAdmin(
  request: CallableRequest<unknown>,
): Promise<{
  uid: string;
  role: "admin";
}> {
  const actor =
    await requireRole(
      request,
      "admin",
    );

  return {
    ...actor,
    role: "admin",
  };
}

/**
 * Convert known business validation failures into useful
 * callable errors while keeping unexpected failures generic.
 */
export function safeError(
  error: unknown,
): never {
  if (error instanceof HttpsError) {
    throw error;
  }

  if (error instanceof Error) {
    const businessMessages = new Set([
      "Expected return must be after pickup.",
      "Pickup time cannot be in the past.",
      "Vehicle has an overlapping reservation.",
      "Vehicle was not found.",
      "Customer was not found.",
      "Vehicle cannot be reserved in its current status.",
      "Vehicle registration and insurance must be valid through pickup.",
      "Customer licence is missing or expires before pickup.",
      "Invalid date.",
    ]);

    if (
      businessMessages.has(
        error.message,
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        error.message,
      );
    }

    if (
      error.message.startsWith(
        "Vehicle ",
      ) ||
      error.message.startsWith(
        "Customer ",
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        error.message,
      );
    }
  }

  console.error(
    "Unexpected trusted-operation failure",
    {
      name:
        error instanceof Error
          ? error.name
          : "UnknownError",
    },
  );

  throw new HttpsError(
    "internal",
    "The operation could not be completed. No changes were confirmed.",
  );
}