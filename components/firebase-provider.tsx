"use client";

import {
  doc,
  onSnapshot,
} from "firebase/firestore";

import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { firebaseEnvironment } from "@/lib/firebase/config";
import { getFirebaseClient } from "@/lib/firebase/client";

export type AppRole =
  | "admin"
  | "operations"
  | null;

type AuthState =
  | {
      status: "config-error";
      user: null;
      role: null;
      message: string;
    }
  | {
      status: "loading";
      user: User | null;
      role: null;
      message: string | null;
    }
  | {
      status: "ready";
      user: User | null;
      role: AppRole;
      message: string | null;
    };

const FirebaseContext =
  createContext<AuthState>({
    status: "loading",
    user: null,
    role: null,
    message: null,
  });

export function FirebaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] =
    useState<AuthState>(() => {
      if (!firebaseEnvironment()) {
        return {
          status: "config-error",
          user: null,
          role: null,
          message:
            "Firebase configuration is missing. Check the environment variables.",
        };
      }

      return {
        status: "loading",
        user: null,
        role: null,
        message: null,
      };
    });

  useEffect(() => {
    if (!firebaseEnvironment()) {
      return;
    }

    let cancelled = false;

    let unsubscribeProfile:
      | (() => void)
      | undefined;

    let firebaseClient:
      | ReturnType<
          typeof getFirebaseClient
        >
      | undefined;

    let initializationError:
      | string
      | undefined;

    try {
      firebaseClient =
        getFirebaseClient();
    } catch (error) {
      initializationError =
        error instanceof Error
          ? error.message
          : "Firebase could not initialize.";
    }

    /*
     * A failed initialization is reported from a task of its
     * own so the provider never re-renders synchronously from
     * inside this effect.
     */
    if (!firebaseClient) {
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setState({
          status: "config-error",
          user: null,
          role: null,
          message:
            initializationError ??
            "Firebase could not initialize.",
        });
      });

      return () => {
        cancelled = true;
      };
    }

    const {
      auth,
      db,
    } = firebaseClient;

    const unsubscribeAuth =
      onAuthStateChanged(
        auth,
        (user) => {
          /*
           * Always dispose of the previous
           * staff-profile listener before
           * handling the new authentication state.
           */
          unsubscribeProfile?.();
          unsubscribeProfile =
            undefined;

          if (cancelled) {
            return;
          }

          /*
           * ---------------------------------------------------
           * SIGNED OUT
           * ---------------------------------------------------
           */
          if (!user) {
            setState({
              status: "ready",
              user: null,
              role: null,
              message: null,
            });

            return;
          }

          /*
           * ---------------------------------------------------
           * AUTHENTICATED USER
           * ---------------------------------------------------
           *
           * Authentication is complete.
           *
           * Authorization is resolved from:
           *
           * users/{uid}
           *
           * We retain the authenticated Firebase user while
           * the Firestore profile is being resolved.
           */
          setState({
            status: "loading",
            user,
            role: null,
            message:
              "Checking your staff profile…",
          });

          const profileRef =
            doc(
              db,
              "users",
              user.uid,
            );

          /*
           * Realtime profile listener.
           *
           * This is important because:
           *
           * 1. Google Auth can complete before signup writes
           *    users/{uid}.
           *
           * 2. Admin approval can happen later.
           *
           * 3. Role changes should appear without forcing
           *    the user to sign out and back in.
           */
          unsubscribeProfile =
            onSnapshot(
              profileRef,
              (snapshot) => {
                if (cancelled) {
                  return;
                }

                /*
                 * -------------------------------------------------
                 * PROFILE DOES NOT EXIST
                 * -------------------------------------------------
                 *
                 * This is different from "pending".
                 *
                 * No document means this Google account has
                 * authenticated successfully but has not yet
                 * completed staff registration.
                 */
                if (!snapshot.exists()) {
                  setState({
                    status: "ready",
                    user,
                    role: null,
                    message:
                      "Your Google account is authenticated, but no staff profile exists for this account yet.",
                  });

                  return;
                }

                const profile =
                  snapshot.data();

                const role: AppRole =
                  profile.role === "admin" ||
                  profile.role ===
                    "operations"
                    ? profile.role
                    : null;

                const status =
                  String(
                    profile.status ??
                      "",
                  ).toLowerCase();

                /*
                 * -------------------------------------------------
                 * ACCOUNT NOT APPROVED
                 * -------------------------------------------------
                 */
                if (
                  status !== "approved"
                ) {
                  if (
                    status === "pending"
                  ) {
                    setState({
                      status: "ready",
                      user,
                      role: null,
                      message:
                        "Your staff account is awaiting administrator approval.",
                    });

                    return;
                  }

                  setState({
                    status: "ready",
                    user,
                    role: null,
                    message:
                      "Your staff account is not approved for application access.",
                  });

                  return;
                }

                /*
                 * -------------------------------------------------
                 * APPROVED BUT INVALID ROLE
                 * -------------------------------------------------
                 */
                if (!role) {
                  setState({
                    status: "ready",
                    user,
                    role: null,
                    message:
                      "Your account has been approved, but no valid application role has been assigned.",
                  });

                  return;
                }

                /*
                 * -------------------------------------------------
                 * FULLY AUTHORIZED
                 * -------------------------------------------------
                 */
                setState({
                  status: "ready",
                  user,
                  role,
                  message: null,
                });
              },
              (error) => {
                console.error(
                  "Firebase staff profile listener failed:",
                  error,
                );

                if (cancelled) {
                  return;
                }

                setState({
                  status: "ready",
                  user,
                  role: null,
                  message:
                    error instanceof Error
                      ? `We could not verify your staff profile: ${error.message}`
                      : "We could not verify your staff profile. Please try again.",
                });
              },
            );
        },
      );

    return () => {
      cancelled = true;

      unsubscribeProfile?.();
      unsubscribeProfile =
        undefined;

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