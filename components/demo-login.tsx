"use client";

import {
  useRouter,
} from "next/navigation";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  ArrowRight,
  Copy,
  Info,
  Lock,
} from "@/components/icons";

import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import {
  signInToDemo,
} from "@/lib/demo/demo-workspace";
import {
  DEMO_PASSWORD,
  SAMPLE_STAFF,
} from "@/lib/demo/sample-data";

import { useFirebaseAuth } from "./firebase-provider";
import { LegalFooter } from "./legal-footer";

/*
 * Sign-in for the demo. It looks and behaves like the real
 * sign-in, but the accounts are published on the page and are
 * checked against this browser's demo data; no request leaves
 * the device.
 */
export function DemoLogin() {
  const auth = useFirebaseAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setLive(liveBackendAvailable()));
  }, []);

  useEffect(() => {
    if (auth.status === "ready" && auth.user) {
      router.replace("/");
    }
  }, [auth.status, auth.user, router]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await signInToDemo(email, password);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign-in failed.",
      );
      setBusy(false);
    }
  }

  function choose(account: string) {
    setEmail(account);
    setPassword(DEMO_PASSWORD);
    setError(undefined);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(DEMO_PASSWORD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The password is printed beside the button anyway.
    }
  }

  return (
    <div className="entry">
      <header className="entry-bar">
        <a className="entry-brand" href="/welcome">
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
          />
          <span>FleetDesk</span>
        </a>

        <span className="entry-tag">Demo</span>
      </header>

      <main className="entry-main">
        <section className="entry-panel">
          <h1>Sign in to the demo</h1>
          <p className="entry-intro">
            Pick an account to see the workspace as that
            person. Everything you enter is saved in this
            browser only.
          </p>

          <form
            className="entry-form"
            onSubmit={(event) => void submit(event)}
          >
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                autoComplete="username"
                placeholder="demo.admin@gmail.com"
                required
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                required
              />
            </label>

            {error && (
              <p className="entry-error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="button button-primary entry-submit"
              disabled={busy}
            >
              {busy ? "Signing in" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>

          {live && (
            <p className="entry-switch">
              Already have a trial or a licence?{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setBackendMode("live");
                  reloadInto("/login");
                }}
              >
                Sign in to your workspace
              </button>
            </p>
          )}
        </section>

        <section
          className="entry-accounts"
          aria-labelledby="demo-accounts-heading"
        >
          <div className="entry-accounts-head">
            <h2 id="demo-accounts-heading">
              Demo accounts
            </h2>

            <p>
              <Lock size={15} />
              Password for every account:{" "}
              <code>{DEMO_PASSWORD}</code>
              <button
                type="button"
                className="link-button"
                onClick={() => void copyPassword()}
              >
                <Copy size={14} />
                {copied ? "Copied" : "Copy"}
              </button>
            </p>
          </div>

          <table className="entry-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="sr-only">Use</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_STAFF.map((member) => (
                <tr key={member.key}>
                  <td>
                    <strong>{member.email}</strong>
                    <span>
                      {member.fullName}, {member.title}
                    </span>
                  </td>
                  <td>
                    {member.status === "pending"
                      ? "Awaiting approval"
                      : member.role === "admin"
                        ? "Administrator"
                        : "Operations"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary compact"
                      onClick={() => choose(member.email)}
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="entry-note">
            <Info size={15} />
            Administrators see Finance, Staff and
            Billing. Operations accounts run bookings,
            customers, the fleet and expenses. Sign in as
            an administrator to approve the new hire.
          </p>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}
