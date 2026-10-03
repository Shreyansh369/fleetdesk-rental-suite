import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * Staff access administration.
 *
 * The security rules read `role` and `status` from
 * `users/{uid}`: an account with `status: "pending"` can
 * sign in and reach nothing at all. Approving one used to
 * mean editing the document by hand in the Firebase console,
 * which is why accounts sat waiting. These are the writes
 * behind the Staff screen, and every one of them is an
 * administrator decision that leaves an audit record.
 */
export type StaffRole = "admin" | "operations";

export type StaffStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export type StaffMember = {
  uid: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  age: number | null;
  requestedRole: StaffRole | null;
  role: StaffRole | null;
  status: StaffStatus;
  createdAt: string | null;
  decidedAt: string | null;
  decidedByNameSnapshot: string | null;
  decisionNote: string | null;
};

function trimmedOrNull(
  value: unknown,
): string | null {
  return typeof value === "string" &&
    value.trim().length > 0
    ? value.trim()
    : null;
}

function toIsoOrNull(
  value: unknown,
): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function asRole(
  value: unknown,
): StaffRole | null {
  return value === "admin" ||
    value === "operations"
    ? value
    : null;
}

function asStatus(value: unknown): StaffStatus {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    status === "approved" ||
    status === "rejected" ||
    status === "suspended"
  ) {
    return status;
  }

  return "pending";
}

function getActorUid(): string {
  const user =
    getFirebaseClient().auth.currentUser;

  if (!user) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  return user.uid;
}

/** A rental office has staff, not a user base. */
const STAFF_LIMIT = 200;

/**
 * Every staff profile, newest request first.
 *
 * Only an administrator may list `users`, so an operations
 * account reaching this is refused by the rules rather than
 * by the screen alone.
 */
export async function listStaff(): Promise<
  StaffMember[]
> {
  const { db } = getFirebaseClient();

  const profiles = await getDocs(
    query(
      collection(db, "users"),
      limit(STAFF_LIMIT),
    ),
  );

  const members = profiles.docs.map(
    (snapshot): StaffMember => {
      const age = snapshot.get("age");

      return {
        uid: snapshot.id,

        fullName:
          trimmedOrNull(
            snapshot.get("fullName"),
          ) ??
          trimmedOrNull(
            snapshot.get("email"),
          ) ??
          "Unnamed account",

        email: trimmedOrNull(
          snapshot.get("email"),
        ),

        mobile: trimmedOrNull(
          snapshot.get("mobile"),
        ),

        age:
          typeof age === "number" &&
          Number.isFinite(age)
            ? age
            : null,

        requestedRole: asRole(
          snapshot.get("requestedRole"),
        ),

        role: asRole(snapshot.get("role")),

        status: asStatus(
          snapshot.get("status"),
        ),

        createdAt: toIsoOrNull(
          snapshot.get("createdAt"),
        ),

        decidedAt: toIsoOrNull(
          snapshot.get("decidedAt"),
        ),

        decidedByNameSnapshot: trimmedOrNull(
          snapshot.get("decidedByNameSnapshot"),
        ),

        decisionNote: trimmedOrNull(
          snapshot.get("decisionNote"),
        ),
      };
    },
  );

  const rank: Record<StaffStatus, number> = {
    pending: 0,
    approved: 1,
    suspended: 2,
    rejected: 3,
  };

  return members.sort((left, right) => {
    if (
      rank[left.status] !== rank[right.status]
    ) {
      return (
        rank[left.status] - rank[right.status]
      );
    }

    return (right.createdAt ?? "").localeCompare(
      left.createdAt ?? "",
    );
  });
}

export type StaffDecision =
  | {
      outcome: "approve";
      uid: string;
      role: StaffRole;
      note?: string | null;
    }
  | {
      outcome: "reject" | "suspend";
      uid: string;
      note?: string | null;
    };

/**
 * Approve, decline or withdraw an account.
 *
 * The write is a transaction so the decision and its audit
 * record land together, and so an administrator cannot act
 * on a profile that has already been removed.
 */
export async function decideStaffAccess(
  decision: StaffDecision,
): Promise<{
  uid: string;
  status: StaffStatus;
  role: StaffRole | null;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  if (decision.uid === actorUid) {
    throw new Error(
      "You cannot change your own access. Ask another administrator.",
    );
  }

  const note =
    trimmedOrNull(decision.note)?.slice(0, 500) ??
    null;

  const status: StaffStatus =
    decision.outcome === "approve"
      ? "approved"
      : decision.outcome === "reject"
        ? "rejected"
        : "suspended";

  const role =
    decision.outcome === "approve"
      ? decision.role
      : null;

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      decision.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    transaction.update(profileRef, {
      status,
      role,
      decisionNote: note,
      decidedAt: serverTimestamp(),
      decidedBy: actorUid,
      decidedByNameSnapshot: actorName,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action:
          decision.outcome === "approve"
            ? "user.access_approved"
            : decision.outcome === "reject"
              ? "user.access_rejected"
              : "user.access_suspended",

        resource: {
          collection: "users",
          id: decision.uid,
        },

        details: {
          actorName,
          status,
          role,
          note,

          requestedRole: asRole(
            profile.get("requestedRole"),
          ),

          previousStatus: asStatus(
            profile.get("status"),
          ),

          previousRole: asRole(
            profile.get("role"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );
  });

  return {
    uid: decision.uid,
    status,
    role,
  };
}

/**
 * Move an approved account between roles without taking it
 * through approval again.
 */
export async function changeStaffRole(options: {
  uid: string;
  role: StaffRole;
}): Promise<{ uid: string; role: StaffRole }> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  if (options.uid === actorUid) {
    throw new Error(
      "You cannot change your own role. Ask another administrator.",
    );
  }

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      options.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    if (
      asStatus(profile.get("status")) !==
      "approved"
    ) {
      throw new Error(
        "Approve this account before assigning a role.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    transaction.update(profileRef, {
      role: options.role,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action: "user.role_changed",

        resource: {
          collection: "users",
          id: options.uid,
        },

        details: {
          actorName,
          role: options.role,

          previousRole: asRole(
            profile.get("role"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );
  });

  return {
    uid: options.uid,
    role: options.role,
  };
}

/**
 * The staff an entry form can attribute work to.
 *
 * Only an administrator may list `users`, so an operations
 * account is refused by the rules. That is not an error worth
 * showing on a form: the account can still attribute the work
 * to itself, which is the common case, so the refusal falls
 * back to exactly that rather than blocking the entry.
 */
export async function listAssignableStaff(): Promise<
  Array<{ uid: string; fullName: string }>
> {
  const { auth } = getFirebaseClient();

  const self = auth.currentUser;

  const fallback = self
    ? [
        {
          uid: self.uid,

          fullName:
            trimmedOrNull(self.displayName) ??
            trimmedOrNull(self.email) ??
            "Me",
        },
      ]
    : [];

  try {
    const staff = await listStaff();

    const assignable = staff
      .filter(
        (member) =>
          member.status === "approved",
      )
      .map((member) => ({
        uid: member.uid,
        fullName: member.fullName,
      }));

    return assignable.length > 0
      ? assignable
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Correct a staff member's own details.
 *
 * Role and status are deliberately not writable here: those
 * are access decisions and go through `decideStaffAccess` and
 * `changeStaffRole`, each of which records why it happened.
 * The stored email is a display copy of the address the
 * account registered with; changing the sign-in address is a
 * Firebase Authentication operation and is not offered.
 */
export async function updateStaffProfile(options: {
  uid: string;
  fullName: string;
  mobile: string | null;
  age: number | null;
}): Promise<{ uid: string }> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  const fullName = trimmedOrNull(
    options.fullName,
  )?.slice(0, 120);

  if (!fullName) {
    throw new Error(
      "A staff member needs a name.",
    );
  }

  const mobile =
    trimmedOrNull(options.mobile)?.slice(
      0,
      40,
    ) ?? null;

  const age =
    options.age === null ||
    options.age === undefined ||
    Number.isNaN(Number(options.age))
      ? null
      : Math.trunc(Number(options.age));

  if (
    age !== null &&
    (age < 16 || age > 100)
  ) {
    throw new Error(
      "Enter an age between 16 and 100.",
    );
  }

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      options.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    transaction.update(profileRef, {
      fullName,
      mobile,
      age,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action: "user.profile_updated",

        resource: {
          collection: "users",
          id: options.uid,
        },

        details: {
          actorName,
          fullName,
          mobile,
          age,

          previousFullName: trimmedOrNull(
            profile.get("fullName"),
          ),

          previousMobile: trimmedOrNull(
            profile.get("mobile"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );
  });

  return { uid: options.uid };
}

/**
 * Remove a staff profile.
 *
 * This deletes the `users/{uid}` document, which is where the
 * rules read `role` and `status` from: the account loses every
 * permission the moment it is gone. It does not delete the
 * Firebase Authentication user, because a browser cannot —
 * that account can still sign in, and will land on the "no
 * staff profile exists" screen, able to register again as a
 * pending request. Removing it for good is a console action.
 *
 * What the account did is untouched. Rentals, bookings and
 * decisions carry a name snapshot taken when they happened,
 * so history still says who handled what after the profile
 * behind it is gone.
 */
export async function removeStaffMember(options: {
  uid: string;
}): Promise<{ uid: string }> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  if (options.uid === actorUid) {
    throw new Error(
      "You cannot remove your own account. Ask another administrator.",
    );
  }

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      options.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    /*
     * The audit entry is written in the same transaction and
     * carries everything the profile held, because once the
     * document is gone this record is the only account of who
     * was removed and by whom.
     */
    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action: "user.removed",

        resource: {
          collection: "users",
          id: options.uid,
        },

        details: {
          actorName,

          fullNameSnapshot: trimmedOrNull(
            profile.get("fullName"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),

          mobileSnapshot: trimmedOrNull(
            profile.get("mobile"),
          ),

          previousRole: asRole(
            profile.get("role"),
          ),

          previousStatus: asStatus(
            profile.get("status"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );

    transaction.delete(profileRef);
  });

  return { uid: options.uid };
}
