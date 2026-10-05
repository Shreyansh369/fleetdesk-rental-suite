"use client";

import Link from "next/link";

import {
  Download,
  FlaskConical,
  Hourglass,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { getLocalBackend } from "@/lib/data/local-backend";
import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";
import {
  addDemoStaffRequest,
  demoHasVehicles,
  exportDemoWorkspace,
  listDemoProfiles,
  loadDemoSampleData,
  resetDemoWorkspace,
  switchDemoProfile,
  type DemoProfile,
} from "@/lib/demo/demo-workspace";
import {
  LICENCE_PRICE_CENTS,
  formatUsd,
  licenceStatus,
} from "@/lib/license";

import { useFirebaseAuth } from "./firebase-provider";
import { useMinuteClock } from "./protected-page";

/*
 * The strip above every screen that says what kind of workspace
 * this is: the demo, with the tools that only make sense there,
 * or a trial counting down to its last day. A paid workspace
 * shows nothing.
 */
export function WorkspaceBanner() {
  const auth = useFirebaseAuth();
  const now = useMinuteClock();

  if (auth.mode === "demo") {
    return <DemoBar />;
  }

  if (!auth.workspace) {
    return null;
  }

  const licence = licenceStatus(auth.workspace, now);

  if (licence.state !== "trial") {
    return null;
  }

  const ends = licence.trialEndsAt.toLocaleString(
    undefined,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  );

  return (
    <div
      className={`workspace-banner is-trial ${
        licence.daysLeft <= 2 ? "is-urgent" : ""
      }`}
      role="status"
    >
      <Hourglass size={17} />

      <span>
        <strong>
          Free trial —{" "}
          {licence.daysLeft === 1
            ? "last day"
            : `${licence.daysLeft} days left`}
        </strong>{" "}
        <span className="workspace-banner-detail">
          Ends {ends}.
        </span>
      </span>

      {auth.role === "admin" && (
        <Link
          className="button button-primary workspace-banner-action"
          href="/billing"
        >
          Buy licence · {formatUsd(LICENCE_PRICE_CENTS)}
        </Link>
      )}
    </div>
  );
}

function DemoBar() {
  const auth = useFirebaseAuth();

  const [profiles, setProfiles] = useState<
    DemoProfile[]
  >([]);
  const [empty, setEmpty] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(
    null,
  );

  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<
    "operations" | "admin"
  >("operations");

  const refresh = useCallback(async () => {
    const [list, hasVehicles] = await Promise.all([
      listDemoProfiles(),
      demoHasVehicles(),
    ]);

    setProfiles(list);
    setEmpty(!hasVehicles);
  }, []);

  useEffect(() => {
    const { db } = getLocalBackend();

    queueMicrotask(() => void refresh());

    return db.subscribe(() => void refresh());
  }, [refresh]);

  async function run(
    label: string,
    work: () => Promise<unknown>,
  ) {
    setBusy(label);
    setError(null);

    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That did not work. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function addStaff(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    await run("staff", async () => {
      await addDemoStaffRequest({
        fullName: staffName,
        email: staffEmail,
        requestedRole: staffRole,
      });

      setStaffName("");
      setStaffEmail("");
    });
  }

  async function download() {
    const blob = await exportDemoWorkspace();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `fleetdesk-demo-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function leaveDemo(next: string) {
    void getLocalBackend().db.flush().finally(() => {
      setBackendMode(
        next === "/trial" ? "live" : null,
      );
      reloadInto(next);
    });
  }

  const currentUid = auth.user?.uid ?? "";

  return (
    <div className="workspace-banner is-demo">
      <div className="demo-bar-row">
        <FlaskConical size={17} />

        <span className="demo-bar-label">
          <strong>Demo</strong>
          <span className="workspace-banner-detail">
            Everything you enter stays in this browser.
          </span>
        </span>

        <label className="demo-bar-viewer">
          <span>Viewing as</span>
          <select
            value={currentUid}
            disabled={Boolean(busy)}
            onChange={(event) =>
              void run("switch", () =>
                switchDemoProfile(event.target.value),
              )
            }
          >
            {profiles.map((profile) => (
              <option
                key={profile.uid}
                value={profile.uid}
              >
                {profile.fullName} —{" "}
                {profile.status !== "approved"
                  ? profile.status || "not approved"
                  : profile.role === "admin"
                    ? "Administrator"
                    : "Operations"}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="button button-secondary demo-bar-tools"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((open) => !open)}
        >
          {toolsOpen ? (
            <X size={16} />
          ) : (
            <Wrench size={16} />
          )}
          Demo tools
        </button>

        {liveBackendAvailable() && (
          <button
            type="button"
            className="button button-primary demo-bar-trial"
            onClick={() => leaveDemo("/trial")}
          >
            Start 7-day free trial
          </button>
        )}
      </div>

      {empty && !toolsOpen && (
        <div className="demo-bar-hint">
          <span>
            Your demo is empty — add your own vehicles
            and customers, or
          </span>
          <button
            type="button"
            className="link-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("sample", () =>
                loadDemoSampleData(),
              )
            }
          >
            {busy === "sample"
              ? "loading a sample business…"
              : "load a sample business to explore"}
          </button>
        </div>
      )}

      {toolsOpen && (
        <div className="demo-tools">
          <section>
            <h3>Sample data</h3>
            <p>
              A fictional rental business: 14
              vehicles, 18 customers, six months of
              history and today&apos;s bookings.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={!empty || Boolean(busy)}
              onClick={() =>
                void run("sample", () =>
                  loadDemoSampleData(),
                )
              }
            >
              {busy === "sample" ? (
                <LoaderCircle
                  size={16}
                  className="spin"
                />
              ) : (
                <Sparkles size={16} />
              )}
              {empty
                ? "Load sample business"
                : "Reset first to load samples"}
            </button>
          </section>

          <section>
            <h3>Add a staff member</h3>
            <p>
              In a real workspace colleagues sign up
              from your invite link. Here, add one, then
              approve them on the Staff screen and view
              the workspace as them.
            </p>
            <form
              className="demo-staff-form"
              onSubmit={(event) => void addStaff(event)}
            >
              <input
                placeholder="Full name"
                value={staffName}
                onChange={(event) =>
                  setStaffName(event.target.value)
                }
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={staffEmail}
                onChange={(event) =>
                  setStaffEmail(event.target.value)
                }
                required
              />
              <select
                value={staffRole}
                onChange={(event) =>
                  setStaffRole(
                    event.target.value as
                      | "operations"
                      | "admin",
                  )
                }
              >
                <option value="operations">
                  Operations
                </option>
                <option value="admin">
                  Administrator
                </option>
              </select>
              <button
                type="submit"
                className="button button-secondary"
                disabled={Boolean(busy)}
              >
                <UserPlus size={16} />
                Add request
              </button>
            </form>
          </section>

          <section>
            <h3>Your demo data</h3>
            <p>
              Keep a copy of what you entered, or start
              again from an empty workspace.
            </p>
            <div className="demo-tools-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void download()}
              >
                <Download size={16} />
                Download a copy
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={Boolean(busy)}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete everything in this demo and start again empty?",
                    )
                  ) {
                    void run("reset", () =>
                      resetDemoWorkspace(),
                    );
                  }
                }}
              >
                <RotateCcw size={16} />
                Reset demo
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => leaveDemo("/welcome")}
              >
                Exit demo
              </button>
            </div>
          </section>
        </div>
      )}

      {error && (
        <p className="form-error demo-bar-error">
          {error}
        </p>
      )}
    </div>
  );
}
