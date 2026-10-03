"use client";

import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";

import {
  useEffect,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import { firebaseErrorMessage } from "@/lib/presentation";
import { getFirebaseClient } from "@/lib/firebase/client";

import { useFirebaseAuth } from "./firebase-provider";

function GoogleMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M21.35 12.23c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z"
      />
      <path
        fill="#34A853"
        d="M12 21.63c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.63Z"
      />
      <path
        fill="#FBBC05"
        d="M6.54 13.71A5.85 5.85 0 0 1 6.23 12c0-.59.11-1.17.31-1.71V7.76H3.3A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.06 1.05 4.24l3.24-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.26c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.35 14.63 2.37 12 2.37a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53c.77-2.31 2.92-4.03 5.46-4.03Z"
      />
    </svg>
  );
}

export function LoginForm() {
  const auth = useFirebaseAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [loading, setLoading] =
    useState(false);

  const [googleLoading, setGoogleLoading] =
    useState(false);

  const [signingOut, setSigningOut] =
    useState(false);

  /*
   * ---------------------------------------------------------
   * GOOGLE SIGN-IN
   * ---------------------------------------------------------
   */
  async function signInWithGoogle() {
    if (
      loading ||
      googleLoading
    ) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setGoogleLoading(true);

    try {
      const {
        auth: firebaseAuth,
      } = getFirebaseClient();

      const provider =
        new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account",
      });

      await signInWithPopup(
        firebaseAuth,
        provider,
      );

      /*
       * FirebaseProvider observes the authenticated user
       * and resolves users/{uid}.
       */
    } catch (cause) {
      console.error(
        "Google sign-in failed:",
        cause,
      );

      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause
      ) {
        const code = String(
          (
            cause as {
              code?: unknown;
            }
          ).code ?? "",
        );

        switch (code) {
          case "auth/popup-closed-by-user":
            setError(
              "Google sign-in was cancelled.",
            );
            break;

          case "auth/popup-blocked":
            setError(
              "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
            );
            break;

          case "auth/cancelled-popup-request":
            setError(
              "Another Google sign-in request is already in progress.",
            );
            break;

          case "auth/operation-not-allowed":
            setError(
              "Google sign-in is not enabled in Firebase Authentication.",
            );
            break;

          case "auth/unauthorized-domain":
            setError(
              "This domain is not authorized for Google sign-in in Firebase.",
            );
            break;

          case "auth/account-exists-with-different-credential":
            setError(
              "An account already exists with this email using another sign-in method.",
            );
            break;

          default:
            setError(
              firebaseErrorMessage(cause),
            );
            break;
        }
      } else {
        setError(
          firebaseErrorMessage(cause),
        );
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * EMAIL / PASSWORD SIGN-IN
   * ---------------------------------------------------------
   */
  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      loading ||
      googleLoading
    ) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(
        getFirebaseClient().auth,
        email.trim().toLowerCase(),
        password,
      );

      /*
       * Do not navigate here.
       * FirebaseProvider resolves the user's Firestore
       * profile and role.
       */
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * PASSWORD RESET
   * ---------------------------------------------------------
   */
  async function resetPassword() {
    const cleanEmail =
      email.trim().toLowerCase();

    setError(undefined);
    setNotice(undefined);

    if (!cleanEmail) {
      setError(
        "Enter your email address first.",
      );
      return;
    }

    try {
      await sendPasswordResetEmail(
        getFirebaseClient().auth,
        cleanEmail,
      );

      setNotice(
        "Password reset email sent. Check your inbox.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * APPROVED USER -> DASHBOARD
   * ---------------------------------------------------------
   */
  useEffect(() => {
    if (
      auth.status !== "ready" ||
      !auth.user
    ) {
      return;
    }

    if (auth.role) {
      router.replace("/");
    }
  }, [
    auth.status,
    auth.user,
    auth.role,
    router,
  ]);

  /*
   * ---------------------------------------------------------
   * FIREBASE CONFIGURATION ERROR
   * ---------------------------------------------------------
   */
  if (
    auth.status === "config-error"
  ) {
    return (
      <main className="auth-page-clean auth-status-page">
        <section className="auth-status-card">
          <img
            src="/brand/logo.svg"
            alt="FleetDesk"
            className="auth-status-logo"
          />

          <p className="auth-eyebrow">
            CONFIGURATION
          </p>

          <h1>
            Connect Firebase to continue
          </h1>

          <p>
            {auth.message}
          </p>
        </section>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * AUTH / PROFILE LOADING
   * ---------------------------------------------------------
   */
  if (
    auth.status === "loading"
  ) {
    return (
      <main className="auth-page-clean auth-status-page">
        <div className="auth-progress">
          <span className="auth-progress-dot" />
          {auth.message ??
            "Checking your account"}
        </div>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED BUT NOT AUTHORIZED
   * ---------------------------------------------------------
   */
  if (
    auth.status === "ready" &&
    auth.user &&
    !auth.role
  ) {
    async function signOutCurrentAccount() {
      if (signingOut) {
        return;
      }

      setSigningOut(true);
      setError(undefined);
      setNotice(undefined);

      try {
        await getFirebaseClient()
          .auth
          .signOut();

        window.location.replace(
          "/login",
        );
      } catch (cause) {
        console.error(
          "Sign out failed:",
          cause,
        );

        setSigningOut(false);

        setError(
          firebaseErrorMessage(cause),
        );
      }
    }

    const message =
      auth.message ?? "";

    const normalizedMessage =
      message.toLowerCase();

    const registrationRequired =
      normalizedMessage.includes(
        "no staff profile",
      ) ||
      normalizedMessage.includes(
        "staff profile does not exist",
      ) ||
      normalizedMessage.includes(
        "staff profile has not been created",
      );

    const pendingApproval =
      normalizedMessage.includes(
        "awaiting administrator approval",
      );

    const invalidRole =
      normalizedMessage.includes(
        "no valid application role",
      );

    return (
      <main className="auth-page-clean auth-status-page">
        <section className="auth-status-card">
          <img
            src="/brand/logo.svg"
            alt="FleetDesk"
            className="auth-status-logo"
          />

          <p className="auth-eyebrow">
            {registrationRequired
              ? "REGISTRATION"
              : pendingApproval
                ? "ACCESS PENDING"
                : "ACCESS REVIEW"}
          </p>

          <h1>
            {registrationRequired
              ? "Complete your staff registration"
              : pendingApproval
                ? "Account awaiting approval"
                : invalidRole
                  ? "Role assignment required"
                  : "Staff access unavailable"}
          </h1>

          <p>
            {registrationRequired
              ? "Your Google account is authenticated, but it is not registered as a staff account yet."
              : pendingApproval
                ? "Your staff profile has been submitted and is waiting for administrator approval."
                : invalidRole
                  ? "Your account has been approved, but an Administrator or Operations role has not been assigned."
                  : message ||
                    "Your account does not currently have access to the rental workspace."}
          </p>

          {error && (
            <div
              className="auth-inline-error"
              role="alert"
            >
              {error}
            </div>
          )}

          {registrationRequired && (
            <button
              type="button"
              className="auth-primary-small"
              onClick={() =>
                router.push("/signup")
              }
            >
              <span>
                Complete registration
              </span>

              <span aria-hidden="true">
                →
              </span>
            </button>
          )}

          <button
            type="button"
            className="auth-secondary-button"
            onClick={() =>
              void signOutCurrentAccount()
            }
            disabled={signingOut}
          >
            {signingOut
              ? "Signing out..."
              : "Sign out"}
          </button>
        </section>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * APPROVED USER
   * ---------------------------------------------------------
   */
  if (
    auth.status === "ready" &&
    auth.user &&
    auth.role
  ) {
    return (
      <main className="auth-page-clean auth-status-page">
        <div
          className="auth-progress"
          role="status"
          aria-live="polite"
        >
          <span className="auth-progress-dot" />
          Opening rental workspace
        </div>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * LOGIN SCREEN
   * ---------------------------------------------------------
   */
  return (
    <main className="auth-page-clean">
      <section className="auth-visual">
        <div className="auth-visual-top">
          <div className="auth-brand">
            <img
              src="/brand/logo.svg"
              alt="FleetDesk"
              className="auth-brand-logo"
            />

            <div>
              <strong>
                FleetDesk
              </strong>

              <span>
                Rental management platform
              </span>
            </div>
          </div>
        </div>

        <div className="auth-visual-content">
          <p className="auth-visual-kicker">
            OPERATIONS WORKSPACE
          </p>

          <h1>
            Everything your
            <br />
            fleet needs.
          </h1>

          <p>
            Vehicles, customers, bookings,
            returns and financial activity —
            organized in one workspace.
          </p>
        </div>

        <div className="auth-visual-footer">
          FleetDesk
        </div>

        <div className="auth-visual-circle auth-visual-circle-one" />
        <div className="auth-visual-circle auth-visual-circle-two" />
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-mobile-brand">
            <img
              src="/brand/logo.svg"
              alt="FleetDesk"
              className="auth-brand-logo"
            />

            <div>
              <strong>
                FleetDesk
              </strong>

              <span>
                Rental management
              </span>
            </div>
          </div>

          <p className="auth-eyebrow">
            STAFF SIGN IN
          </p>

          <h2>
            Welcome back
          </h2>

          <p className="auth-form-intro">
            Sign in to access your rental
            operations workspace.
          </p>

          {error && (
            <div
              className="auth-inline-error"
              role="alert"
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              className="auth-inline-success"
              role="status"
            >
              {notice}
            </div>
          )}

          <button
            type="button"
            className="google-outline-button"
            onClick={() =>
              void signInWithGoogle()
            }
            disabled={
              loading ||
              googleLoading
            }
          >
            <span>
              <GoogleMark />

              {googleLoading
                ? "Connecting..."
                : "Continue with Google"}
            </span>

            <b aria-hidden="true">
              →
            </b>
          </button>

          <div className="auth-divider">
            <span />
            <small>
              OR SIGN IN WITH EMAIL
            </small>
            <span />
          </div>

          <form
            className="auth-clean-form"
            onSubmit={(event) =>
              void submit(event)
            }
          >
            <label>
              Email address

              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                placeholder="name@company.com"
                required
              />
            </label>

            <label>
              <span className="auth-label-row">
                <span>
                  Password
                </span>

                <button
                  type="button"
                  onClick={() =>
                    void resetPassword()
                  }
                >
                  Forgot password?
                </button>
              </span>

              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                placeholder="Enter your password"
                required
              />
            </label>

            <button
              type="submit"
              className="auth-primary-button"
              disabled={
                loading ||
                googleLoading
              }
            >
              <span>
                {loading
                  ? "Signing in..."
                  : "Sign in"}
              </span>

              <span aria-hidden="true">
                →
              </span>
            </button>
          </form>

          <div className="auth-divider auth-divider-small">
            <span />
            <small>
              NEW STAFF
            </small>
            <span />
          </div>

          <button
            type="button"
            className="auth-secondary-button"
            onClick={() =>
              router.push("/signup")
            }
          >
            Create staff account
          </button>

          <p className="auth-small-note">
            Access is subject to
            administrator approval.
          </p>
        </div>
      </section>
    </main>
  );
}