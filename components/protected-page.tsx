"use client";

import {
  signOut,
} from "firebase/auth";

import {
  useRouter,
} from "next/navigation";

import {
  useEffect,
} from "react";

import {
  ShieldAlert,
} from "lucide-react";

import {
  getFirebaseClient,
} from "@/lib/firebase/client";

import {
  useFirebaseAuth,
} from "./firebase-provider";

export function ProtectedPage({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth =
    useFirebaseAuth();

  const router =
    useRouter();

  /*
   * Only redirect to login when Firebase has
   * definitively resolved that there is no user.
   */
  useEffect(() => {
    if (
      auth.status === "ready" &&
      !auth.user
    ) {
      router.replace("/login");
    }
  }, [
    auth.status,
    auth.user,
    router,
  ]);

  /*
   * Firebase configuration is invalid.
   */
  if (
    auth.status ===
    "config-error"
  ) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-symbol">
            <ShieldAlert />
          </div>

          <p className="page-kicker">
            Configuration needed
          </p>

          <h1>
            Connect Firebase to continue
          </h1>

          <p>
            {auth.message}
          </p>

          <p className="quiet">
            Check the Firebase
            environment configuration
            before continuing.
          </p>
        </section>
      </main>
    );
  }

  /*
   * Authentication and Firestore profile
   * are still being resolved.
   */
  if (
    auth.status === "loading"
  ) {
    return (
      <div className="page-loader">
        <span className="loader-dot" />
        Loading workspace
      </div>
    );
  }

  /*
   * Firebase has resolved a signed-out
   * state. The effect above performs the
   * actual navigation.
   */
  if (!auth.user) {
    return (
      <div className="page-loader">
        <span className="loader-dot" />
        Opening sign in…
      </div>
    );
  }

  /*
   * Authenticated but not authorized.
   *
   * Do not redirect automatically.
   * The user needs to see why access is
   * unavailable and choose when to sign out.
   */
  if (!auth.role) {
    async function backToSignIn() {
      try {
        await signOut(
          getFirebaseClient().auth,
        );
      } finally {
        router.replace("/login");
      }
    }

    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-symbol">
            <ShieldAlert />
          </div>

          <p className="page-kicker">
            Access pending
          </p>

          <h1>
            Your account is not assigned
          </h1>

          <p>
            Sign-in succeeded, but this
            account has not been assigned
            an Operations or Administrator
            role yet.
          </p>

          <p className="quiet">
            {auth.message ??
              "Ask an administrator to approve your account and assign a role, then sign in again."}
          </p>

          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void backToSignIn()
            }
          >
            Back to sign in
          </button>
        </section>
      </main>
    );
  }

  /*
   * Authenticated + approved + valid role.
   */
  return <>{children}</>;
}