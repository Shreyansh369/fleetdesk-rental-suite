"use client";

import Link from "next/link";

import { signOut } from "@/lib/data/auth";

import {
  useRouter,
} from "next/navigation";

import {
  useEffect,
  useState,
} from "react";

import {
  Building2,
  ShieldAlert,
} from "lucide-react";

import {
  getFirebaseClient,
} from "@/lib/firebase/client";

import { backendModeChosen } from "@/lib/data/mode";
import { DEMO_OWNER_UID } from "@/lib/data/local-backend";
import { switchDemoProfile } from "@/lib/demo/demo-workspace";
import { licenceStatus } from "@/lib/license";

import {
  useFirebaseAuth,
} from "./firebase-provider";

import { LicencePaywall } from "./licence-paywall";

/*
 * The current time, refreshed every minute, so a trial that
 * runs out while the workspace is open closes on screen at the
 * same moment the rules close it on the server.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(
    () => new Date(),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setNow(new Date()),
      60_000,
    );

    return () => clearInterval(timer);
  }, []);

  return now;
}

export function ProtectedPage({
  children,
  allowExpired = false,
}: {
  children: React.ReactNode;
  /* Billing stays open after a trial ends: it is how to pay. */
  allowExpired?: boolean;
}) {
  const auth =
    useFirebaseAuth();

  const router =
    useRouter();

  const now = useMinuteClock();

  /*
   * A first visit — no choice yet between trying the demo and
   * signing in — goes to the welcome page rather than to a
   * sign-in form for an account the visitor does not have.
   */
  const [modeChosen, setModeChosen] =
    useState<boolean | null>(null);

  useEffect(() => {
    const chosen = backendModeChosen();

    queueMicrotask(() => setModeChosen(chosen));

    if (!chosen) {
      router.replace("/welcome");
    }
  }, [router]);

  /*
   * Only redirect to login when Firebase has
   * definitively resolved that there is no user.
   */
  useEffect(() => {
    if (
      modeChosen &&
      auth.status === "ready" &&
      !auth.user
    ) {
      router.replace(
        auth.mode === "demo"
          ? "/welcome"
          : "/login",
      );
    }
  }, [
    modeChosen,
    auth.status,
    auth.user,
    auth.mode,
    router,
  ]);

  async function backToSignIn() {
    try {
      await signOut(
        getFirebaseClient().auth,
      );
    } finally {
      router.replace("/login");
    }
  }

  if (modeChosen === false) {
    return (
      <div className="page-loader">
        <span className="loader-dot" />
        Opening FleetDesk…
      </div>
    );
  }

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
    modeChosen === null ||
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
   * Signed in to an account that has neither started a trial
   * nor joined one from an invite link.
   */
  if (auth.noWorkspace) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-symbol">
            <Building2 />
          </div>

          <p className="page-kicker">
            No workspace yet
          </p>

          <h1>
            This account is not in a workspace
          </h1>

          <p>
            {auth.message}
          </p>

          <Link
            className="button button-primary"
            href="/trial"
          >
            Start a free trial
          </Link>

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

  const licence =
    auth.workspace
      ? licenceStatus(
          auth.workspace,
          now,
        )
      : null;

  /*
   * The trial is over and unpaid. Checked before the role,
   * because an approved administrator and a pending colleague
   * both need to know the same thing first.
   */
  if (
    licence?.state === "expired" &&
    !(allowExpired && auth.role === "admin")
  ) {
    return (
      <LicencePaywall
        workspace={auth.workspace!}
        isAdmin={auth.role === "admin"}
        paymentSubmitted={
          licence.paymentSubmitted
        }
      />
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

          {auth.mode === "demo" ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() =>
                void switchDemoProfile(
                  DEMO_OWNER_UID,
                )
              }
            >
              View the demo as the administrator
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                void backToSignIn()
              }
            >
              Back to sign in
            </button>
          )}
        </section>
      </main>
    );
  }

  /*
   * Authenticated + approved + valid role.
   */
  return <>{children}</>;
}
