"use client";

import {
  doc,
  onSnapshot,
  setWorkspaceScope,
  Timestamp,
  type DocumentData,
} from "@/lib/data/firestore";

import {
  onAuthStateChanged,
  type User,
} from "@/lib/data/auth";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { firebaseEnvironment } from "@/lib/firebase/config";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  backendMode,
  liveBackendAvailable,
  type BackendMode,
} from "@/lib/data/mode";
import type { WorkspaceRecord } from "@/lib/license";

export type AppRole =
  | "admin"
  | "operations"
  | null;

type Shared = {
  mode: BackendMode;
  /* The live workspace the account belongs to; null in the demo. */
  workspace: WorkspaceRecord | null;
  /* Signed in, but not a member of any workspace yet. */
  noWorkspace: boolean;
};

type AuthState =
  | ({
      status: "config-error";
      user: null;
      role: null;
      message: string;
    } & Shared)
  | ({
      status: "loading";
      user: User | null;
      role: null;
      message: string | null;
    } & Shared)
  | ({
      status: "ready";
      user: User | null;
      role: AppRole;
      message: string | null;
    } & Shared);

const EMPTY: Shared = {
  mode: "live",
  workspace: null,
  noWorkspace: false,
};

const FirebaseContext =
  createContext<AuthState>({
    status: "loading",
    user: null,
    role: null,
    message: null,
    ...EMPTY,
  });

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp
    ? value.toDate()
    : null;
}

function workspaceFrom(
  id: string,
  data: DocumentData,
): WorkspaceRecord {
  return {
    id,
    name: String(data.name ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    adminEmail: String(data.adminEmail ?? ""),
    plan: String(data.plan ?? ""),
    licenceType:
      data.licenceType === "subscription" ||
      data.licenceType === "buyout"
        ? data.licenceType
        : null,
    billingIssue: data.billingIssue === true,
    trialStartedAt: toDate(data.trialStartedAt),
    paidAt: toDate(data.paidAt),
    paymentSubmittedAt: toDate(
      data.paymentSubmittedAt,
    ),
  };
}

/*
 * Turns a staff profile into an access decision. The messages
 * are what the "access pending" screen shows, so they explain
 * the state rather than name it.
 */
function decide(
  profile: DocumentData | undefined,
): Pick<AuthState, "role" | "message"> & {
  role: AppRole;
} {
  if (!profile) {
    return {
      role: null,
      message:
        "You are signed in, but no staff profile exists for this account yet.",
    };
  }

  const role: AppRole =
    profile.role === "admin" ||
    profile.role === "operations"
      ? profile.role
      : null;

  const status = String(
    profile.status ?? "",
  ).toLowerCase();

  if (status !== "approved") {
    return {
      role: null,
      message:
        status === "pending"
          ? "Your staff account is awaiting administrator approval."
          : "Your staff account is not approved for application access.",
    };
  }

  if (!role) {
    return {
      role: null,
      message:
        "Your account has been approved, but no valid application role has been assigned.",
    };
  }

  return { role, message: null };
}

export function FirebaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] =
    useState<AuthState>({
      status: "loading",
      user: null,
      role: null,
      message: null,
      ...EMPTY,
    });

  useEffect(() => {
    const mode = backendMode();

    let cancelled = false;

    /*
     * A configuration problem is reported from a task of its
     * own so the provider never re-renders synchronously from
     * inside this effect.
     */
    const fail = (message: string) =>
      queueMicrotask(() => {
        if (!cancelled) {
          setState({
            status: "config-error",
            user: null,
            role: null,
            message,
            ...EMPTY,
            mode,
          });
        }
      });

    if (
      mode === "live" &&
      (!liveBackendAvailable() ||
        !firebaseEnvironment())
    ) {
      fail(
        "Firebase configuration is missing. Check the environment variables.",
      );

      return () => {
        cancelled = true;
      };
    }

    let firebaseClient:
      | ReturnType<typeof getFirebaseClient>
      | undefined;

    try {
      firebaseClient = getFirebaseClient();
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Firebase could not initialize.",
      );

      return () => {
        cancelled = true;
      };
    }

    const { auth, db } = firebaseClient;

    /* Every listener opened for the current user. */
    let detach: Array<() => void> = [];

    const closeListeners = () => {
      for (const unsubscribe of detach) {
        unsubscribe();
      }

      detach = [];
    };

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => {
        closeListeners();
        setWorkspaceScope(null);

        if (cancelled) {
          return;
        }

        if (!user) {
          setState({
            status: "ready",
            user: null,
            role: null,
            message: null,
            ...EMPTY,
            mode,
          });

          return;
        }

        setState({
          status: "loading",
          user,
          role: null,
          message: "Checking your staff profile…",
          ...EMPTY,
          mode,
        });

        const profileError = (error: Error) => {
          console.error(
            "Staff profile listener failed:",
            error,
          );

          if (cancelled) {
            return;
          }

          setState((previous) => ({
            status: "ready",
            user,
            role: null,
            message: `We could not verify your staff profile: ${error.message}`,
            mode,
            workspace: previous.workspace,
            noWorkspace: false,
          }));
        };

        /*
         * The demo has one workspace — this device — so the
         * profile is all there is to resolve.
         */
        if (mode === "demo") {
          detach.push(
            onSnapshot(
              doc(db, "users", user.uid),
              (snapshot) => {
                if (cancelled) return;

                setState({
                  status: "ready",
                  user,
                  ...decide(snapshot.data()),
                  ...EMPTY,
                  mode,
                });
              },
              profileError,
            ),
          );

          return;
        }

        /*
         * Live: accounts/{uid} names the workspace, and only
         * then can the workspace and the staff profile inside it
         * be read. Each is a live listener, so an approval, a
         * role change, or a payment being confirmed shows up
         * without signing in again.
         */
        let workspaceListeners: Array<() => void> = [];

        const closeWorkspace = () => {
          for (const unsubscribe of workspaceListeners) {
            unsubscribe();
          }

          workspaceListeners = [];
        };

        detach.push(closeWorkspace);

        let openWorkspaceId: string | null = null;

        detach.push(
          onSnapshot(
            doc(db, "accounts", user.uid),
            (account) => {
              if (cancelled) return;

              const workspaceId = account.exists()
                ? String(account.get("workspaceId") ?? "")
                : "";

              if (!workspaceId) {
                closeWorkspace();
                openWorkspaceId = null;
                setWorkspaceScope(null);

                setState({
                  status: "ready",
                  user,
                  role: null,
                  message:
                    "This account is not part of a FleetDesk workspace yet. Start a free trial, or ask your administrator for the invite link.",
                  mode,
                  workspace: null,
                  noWorkspace: true,
                });

                return;
              }

              if (workspaceId === openWorkspaceId) {
                return;
              }

              closeWorkspace();
              openWorkspaceId = workspaceId;
              setWorkspaceScope(workspaceId);

              let workspace: WorkspaceRecord | null = null;
              let profile: DocumentData | undefined;
              let haveWorkspace = false;
              let haveProfile = false;

              const publish = () => {
                if (
                  cancelled ||
                  !haveWorkspace ||
                  !haveProfile
                ) {
                  return;
                }

                setState({
                  status: "ready",
                  user,
                  ...decide(profile),
                  mode,
                  workspace,
                  noWorkspace: false,
                });
              };

              workspaceListeners.push(
                onSnapshot(
                  doc(db, "workspaces", workspaceId),
                  (snapshot) => {
                    workspace = snapshot.exists()
                      ? workspaceFrom(
                          snapshot.id,
                          snapshot.data(),
                        )
                      : null;
                    haveWorkspace = true;
                    publish();
                  },
                  profileError,
                ),

                onSnapshot(
                  doc(db, "users", user.uid),
                  (snapshot) => {
                    profile = snapshot.data();
                    haveProfile = true;
                    publish();
                  },
                  profileError,
                ),
              );
            },
            profileError,
          ),
        );
      },
    );

    return () => {
      cancelled = true;
      closeListeners();
      unsubscribeAuth();
    };
  }, []);

  const value = useMemo(
    () => state,
    [state],
  );

  return (
    <FirebaseContext.Provider
      value={value}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseAuth() {
  return useContext(
    FirebaseContext,
  );
}
