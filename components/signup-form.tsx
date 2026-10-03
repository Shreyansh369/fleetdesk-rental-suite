"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import {
  useRouter,
} from "next/navigation";

import {
  useState,
  type FormEvent,
} from "react";

import {
  getFirebaseClient,
} from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
} from "@/lib/presentation";

type AuthMethod =
  | "choose"
  | "google"
  | "email";

type RequestedRole =
  | "admin"
  | "operations";

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

export function SignupForm() {
  const router = useRouter();

  const [method, setMethod] =
    useState<AuthMethod>("choose");

  const [googleUser, setGoogleUser] =
    useState<User | null>(null);

  const [fullName, setFullName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [mobile, setMobile] =
    useState("");

  const [age, setAge] =
    useState("");

  const [requestedRole, setRequestedRole] =
    useState<RequestedRole | "">("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string>();

  async function connectGoogle() {
    if (loading) {
      return;
    }

    setError(undefined);
    setLoading(true);

    try {
      const { auth } =
        getFirebaseClient();

      const provider =
        new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account",
      });

      const result =
        await signInWithPopup(
          auth,
          provider,
        );

      const user =
        result.user;

      if (!user.email) {
        await signOut(auth);

        throw new Error(
          "Google did not provide an email address.",
        );
      }

      setGoogleUser(user);

      setFullName(
        user.displayName?.trim() ??
          "",
      );

      setEmail(
        user.email
          .trim()
          .toLowerCase(),
      );

      setMethod("google");
    } catch (cause) {
      console.error(
        "Google registration failed:",
        cause,
      );

      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setLoading(false);
    }
  }

  async function createProfile(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError(undefined);
    setLoading(true);

    const cleanName =
      fullName.trim();

    const cleanEmail =
      email.trim().toLowerCase();

    const cleanMobile =
      mobile.trim();

    const numericAge =
      Number(age);

    let createdCredential:
      | Awaited<
          ReturnType<
            typeof createUserWithEmailAndPassword
          >
        >
      | undefined;

    try {
      if (cleanName.length < 2) {
        throw new Error(
          "Enter your full name.",
        );
      }

      if (
        cleanMobile.length < 7
      ) {
        throw new Error(
          "Enter a valid mobile number.",
        );
      }

      if (
        !Number.isInteger(
          numericAge,
        ) ||
        numericAge < 18 ||
        numericAge > 100
      ) {
        throw new Error(
          "Enter a valid age.",
        );
      }

      if (
        requestedRole !== "admin" &&
        requestedRole !== "operations"
      ) {
        throw new Error(
          "Select a requested role.",
        );
      }

      const {
        auth,
        db,
      } = getFirebaseClient();

      let uid: string;

      if (method === "google") {
        if (!googleUser) {
          throw new Error(
            "Connect your Google account first.",
          );
        }

        uid = googleUser.uid;

        if (
          googleUser.displayName !==
          cleanName
        ) {
          await updateProfile(
            googleUser,
            {
              displayName: cleanName,
            },
          );
        }
      } else {
        if (password.length < 8) {
          throw new Error(
            "Password must be at least 8 characters.",
          );
        }

        createdCredential =
          await createUserWithEmailAndPassword(
            auth,
            cleanEmail,
            password,
          );

        uid =
          createdCredential.user.uid;

        await updateProfile(
          createdCredential.user,
          {
            displayName: cleanName,
          },
        );
      }

      const profileRef =
        doc(
          db,
          "users",
          uid,
        );

      await runTransaction(
        db,
        async (transaction) => {
          const existing =
            await transaction.get(
              profileRef,
            );

          if (existing.exists()) {
            throw new Error(
              "A staff profile already exists for this account. Please sign in instead.",
            );
          }

          transaction.set(
            profileRef,
            {
              fullName:
                cleanName,

              email:
                method === "google"
                  ? googleUser?.email
                      ?.trim()
                      .toLowerCase() ??
                    cleanEmail
                  : cleanEmail,

              mobile:
                cleanMobile,

              age:
                numericAge,

              requestedRole,

              role: null,

              status: "pending",

              emailVerified:
                method === "google"
                  ? googleUser?.emailVerified ??
                    false
                  : false,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            },
          );
        },
      );

      /*
       * The application profile is now created.
       * Return to login so the staff member can enter
       * through the normal authorization flow.
       */
      await signOut(auth);

      router.replace("/login");
    } catch (cause) {
      console.error(
        "Staff registration failed:",
        cause,
      );

      /*
       * If the sign-in account was created in this attempt but
       * the staff profile was not, remove it again. Leaving it
       * behind would block every retry with "email already in
       * use" and there is no way for the applicant to clear it.
       */
      if (createdCredential) {
        try {
          await createdCredential.user.delete();
        } catch {
          // The account is signed out below either way.
        }
      }

      try {
        await getFirebaseClient()
          .auth
          .signOut();
      } catch {
        // Ignore cleanup failures.
      }

      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setLoading(false);
    }
  }

  async function cancelGoogle() {
    try {
      if (googleUser) {
        await getFirebaseClient()
          .auth
          .signOut();
      }
    } finally {
      setGoogleUser(null);
      setMethod("choose");
      setError(undefined);
    }
  }

  const showProfileForm =
    method === "google" ||
    method === "email";

  return (
    <main className="auth-page-clean">
      <section className="auth-visual auth-visual-register">
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
                Staff registration
              </span>
            </div>
          </div>
        </div>

        <div className="auth-visual-content">
          <p className="auth-visual-kicker">
            STAFF ONBOARDING
          </p>

          <h1>
            Join the
            <br />
            operations team.
          </h1>

          <p>
            Register securely, provide your
            staff details, and request the
            role that matches your work.
          </p>
        </div>

        <div className="auth-visual-footer">
          Secure staff onboarding
        </div>

        <div className="auth-visual-circle auth-visual-circle-one" />
        <div className="auth-visual-circle auth-visual-circle-two" />
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-card auth-register-card">
          {/*
           * The showcase panel is hidden below 980px, so the
           * registration card carries the branding on phones
           * and tablets exactly as the sign-in card does.
           */}
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
                Staff registration
              </span>
            </div>
          </div>

          <button
            type="button"
            className="auth-back-link"
            onClick={async () => {
              await cancelGoogle();
              router.push("/login");
            }}
          >
            <span aria-hidden="true">
              ←
            </span>
            Back to sign in
          </button>

          <p className="auth-eyebrow">
            CREATE ACCOUNT
          </p>

          <h2>
            Staff registration
          </h2>

          <p className="auth-form-intro">
            Choose how you want to create
            your staff account.
          </p>

          {error && (
            <div className="auth-inline-error">
              {error}
            </div>
          )}

          {!showProfileForm ? (
            <>
              <button
                type="button"
                className="google-outline-button"
                onClick={() =>
                  void connectGoogle()
                }
                disabled={loading}
              >
                <span>
                  <GoogleMark />

                  Continue with Google
                </span>

                <b aria-hidden="true">
                  →
                </b>
              </button>

              <div className="auth-divider">
                <span />
                <small>
                  OR USE EMAIL
                </small>
                <span />
              </div>

              <button
                type="button"
                className="auth-primary-button auth-choice-button"
                onClick={() =>
                  setMethod("email")
                }
              >
                Continue with email
                <span aria-hidden="true">
                  →
                </span>
              </button>

              <p className="auth-small-note">
                Google automatically provides
                your account name and email.
              </p>
            </>
          ) : (
            <>
              <div className="auth-mode-bar">
                <span>
                  {method === "google"
                    ? "Google account connected"
                    : "Email registration"}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    method === "google"
                      ? void cancelGoogle()
                      : setMethod("choose")
                  }
                >
                  Change
                </button>
              </div>

              <form
                className="auth-clean-form auth-register-form"
                onSubmit={(event) =>
                  void createProfile(
                    event,
                  )
                }
              >
                {method ===
                  "google" && (
                  <label>
                    Google account
                    <input
                      type="email"
                      value={email}
                      readOnly
                      className="auth-readonly-input"
                    />
                  </label>
                )}

                {method ===
                  "email" && (
                  <label>
                    Email address
                    <input
                      type="email"
                      value={email}
                      onChange={(
                        event,
                      ) =>
                        setEmail(
                          event.target
                            .value,
                        )
                      }
                      placeholder="name@company.com"
                      autoComplete="email"
                      required
                    />
                  </label>
                )}

                <label>
                  Full name
                  <input
                    type="text"
                    value={fullName}
                    onChange={(
                      event,
                    ) =>
                      setFullName(
                        event.target
                          .value,
                      )
                    }
                    placeholder="Your full name"
                    autoComplete="name"
                    required
                  />
                </label>

                {method ===
                  "email" && (
                  <label>
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(
                        event,
                      ) =>
                        setPassword(
                          event.target
                            .value,
                        )
                      }
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </label>
                )}

                <div className="auth-two-fields">
                  <label>
                    Mobile number
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(
                        event,
                      ) =>
                        setMobile(
                          event.target
                            .value,
                        )
                      }
                      placeholder="+91..."
                      autoComplete="tel"
                      required
                    />
                  </label>

                  <label>
                    Age
                    <input
                      type="number"
                      min={18}
                      max={100}
                      value={age}
                      onChange={(
                        event,
                      ) =>
                        setAge(
                          event.target
                            .value,
                        )
                      }
                      placeholder="18+"
                      required
                    />
                  </label>
                </div>

                <label>
                  Requested role
                  <select
                    value={
                      requestedRole
                    }
                    onChange={(
                      event,
                    ) =>
                      setRequestedRole(
                        event.target
                          .value as
                          | RequestedRole
                          | "",
                      )
                    }
                    required
                  >
                    <option value="">
                      Select a role
                    </option>

                    <option value="operations">
                      Operations
                    </option>

                    <option value="admin">
                      Administrator
                    </option>
                  </select>
                </label>

                <button
                  type="submit"
                  className="auth-primary-button"
                  disabled={loading}
                >
                  {loading
                    ? "Creating account..."
                    : "Create staff account"}

                  <span aria-hidden="true">
                    →
                  </span>
                </button>
              </form>

              <p className="auth-small-note">
                New accounts require
                administrator approval.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}