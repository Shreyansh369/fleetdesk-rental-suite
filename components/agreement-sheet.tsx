"use client";

import {
  AGREEMENT_NOTICES,
  AGREEMENT_TERMS,
  CHARGE_ROWS,
  COMPANY,
  GAS_LEVELS,
  PAYMENT_METHODS,
} from "@/lib/agreement";

import { formatMoney } from "@/lib/presentation";

import {
  DAMAGE_KINDS,
  DAMAGE_VIEWS,
  damageKindOf,
  summariseDamage,
} from "@/lib/damage";

import type { RentalAgreementView } from "@/lib/services/firestore-client";

/*
 * The printed rental agreement, laid out to match the form the
 * office already uses on paper: renter and additional renter
 * across the top, the vehicle and its readings down the left,
 * gas and payment through the middle, the charges table on the
 * right, and the terms overleaf with the signature lines.
 */
function dayOf(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function timeOf(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | number | null | undefined;
  wide?: boolean;
}) {
  return (
    <div
      className={
        wide
          ? "sheet-field sheet-field-wide"
          : "sheet-field"
      }
    >
      <span className="sheet-field-label">
        {label}
      </span>

      <span className="sheet-field-value">
        {value === null ||
        value === undefined ||
        value === ""
          ? " "
          : value}
      </span>
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "sheet-tick sheet-tick-on"
          : "sheet-tick"
      }
      aria-hidden="true"
    >
      {on ? "✕" : " "}
    </span>
  );
}

export function AgreementSheet({
  agreement,
}: {
  agreement: RentalAgreementView;
}) {
  const distanceUnit =
    agreement.odometerOut?.unit === "mi"
      ? "miles"
      : "km";

  return (
    <article className="agreement-sheet">
      {/* ---------------------------------------- page one */}
      <section className="sheet-page">
        <header className="sheet-head">
          <img
            src="/brand/logo.svg"
            alt="FleetDesk"
          />

          <div className="sheet-head-title">
            <strong>RENTAL AGREEMENT</strong>
          </div>
        </header>

        <p className="sheet-contact">
          <b>T</b> {COMPANY.telephone}
          {"  |  "}
          <b>E</b> {COMPANY.email}
          {"  |  "}
          {COMPANY.address}
        </p>

        <div className="sheet-renters">
          <div className="sheet-box">
            <Field
              label="Renter name:"
              value={agreement.renter.fullName}
              wide
            />

            <div className="sheet-row">
              <Field
                label="Address:"
                value={agreement.renter.address}
              />
              <Field
                label="State:"
                value={agreement.renter.state}
              />
            </div>

            <div className="sheet-row">
              <Field
                label="DOB:"
                value={
                  agreement.renter.dateOfBirth
                }
              />
              <Field
                label="Local license no."
                value={
                  agreement.renter.licenceNumber
                }
              />
            </div>

            <div className="sheet-row">
              <Field
                label="Telephone:"
                value={
                  agreement.renter.telephone
                }
              />
              <Field
                label="Expiration date:"
                value={
                  agreement.renter
                    .licenceExpiresAt
                }
              />
            </div>

            <Field
              label="Local address:"
              value={
                agreement.renter.localAddress
              }
              wide
            />
          </div>

          <div className="sheet-box">
            <Field
              label="Additional renter name:"
              value={
                agreement.additionalDriver
                  ?.fullName
              }
              wide
            />

            <div className="sheet-row">
              <Field
                label="Address:"
                value={
                  agreement.additionalDriver
                    ?.address
                }
              />
              <Field
                label="State:"
                value={
                  agreement.additionalDriver
                    ?.state
                }
              />
            </div>

            <div className="sheet-row">
              <Field
                label="DOB:"
                value={
                  agreement.additionalDriver
                    ?.dateOfBirth
                }
              />
              <Field
                label="Local license no."
                value={
                  agreement.additionalDriver
                    ?.licenceNumber
                }
              />
            </div>

            <div className="sheet-row">
              <Field
                label="Telephone:"
                value={
                  agreement.additionalDriver
                    ?.telephone
                }
              />
              <Field
                label="Expiration date:"
                value={
                  agreement.additionalDriver
                    ?.licenceExpiresAt
                }
              />
            </div>

            <Field
              label="Local address:"
              value={
                agreement.additionalDriver
                  ?.localAddress
              }
              wide
            />
          </div>
        </div>

        <div className="sheet-columns">
          {/* -------------------------- vehicle and readings */}
          <div className="sheet-box">
            <Field
              label="Vehicle registration #:"
              value={
                agreement.vehicle.registration
              }
              wide
            />

            <Field
              label="Make / type:"
              value={agreement.vehicle.make}
              wide
            />

            <div className="sheet-row">
              <Field
                label="Model:"
                value={agreement.vehicle.model}
              />
              <Field
                label="Year:"
                value={agreement.vehicle.year}
              />
            </div>

            <Field
              label="Colour:"
              value={agreement.vehicle.color}
              wide
            />

            <div className="sheet-row">
              <Field
                label="Date out:"
                value={dayOf(agreement.dateOut)}
              />
              <Field
                label="Time:"
                value={timeOf(agreement.dateOut)}
              />
            </div>

            <div className="sheet-row">
              <Field
                label="Date in:"
                value={dayOf(agreement.dateIn)}
              />
              <Field
                label="Time:"
                value={timeOf(agreement.dateIn)}
              />
            </div>

            <div className="sheet-row">
              <Field
                label="Actual time in:"
                value={dayOf(
                  agreement.actualTimeIn,
                )}
              />
              <Field
                label="Time:"
                value={timeOf(
                  agreement.actualTimeIn,
                )}
              />
            </div>

            <Field
              label="Extra hours:"
              value={
                agreement.extraHours || null
              }
              wide
            />

            <div className="sheet-row">
              <Field
                label={`${distanceUnit} out:`}
                value={
                  agreement.odometerOut?.value
                }
              />
              <Field
                label={`${distanceUnit} in:`}
                value={
                  agreement.odometerIn?.value
                }
              />
            </div>

            <Field
              label={`Total ${distanceUnit}:`}
              value={agreement.totalDistance}
              wide
            />

            <div className="sheet-instructions">
              <span className="sheet-field-label">
                Special instruction, additional
                information
              </span>

              <p>
                {agreement.specialInstructions ??
                  " "}
              </p>
            </div>

            <p className="sheet-territory">
              <em>{AGREEMENT_NOTICES.territory}</em>
              <strong>
                {AGREEMENT_NOTICES.traffic}
              </strong>
            </p>
          </div>

          {/* ------------------------ gas, damage, payment */}
          <div className="sheet-box">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>GAS</th>
                  <th>OUT</th>
                  <th>IN</th>
                </tr>
              </thead>

              <tbody>
                {GAS_LEVELS.map((level) => (
                  <tr key={level.value}>
                    <td>{level.label}</td>
                    <td>
                      <Tick
                        on={
                          agreement.gasOut ===
                          level.value
                        }
                      />
                    </td>
                    <td>
                      <Tick
                        on={
                          agreement.gasIn ===
                          level.value
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Vehicle damage</th>
                  <th>YES</th>
                  <th>NO</th>
                </tr>
              </thead>

              <tbody>
                {[
                  [
                    "Liability waiver",
                    agreement.waivers
                      .liabilityWaiver,
                  ],
                  [
                    "Windscreen waiver",
                    agreement.waivers
                      .windscreenWaiver,
                  ],
                  [
                    "Personal accident insurance",
                    agreement.waivers
                      .personalAccidentInsurance,
                  ],
                ].map(([label, on]) => (
                  <tr key={String(label)}>
                    <td>{label}</td>
                    <td>
                      <Tick on={on === true} />
                    </td>
                    <td>
                      <Tick on={on !== true} />
                    </td>
                  </tr>
                ))}

                <tr>
                  <td>Deposit</td>
                  <td colSpan={2}>
                    <strong>
                      {formatMoney(
                        agreement.depositCents,
                      )}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="sheet-payment">
              <span className="sheet-field-label">
                Payment information
              </span>

              <p className="sheet-methods">
                {PAYMENT_METHODS.map(
                  (method) => (
                    <span key={method.value}>
                      <Tick
                        on={
                          agreement.payment
                            .method ===
                          method.value
                        }
                      />
                      {method.label}
                    </span>
                  ),
                )}
              </p>

              <Field
                label="Check / credit card no."
                value={
                  agreement.payment
                    .referenceLast4
                    ? `•••• ${agreement.payment.referenceLast4}`
                    : null
                }
                wide
              />

              <Field
                label="Expiration date (if credit card):"
                value={null}
                wide
              />

              <Field
                label="Name on card (if credit card):"
                value={
                  agreement.payment.cardHolder
                }
                wide
              />

              <Field
                label="Card holder authorization"
                value={null}
                wide
              />
            </div>
          </div>

          {/* ------------------------------- charges table */}
          <div className="sheet-box">
            <table className="sheet-table sheet-charges">
              <thead>
                <tr>
                  <th>CHARGES</th>
                  <th>EXTENDED PRICES</th>
                </tr>
              </thead>

              <tbody>
                {CHARGE_ROWS.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>
                      {agreement.charges[
                        row.key
                      ]
                        ? formatMoney(
                            agreement.charges[
                              row.key
                            ],
                          )
                        : " "}
                    </td>
                  </tr>
                ))}

                <tr className="sheet-total">
                  <td>TOTAL</td>
                  <td>
                    {formatMoney(
                      agreement.chargeTotalCents,
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="sheet-notice">
              {AGREEMENT_NOTICES.property}
            </p>
          </div>
        </div>

        <div className="sheet-diagrams">
          <span className="sheet-field-label">
            Vehicle damage at checkout &mdash;{" "}
            {agreement.damageMarks.length > 0
              ? summariseDamage(
                  agreement.damageMarks,
                ).toLowerCase()
              : "mark any existing damage on the diagrams"}
          </span>

          <div className="sheet-diagram-grid">
            {DAMAGE_VIEWS.map((view) => (
              <figure
                key={view.label}
                className={`sheet-diagram sheet-diagram-${view.view}`}
              >
                <div className="sheet-diagram-canvas">
                  <img src={view.src} alt="" />

                  {agreement.damageMarks
                    .filter(
                      (mark) =>
                        mark.view === view.view,
                    )
                    .map((mark) => (
                      <span
                        key={mark.id}
                        className={`damage-pin damage-pin-${mark.kind} is-placed`}
                        style={{
                          left: `${mark.x * 100}%`,
                          top: `${mark.y * 100}%`,
                        }}
                      >
                        {
                          damageKindOf(mark.kind)
                            .letter
                        }
                      </span>
                    ))}
                </div>

                <figcaption>{view.label}</figcaption>
              </figure>
            ))}
          </div>

          <p className="sheet-damage-key">
            {DAMAGE_KINDS.map(
              (entry) =>
                `${entry.letter} = ${entry.label}`,
            ).join("   ·   ")}
          </p>
        </div>

        {agreement.media.length > 0 && (
          <div className="sheet-photos">
            <span className="sheet-field-label">
              Vehicle condition at checkout
            </span>

            <div className="sheet-photo-grid">
              {agreement.media
                .slice(0, 8)
                .map((item) => (
                  <img
                    key={String(item.publicId)}
                    src={String(item.url)}
                    alt={String(
                      item.originalFilename ??
                        "Vehicle condition",
                    )}
                  />
                ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------- page two */}
      <section className="sheet-page sheet-terms">
        <header className="sheet-head">
          <img
            src="/brand/logo.svg"
            alt="FleetDesk"
          />

          <div className="sheet-head-title">
            <strong>RENTAL AGREEMENT</strong>
            <span>Terms &amp; Conditions</span>
          </div>
        </header>

        <p className="sheet-contact">
          <b>T</b> {COMPANY.telephone}
          {"  |  "}
          <b>E</b> {COMPANY.email}
          {"  |  "}
          {COMPANY.address}
        </p>

        <ol className="sheet-clauses">
          {AGREEMENT_TERMS.map((clause) => (
            <li key={clause.slice(0, 40)}>
              {clause}
            </li>
          ))}
        </ol>

        <p className="sheet-acknowledgement">
          <strong>
            {AGREEMENT_NOTICES.acknowledgement}
          </strong>
        </p>

        <div className="sheet-signatures">
          <div>
            <div className="sheet-signature-line">
              {agreement.customerSignatureDataUrl ? (
                <img
                  src={
                    agreement.customerSignatureDataUrl
                  }
                  alt="Renter signature"
                />
              ) : (
                <span>
                  {agreement.customerSignatureName ??
                    ""}
                </span>
              )}
            </div>

            <small>
              RENTER SIGNATURE
              {agreement.customerSignatureMethod ===
              "typed"
                ? " — name entered, not signed"
                : ""}
            </small>
          </div>

          <div>
            <div className="sheet-signature-line">
              <span>
                {agreement.checkedOutBy}
              </span>
            </div>

            <small>OWNER SIGNATURE</small>
          </div>

          <div>
            <div className="sheet-signature-line">
              {agreement.additionalDriverSignatureDataUrl ? (
                <img
                  src={
                    agreement.additionalDriverSignatureDataUrl
                  }
                  alt="Additional driver signature"
                />
              ) : (
                <span>
                  {agreement.additionalDriverSignatureName ??
                    ""}
                </span>
              )}
            </div>

            <small>
              ADDITIONAL DRIVER SIGNATURE
            </small>
          </div>

          <div>
            <div className="sheet-signature-line">
              <span>
                {agreement.vehicle.registration}
              </span>
            </div>

            <small>REGISTRATION NUMBER</small>
          </div>
        </div>
      </section>
    </article>
  );
}
