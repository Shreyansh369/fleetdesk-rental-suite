"use client";

import {
  BadgeCheck,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UserRoundX,
  X,
} from "lucide-react";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { AppShell } from "./app-shell";

import { useFirebaseAuth } from "./firebase-provider";

import {
  firebaseErrorMessage,
  formatDate,
} from "@/lib/presentation";

import {
  changeStaffRole,
  decideStaffAccess,
  listStaff,
  removeStaffMember,
  updateStaffProfile,
  type StaffMember,
  type StaffRole,
  type StaffStatus,
} from "@/lib/services/staff-directory";

const STATUS_LABEL: Record<
  StaffStatus,
  string
> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Declined",
  suspended: "Suspended",
};

function roleLabel(
  role: StaffRole | null,
): string {
  if (role === "admin") {
    return "Administrator";
  }

  if (role === "operations") {
    return "Operations";
  }

  return "No role";
}

function formatMoment(
  value: string | null,
): string {
  return value
    ? formatDate(value, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not recorded";
}

export function StaffDirectory() {
  const { role, user } = useFirebaseAuth();

  const [members, setMembers] = useState<
    StaffMember[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  /** Role chosen for each pending applicant. */
  const [choices, setChoices] = useState<
    Record<string, StaffRole>
  >({});

  const [notes, setNotes] = useState<
    Record<string, string>
  >({});

  /** The account currently being written. */
  const [busyUid, setBusyUid] = useState<
    string | null
  >(null);

  const [filter, setFilter] = useState<
    "pending" | "all"
  >("pending");

  const [reloadToken, setReloadToken] =
    useState(0);

  /*
   * A name typed wrong at registration follows the account
   * onto every rental it books, so an administrator has to be
   * able to correct it. Role and status are not edited here:
   * those are access decisions with their own controls and
   * their own audit entries.
   */
  const [editing, setEditing] = useState<{
    uid: string;
    fullName: string;
    mobile: string;
    age: string;
  } | null>(null);

  /*
   * Removal is irreversible, so the row asks for a second
   * click rather than deleting on the first one — the same
   * pattern the customers screen uses.
   */
  const [pendingRemovalUid, setPendingRemovalUid] =
    useState<string | null>(null);

  /*
   * A decision changes the queue, so the screen re-reads it
   * rather than editing the row in place: what is listed is
   * always what Firestore holds.
   */
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    /*
     * A non-administrator never reaches the table, so there
     * is nothing to load: the screen below returns before
     * `loading` is read.
     */
    if (role !== "admin") {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const staff = await listStaff();

        if (cancelled) {
          return;
        }

        setMembers(staff);

        setChoices((current) => {
          const next = { ...current };

          for (const member of staff) {
            next[member.uid] ??=
              member.requestedRole ??
              member.role ??
              "operations";
          }

          return next;
        });

        setError(undefined);
      } catch (cause) {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadToken, role]);

  async function approve(member: StaffMember) {
    if (busyUid) {
      return;
    }

    setBusyUid(member.uid);
    setError(undefined);
    setNotice(undefined);

    try {
      const chosen =
        choices[member.uid] ??
        member.requestedRole ??
        "operations";

      await decideStaffAccess({
        outcome: "approve",
        uid: member.uid,
        role: chosen,
        note: notes[member.uid] ?? null,
      });

      reload();

      setNotice(
        `${member.fullName} can now sign in as ${roleLabel(
          chosen,
        ).toLowerCase()}.`,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyUid(null);
    }
  }

  async function refuse(
    member: StaffMember,
    outcome: "reject" | "suspend",
  ) {
    if (busyUid) {
      return;
    }

    setBusyUid(member.uid);
    setError(undefined);
    setNotice(undefined);

    try {
      await decideStaffAccess({
        outcome,
        uid: member.uid,
        note: notes[member.uid] ?? null,
      });

      reload();

      setNotice(
        outcome === "reject"
          ? `${member.fullName}'s request was declined.`
          : `${member.fullName} no longer has access.`,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyUid(null);
    }
  }

  function startEdit(member: StaffMember) {
    setError(undefined);
    setNotice(undefined);

    setEditing({
      uid: member.uid,
      fullName: member.fullName,
      mobile: member.mobile ?? "",
      age:
        member.age === null
          ? ""
          : String(member.age),
    });
  }

  async function saveEdit() {
    if (!editing || busyUid) {
      return;
    }

    setBusyUid(editing.uid);
    setError(undefined);
    setNotice(undefined);

    try {
      await updateStaffProfile({
        uid: editing.uid,

        fullName: editing.fullName,

        mobile:
          editing.mobile.trim() || null,

        age:
          editing.age.trim() === ""
            ? null
            : Number(editing.age),
      });

      const saved = editing.fullName.trim();

      setEditing(null);

      reload();

      setNotice(
        `${saved}'s details were updated.`,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyUid(null);
    }
  }

  async function remove(member: StaffMember) {
    if (busyUid) {
      return;
    }

    setBusyUid(member.uid);
    setError(undefined);
    setNotice(undefined);

    try {
      await removeStaffMember({
        uid: member.uid,
      });

      setPendingRemovalUid(null);

      if (
        editing?.uid === member.uid
      ) {
        setEditing(null);
      }

      reload();

      setNotice(
        `${member.fullName} was removed. Their sign-in account still exists and can register again; delete it in the Firebase console to stop that.`,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyUid(null);
    }
  }

  async function reassign(
    member: StaffMember,
    next: StaffRole,
  ) {
    if (busyUid || next === member.role) {
      return;
    }

    setBusyUid(member.uid);
    setError(undefined);
    setNotice(undefined);

    try {
      await changeStaffRole({
        uid: member.uid,
        role: next,
      });

      reload();

      setNotice(
        `${member.fullName} is now ${roleLabel(
          next,
        ).toLowerCase()}.`,
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyUid(null);
    }
  }

  if (role !== "admin") {
    return (
      <AppShell
        title="Staff"
        eyebrow="Restricted"
      >
        <section className="empty-state prominent">
          <div className="empty-illustration">
            <ShieldAlert />
          </div>

          <div>
            <h2>
              Administrator access required
            </h2>

            <p>
              Approving staff accounts and
              assigning roles is an
              administrator task.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pending = members.filter(
    (member) => member.status === "pending",
  );

  const listed =
    filter === "pending" ? pending : members;

  return (
    <AppShell
      title="Staff"
      eyebrow="Access control"
      action={
        <button
          type="button"
          className="button button-secondary compact"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw
            className={
              loading ? "spin" : undefined
            }
            size={15}
          />
          Refresh
        </button>
      }
    >
      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="alert alert-success"
          role="status"
        >
          {notice}
        </div>
      )}

      {pending.length > 0 && (
        <section className="staff-queue">
          <div className="section-heading">
            <h2>
              Waiting for approval (
              {pending.length})
            </h2>
          </div>

          <div className="staff-request-list">
            {pending.map((member) => (
              <article
                key={member.uid}
                className="surface staff-request"
              >
                <header>
                  <div>
                    <strong>
                      {member.fullName}
                    </strong>

                    <span>
                      {member.email ??
                        "No email address"}
                    </span>
                  </div>

                  <span className="status-pill pending">
                    Pending
                  </span>
                </header>

                <dl>
                  <div>
                    <dt>Mobile</dt>
                    <dd>
                      {member.mobile ??
                        "Not provided"}
                    </dd>
                  </div>

                  <div>
                    <dt>Age</dt>
                    <dd>
                      {member.age ??
                        "Not provided"}
                    </dd>
                  </div>

                  <div>
                    <dt>Requested</dt>
                    <dd>
                      {roleLabel(
                        member.requestedRole,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Registered</dt>
                    <dd>
                      {formatMoment(
                        member.createdAt,
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="staff-request-controls">
                  <label>
                    Assign role
                    <select
                      value={
                        choices[member.uid] ??
                        "operations"
                      }
                      onChange={(event) =>
                        setChoices(
                          (current) => ({
                            ...current,

                            [member.uid]: event
                              .target
                              .value as StaffRole,
                          }),
                        )
                      }
                      disabled={
                        busyUid === member.uid
                      }
                    >
                      <option value="operations">
                        Operations
                      </option>

                      <option value="admin">
                        Administrator
                      </option>
                    </select>
                  </label>

                  <label>
                    Note (optional)
                    <input
                      type="text"
                      value={
                        notes[member.uid] ?? ""
                      }
                      onChange={(event) =>
                        setNotes(
                          (current) => ({
                            ...current,

                            [member.uid]:
                              event.target
                                .value,
                          }),
                        )
                      }
                      placeholder="Recorded with the decision"
                      maxLength={500}
                      disabled={
                        busyUid === member.uid
                      }
                    />
                  </label>
                </div>

                <footer>
                  <span className="quiet">
                    Requested{" "}
                    {formatMoment(
                      member.createdAt,
                    )}
                  </span>

                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-secondary compact"
                      onClick={() =>
                        void refuse(
                          member,
                          "reject",
                        )
                      }
                      disabled={
                        busyUid === member.uid
                      }
                    >
                      <UserRoundX size={15} />
                      Decline
                    </button>

                    <button
                      type="button"
                      className="button button-primary compact"
                      onClick={() =>
                        void approve(member)
                      }
                      disabled={
                        busyUid === member.uid
                      }
                    >
                      <UserRoundCheck
                        size={15}
                      />

                      {busyUid === member.uid
                        ? "Working…"
                        : "Approve"}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <section className="surface staff-editor">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Staff details
              </p>

              <h2>Edit staff member</h2>
            </div>

            <button
              className="icon-button"
              type="button"
              aria-label="Close editor"
              onClick={() => {
                if (busyUid) {
                  return;
                }

                setEditing(null);
              }}
            >
              <X size={18} />
            </button>
          </div>

          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
          >
            <div className="field">
              <label htmlFor="staff-full-name">
                Full name
              </label>

              <input
                id="staff-full-name"
                value={editing.fullName}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,

                          fullName:
                            event.target
                              .value,
                        }
                      : current,
                  )
                }
                maxLength={120}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="staff-mobile">
                Mobile
              </label>

              <input
                id="staff-mobile"
                value={editing.mobile}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,

                          mobile:
                            event.target
                              .value,
                        }
                      : current,
                  )
                }
                maxLength={40}
                inputMode="tel"
              />
            </div>

            <div className="field">
              <label htmlFor="staff-age">
                Age
              </label>

              <input
                id="staff-age"
                value={editing.age}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,

                          age: event.target
                            .value,
                        }
                      : current,
                  )
                }
                type="number"
                min={16}
                max={100}
                step={1}
              />
            </div>

            <div className="field">
              <label htmlFor="staff-email">
                Email
              </label>

              <input
                id="staff-email"
                value={
                  members.find(
                    (member) =>
                      member.uid ===
                      editing.uid,
                  )?.email ?? ""
                }
                readOnly
                disabled
              />

            </div>

            <div className="form-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={
                  busyUid === editing.uid
                }
                onClick={() =>
                  setEditing(null)
                }
              >
                Cancel
              </button>

              <button
                className="button button-primary"
                type="submit"
                disabled={
                  busyUid === editing.uid
                }
              >
                {busyUid === editing.uid
                  ? "Saving…"
                  : "Save details"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="surface fleet-surface">
        <div className="surface-toolbar">
          <div className="filter-scroll">
            <button
              type="button"
              className={`filter-chip${
                filter === "pending"
                  ? " active"
                  : ""
              }`}
              onClick={() =>
                setFilter("pending")
              }
            >
              Pending
              <span>{pending.length}</span>
            </button>

            <button
              type="button"
              className={`filter-chip${
                filter === "all" ? " active" : ""
              }`}
              onClick={() => setFilter("all")}
            >
              Everyone
              <span>{members.length}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="inline-empty">
            Loading staff accounts…
          </div>
        ) : listed.length === 0 ? (
          <div className="inline-empty">
            {filter === "pending"
              ? "No account is waiting for approval."
              : "No staff accounts exist yet."}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Last decision</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {listed.map((member) => {
                  const self =
                    member.uid === user?.uid;

                  return (
                    <tr key={member.uid}>
                      <td>
                        <strong>
                          {member.fullName}
                          {self ? " (you)" : ""}
                        </strong>

                        <span>
                          {member.email ??
                            "No email address"}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`status-pill ${member.status}`}
                        >
                          {
                            STATUS_LABEL[
                              member.status
                            ]
                          }
                        </span>
                      </td>

                      <td>
                        {member.status ===
                        "approved" ? (
                          <select
                            className="staff-role-select"
                            value={
                              member.role ??
                              "operations"
                            }
                            onChange={(event) =>
                              void reassign(
                                member,

                                event.target
                                  .value as StaffRole,
                              )
                            }
                            disabled={
                              self ||
                              busyUid ===
                                member.uid
                            }
                          >
                            <option value="operations">
                              Operations
                            </option>

                            <option value="admin">
                              Administrator
                            </option>
                          </select>
                        ) : (
                          <span className="quiet">
                            {roleLabel(
                              member.role,
                            )}
                          </span>
                        )}
                      </td>

                      <td>
                        <strong>
                          {formatMoment(
                            member.decidedAt ??
                              member.createdAt,
                          )}
                        </strong>

                        <span>
                          {member.decidedByNameSnapshot
                            ? `By ${member.decidedByNameSnapshot}`
                            : "Self-registered"}

                          {member.decisionNote
                            ? ` — ${member.decisionNote}`
                            : ""}
                        </span>
                      </td>

                      <td>
                        {pendingRemovalUid ===
                        member.uid ? (
                          <div className="row-actions">
                            <span className="quiet">
                              Remove{" "}
                              {member.fullName}
                              ?
                            </span>

                            <button
                              type="button"
                              className="button button-secondary compact"
                              onClick={() =>
                                setPendingRemovalUid(
                                  null,
                                )
                              }
                              disabled={
                                busyUid ===
                                member.uid
                              }
                            >
                              Cancel
                            </button>

                            <button
                              type="button"
                              className="button button-danger compact"
                              onClick={() =>
                                void remove(
                                  member,
                                )
                              }
                              disabled={
                                busyUid ===
                                member.uid
                              }
                            >
                              <Trash2
                                size={15}
                              />

                              {busyUid ===
                              member.uid
                                ? "Removing…"
                                : "Remove"}
                            </button>
                          </div>
                        ) : (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button-secondary compact"
                            onClick={() =>
                              startEdit(member)
                            }
                            disabled={
                              busyUid ===
                              member.uid
                            }
                          >
                            <Pencil size={15} />
                            Edit
                          </button>

                          {member.status ===
                            "approved" && (
                            <button
                              type="button"
                              className="button button-danger compact"
                              onClick={() =>
                                void refuse(
                                  member,
                                  "suspend",
                                )
                              }
                              disabled={
                                self ||
                                busyUid ===
                                  member.uid
                              }
                            >
                              Suspend
                            </button>
                          )}

                          {member.status !==
                            "approved" &&
                            member.status !==
                              "pending" && (
                              <button
                                type="button"
                                className="button button-secondary compact"
                                onClick={() =>
                                  void approve(
                                    member,
                                  )
                                }
                                disabled={
                                  self ||
                                  busyUid ===
                                    member.uid
                                }
                              >
                                <BadgeCheck
                                  size={15}
                                />
                                Restore
                              </button>
                            )}

                          {member.status ===
                            "pending" && (
                            <button
                              type="button"
                              className="button button-primary compact"
                              onClick={() =>
                                void approve(
                                  member,
                                )
                              }
                              disabled={
                                self ||
                                busyUid ===
                                  member.uid
                              }
                            >
                              <ShieldCheck
                                size={15}
                              />
                              Approve
                            </button>
                          )}

                          {/*
                            * Removing the profile is what
                            * removes the access: the rules
                            * read role and status from it.
                            */}
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${member.fullName}`}
                            title={`Remove ${member.fullName}`}
                            onClick={() => {
                              setError(
                                undefined,
                              );

                              setNotice(
                                undefined,
                              );

                              setPendingRemovalUid(
                                member.uid,
                              );
                            }}
                            disabled={
                              self ||
                              busyUid ===
                                member.uid
                            }
                          >
                            <Trash2
                              size={16}
                            />
                          </button>
                        </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
