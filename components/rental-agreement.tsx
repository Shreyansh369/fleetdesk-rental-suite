"use client";

import {
  CheckCircle2,
  ClipboardCopy,
  Mail,
  Printer,
  Send,
  X,
  XCircle,
} from "@/components/icons";

import { createPortal } from "react-dom";

import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { useFirebaseAuth } from "./firebase-provider";

import { AgreementSheet } from "./agreement-sheet";

import { DamageDiagram } from "./damage-diagram";

import {
  LicenceImage,
  MediaGrid,
} from "./rental-media";

import {
  callFirestoreOperation,
  type ContractStatus,
  type ContractWorkflow,
  type RentalAgreementView,
  type RentalDocuments,
} from "@/lib/services/firestore-client";

import {
  agreementBody,
  agreementSubject,
  gmailComposeUrl,
  mailtoUrl,
} from "@/lib/contract-message";

import { firebaseErrorMessage } from "@/lib/presentation";

/** The hydration flag never changes, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

function dateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString(
    "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

function moment(
  value: string | null,
): string {
  return value
    ? dateTime(value)
    : "Not recorded";
}

function statusLabel(
  status: ContractStatus,
): string {
  switch (status) {
    case "in_review":
      return "Waiting for review";

    case "approved":
      return "Approved";

    case "rejected":
      return "Rejected";

    default:
      return "Not submitted";
  }
}

/*
 * The pill re-uses the fleet status palette rather than
 * introducing a second set of colours for the same idea.
 */
function statusTone(
  status: ContractStatus,
): string {
  switch (status) {
    case "in_review":
      return "cleaning";

    case "approved":
      return "available";

    case "rejected":
      return "overdue";

    default:
      return "";
  }
}

/*
 * What the dialog is showing. The agreement is the reason the
 * dialog is usually opened, so it is the tab it opens on; the
 * photographs sit beside it rather than in a screen of their
 * own, because the question "what condition was it in" is
 * asked about a particular rental, not in the abstract.
 */
type DocumentView =
  | "agreement"
  | "licence"
  | "booking"
  | "checkout"
  | "return";

/*
 * The agreement is rebuilt from the stored booking every time
 * it is opened, so it always reflects the reservation that was
 * actually saved rather than whatever remains on the form.
 */
export function RentalAgreement({
  rentalId,
  onClose,
}: {
  rentalId: string;
  onClose: () => void;
}) {
  const { role } = useFirebaseAuth();

  const [agreement, setAgreement] =
    useState<RentalAgreementView>();

  const [documents, setDocuments] =
    useState<RentalDocuments>();

  const [view, setView] =
    useState<DocumentView>("agreement");

  const [workflow, setWorkflow] =
    useState<ContractWorkflow>();

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [busy, setBusy] =
    useState(false);

  const [reviewNote, setReviewNote] =
    useState("");

  /*
   * Every decision rewrites the workflow record, so the panel
   * is re-read from Firestore afterwards instead of being
   * patched locally and drifting from what was stored.
   */
  const [reloadToken, setReloadToken] =
    useState(0);

  /*
   * The dialog is mounted on document.body rather than inside
   * the application shell. Printing hides the shell, and a
   * descendant of a hidden element cannot be printed, so the
   * agreement has to sit outside it.
   *
   * The page is prerendered as static HTML, where there is no
   * document to portal into, so the portal waits for hydration.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const sheet =
          await callFirestoreOperation<
            { rentalId: string },
            RentalAgreementView
          >("getRentalAgreement", {
            rentalId,
          });

        if (cancelled) {
          return;
        }

        setAgreement(sheet);

        /*
         * The review workflow is keyed by the booking the
         * rental came from, so the agreement has to be read
         * first to know which one that is.
         */
        const review =
          await callFirestoreOperation<
            { reservationId: string },
            ContractWorkflow
          >("getContractWorkflow", {
            reservationId:
              sheet.reservationId,
          });

        if (!cancelled) {
          setWorkflow(review);
        }

        /*
         * The photographs are a second read rather than part
         * of the agreement view: the agreement is the frozen
         * record of what was signed, and the licence image
         * lives on the customer, who may have replaced it
         * since.
         */
        const filed =
          await callFirestoreOperation<
            { rentalId: string },
            RentalDocuments
          >("getRentalDocuments", {
            rentalId,
          });

        if (!cancelled) {
          setDocuments(filed);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [rentalId, reloadToken]);

  const status: ContractStatus =
    workflow?.status ?? "not_submitted";

  const isAdmin = role === "admin";

  async function run(
    action: () => Promise<string>,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const message = await action();

      setNotice(message);

      setReloadToken(
        (token) => token + 1,
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  function submitForReview() {
    void run(async () => {
      const result =
        await callFirestoreOperation<
          {
            reservationId: string;
            rentalId: string;
          },
          {
            reservationId: string;
            version: number;
          }
        >(
          "submitContractForReview",
          {
            reservationId:
              agreement?.reservationId ?? "",
            rentalId,
          },
        );

      return `Sent for review as version ${result.version}.`;
    });
  }

  function decide(
    decision: "approve" | "reject",
  ) {
    const note =
      reviewNote.trim() || null;

    if (
      decision === "reject" &&
      !note
    ) {
      setNotice(undefined);

      setError(
        "Explain why the contract is being rejected.",
      );

      return;
    }

    void run(async () => {
      await callFirestoreOperation<
        {
          reservationId: string;
          decision:
            | "approve"
            | "reject";
          note: string | null;
        },
        unknown
      >("reviewContract", {
        reservationId:
          agreement?.reservationId ?? "",
        decision,
        note,
      });

      setReviewNote("");

      return decision === "approve"
        ? "Contract approved. It can now be emailed to the customer."
        : "Contract rejected and sent back for correction.";
    });
  }

  /*
   * Sending through a provider needs a domain the business
   * owns and an endpoint to keep the key on. Handing the
   * finished message to the account the office already signs
   * in to needs neither, and the renter receives it from the
   * address they would reply to. Gmail opens in a new tab;
   * the mail-app route hands the same message to whatever
   * client is installed.
   */
  function handToMailClient(
    route: "gmail" | "app",
  ) {
    if (!agreement) {
      return;
    }

    const to = agreement.renter.email ?? "";

    if (route === "gmail") {
      window.open(
        gmailComposeUrl(agreement),
        "_blank",
        "noopener,noreferrer",
      );
    } else {
      window.location.href =
        mailtoUrl(agreement);
    }

    setError(undefined);

    const where =
      route === "gmail"
        ? "Gmail"
        : "your mail app";

    setNotice(
      to
        ? `Opening ${where} with the agreement addressed to ${to}. Attach the saved copy, then send it.`
        : `Opening ${where} with the agreement. This customer has no email address on file, so add the recipient yourself.`,
    );
  }

  /*
   * The printed copy is what the renter signs, so the operator
   * saves it first and attaches it to the message.
   */
  async function copyAgreementText() {
    if (!agreement) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${agreementSubject(agreement)}\n\n${agreementBody(agreement)}`,
      );

      setError(undefined);

      setNotice(
        "The agreement was copied. Paste it into any message.",
      );
    } catch {
      setNotice(undefined);

      setError(
        "The agreement could not be copied. Use Print to save a copy instead.",
      );
    }
  }

  /*
   * Only the tabs that have something behind them, so the
   * strip does not promise photographs that were never
   * taken. The agreement is always there — it is rebuilt
   * from the booking rather than stored as a file.
   */
  const tabs: Array<{
    id: DocumentView;
    label: string;
    count: number | null;
  }> = [
    {
      id: "agreement",
      label: "Agreement",
      count: null,
    },

    ...(documents?.licenceStoragePath
      ? [
          {
            id: "licence" as const,
            label: "Licence",
            count: null,
          },
        ]
      : []),

    ...(documents &&
    documents.bookingMedia.length > 0
      ? [
          {
            id: "booking" as const,
            label: "At booking",
            count:
              documents.bookingMedia.length,
          },
        ]
      : []),

    ...(documents &&
    documents.checkoutMedia.length > 0
      ? [
          {
            id: "checkout" as const,
            label: "At checkout",
            count:
              documents.checkoutMedia.length,
          },
        ]
      : []),

    ...(documents &&
    documents.returnMedia.length > 0
      ? [
          {
            id: "return" as const,
            label: "At return",
            count:
              documents.returnMedia.length,
          },
        ]
      : []),
  ];

  /*
   * The tabs appear once the documents load, so a view can
   * outlive the tab that offered it — a reload that fails,
   * or a record whose photographs were removed. Falling back
   * to the agreement keeps the dialog from showing a panel
   * with no tab lit.
   */
  const activeView = tabs.some(
    (tab) => tab.id === view,
  )
    ? view
    : "agreement";

  if (!hydrated) {
    return null;
  }

  return createPortal(
    <div
      className="agreement-backdrop"
      role="presentation"
    >
      <section
        className="agreement-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rental file"
      >
        <header className="agreement-modal-header">
          <div>
            <p className="page-kicker">
              Rental file
            </p>

            <h2>
              {agreement
                ? agreement.vehicle
                    .registration
                : "Loading agreement"}
            </h2>
          </div>

          <div className="agreement-modal-actions">
            <button
              className="button button-secondary compact"
              type="button"
              onClick={() =>
                window.print()
              }
              disabled={
                !agreement ||
                activeView !== "agreement"
              }
              title={
                activeView === "agreement"
                  ? "Print the agreement"
                  : "Printing applies to the agreement"
              }
            >
              <Printer size={16} />
              Print
            </button>

            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="Close rental file"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <nav
          className="agreement-tabs"
          aria-label="Rental documents"
        >
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={
                activeView === tab.id
                  ? "active"
                  : ""
              }
              aria-current={
                activeView === tab.id
                  ? "page"
                  : undefined
              }
              onClick={() =>
                setView(tab.id)
              }
            >
              {tab.label}

              {tab.count !== null && (
                <span>{tab.count}</span>
              )}
            </button>
          ))}
        </nav>

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

        {activeView !== "agreement" && (
          <section className="rental-media-panel">
            {activeView === "licence" && (
              <LicenceImage
                storagePath={
                  documents?.licenceStoragePath ??
                  null
                }
              />
            )}

            {activeView === "booking" && (
              <MediaGrid
                items={
                  documents?.bookingMedia ??
                  []
                }
                emptyMessage="No photographs were taken when this vehicle was booked."
              />
            )}

            {activeView === "checkout" && (
              <>
                {agreement && (
                  <DamageDiagram
                    label="Damage marked at checkout"
                    marks={agreement.damageMarks}
                  />
                )}

                <MediaGrid
                  items={
                    documents?.checkoutMedia ??
                    []
                  }
                  emptyMessage="No condition photographs were taken at checkout."
                />
              </>
            )}

            {activeView === "return" && (
              <>
                {/* New damage is drawn in red against
                    what the vehicle went out with. */}
                {agreement?.returnDamageMarks && (
                  <DamageDiagram
                    label="Damage marked at return"
                    marks={
                      agreement.returnDamageMarks
                    }
                    baseline={
                      agreement.damageMarks
                    }
                  />
                )}

                <MediaGrid
                  items={
                    documents?.returnMedia ??
                    []
                  }
                  emptyMessage="No condition photographs were taken at return. They are captured when the rental is closed."
                />
              </>
            )}
          </section>
        )}

        {activeView === "agreement" && (
        <section className="agreement-review">
          <div className="agreement-review-head">
            <div>
              <p className="section-kicker">
                Contract review
              </p>

              <p className="agreement-review-state">
                <span
                  className={`status-pill ${statusTone(
                    status,
                  )}`}
                >
                  {statusLabel(status)}
                </span>

                {workflow &&
                  workflow.version >
                    0 && (
                    <span className="quiet">
                      Version{" "}
                      {workflow.version}
                    </span>
                  )}
              </p>
            </div>

            <div className="agreement-review-actions">
              {(status ===
                "not_submitted" ||
                status ===
                  "rejected") && (
                <button
                  className="button button-primary compact"
                  type="button"
                  disabled={
                    busy || !workflow
                  }
                  onClick={
                    submitForReview
                  }
                >
                  <Send size={15} />
                  Submit for review
                </button>
              )}

              {status ===
                "in_review" &&
                isAdmin && (
                  <>
                    <button
                      className="button button-primary compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        decide(
                          "approve",
                        )
                      }
                    >
                      <CheckCircle2
                        size={15}
                      />
                      Approve
                    </button>

                    <button
                      className="button button-secondary compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        decide("reject")
                      }
                    >
                      <XCircle
                        size={15}
                      />
                      Reject
                    </button>
                  </>
                )}

              {status === "approved" && (
                <>
                  <button
                    className="button button-primary compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handToMailClient(
                        "gmail",
                      )
                    }
                  >
                    <Send size={15} />
                    Send with Gmail
                  </button>

                  <button
                    className="button button-secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handToMailClient("app")
                    }
                  >
                    <Mail size={15} />
                    Send from my mail app
                  </button>

                  <button
                    className="button button-secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void copyAgreementText();
                    }}
                  >
                    <ClipboardCopy size={15} />
                    Copy agreement
                  </button>
                </>
              )}
            </div>
          </div>

          {status === "in_review" &&
            isAdmin && (
              <div className="field">
                <label htmlFor="contract-review-note">
                  Review note
                </label>

                <textarea
                  id="contract-review-note"
                  value={reviewNote}
                  maxLength={1000}
                  onChange={(event) =>
                    setReviewNote(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Required when rejecting, optional when approving."
                />
              </div>
            )}

          {status === "in_review" &&
            !isAdmin && (
              <p className="form-help">
                An administrator has to
                approve this agreement
                before it can be emailed.
              </p>
            )}

          {status === "approved" && (
            <p className="form-help">
              The agreement is sent from the
              office&apos;s own account: Print
              to save the signed copy as a PDF,
              then “Send with Gmail” to open a
              message with everything filled in
              and attach it.
            </p>
          )}

          {workflow && (
            <dl className="agreement-review-meta">
              {workflow.submittedByNameSnapshot && (
                <div>
                  <dt>
                    Submitted by
                  </dt>

                  <dd>
                    {
                      workflow.submittedByNameSnapshot
                    }
                    {" · "}
                    {moment(
                      workflow.submittedAt,
                    )}
                  </dd>
                </div>
              )}

              {workflow.reviewedByNameSnapshot && (
                <div>
                  <dt>Reviewed by</dt>

                  <dd>
                    {
                      workflow.reviewedByNameSnapshot
                    }
                    {" · "}
                    {moment(
                      workflow.reviewedAt,
                    )}
                  </dd>
                </div>
              )}

              {workflow.reviewNote && (
                <div>
                  <dt>Review note</dt>

                  <dd>
                    {workflow.reviewNote}
                  </dd>
                </div>
              )}
            </dl>
          )}

          {workflow &&
            workflow.deliveries.length >
              0 && (
              <div className="agreement-deliveries">
                <h3>Email history</h3>

                <ul>
                  {workflow.deliveries.map(
                    (delivery) => (
                      <li
                        key={
                          delivery.id
                        }
                      >
                        <span
                          className={
                            delivery.status ===
                            "failed"
                              ? "status-pill overdue"
                              : "status-pill available"
                          }
                        >
                          {delivery.status ===
                          "failed"
                            ? "Failed"
                            : "Sent"}
                        </span>

                        <span>
                          {
                            delivery.recipientEmail
                          }
                          {" · version "}
                          {
                            delivery.contractVersion
                          }
                          {" · "}
                          {moment(
                            delivery.createdAt,
                          )}
                        </span>

                        {delivery.failureReason && (
                          <small>
                            {
                              delivery.failureReason
                            }
                          </small>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
        </section>
        )}

        {activeView === "agreement" &&
          agreement && (
            <AgreementSheet
              agreement={agreement}
            />
          )}

      </section>
    </div>,
    document.body,
  );
}
