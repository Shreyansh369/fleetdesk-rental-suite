# Architecture and data model

## Trust boundary

The web application runs without a server of its own: the project stays on the Firebase Spark plan, so Cloud Functions are not deployed and every workflow executes in the browser against Firestore directly.

Firebase Authentication identifies the caller. Authorisation is resolved from the caller's own `users/{uid}` profile, which must carry `status: "approved"` and a role of `admin` or `operations`; a browser cannot write those fields for itself. Firestore and Storage rules enforce the same check server-side, so they remain the real boundary: reads and writes are denied by default, financial reporting collections are admin-only, and ledger, audit and idempotency records cannot be edited or deleted from a browser.

Because the workflows now run client-side, input validation in `lib/services/firestore-client.ts` is a correctness control rather than a trust boundary. Amounts are validated as whole non-negative cents within a fixed ceiling, odometer readings are converted and range-checked once, enum values are checked against fixed lists, and no `undefined` is ever written. Rate and quote snapshots are still read from the vehicle record inside the transaction rather than accepted from the form, so a tampered browser cannot change what a rental is priced at — but a determined staff account could write a financial document the rules allow it to write. Restoring server-side enforcement requires the Blaze plan and the callable functions kept in `functions/`.

No workflow needs a server of its own, and none has one. An approved agreement is handed to the office's own mail account — a Gmail compose URL, the device's mail app, or the clipboard — with the signed copy printed or saved as a PDF and attached. Nothing in the system holds a mail provider's credential, so there is no key to deploy, rotate or leak, and no deployment beyond Hosting and the rules.

Staff approval needs no server either. An administrator decides on the Staff screen, and a waiting request is surfaced by a count beside that screen in the navigation rather than by anything being sent.

The `functions/` directory is retained as the reference implementation of these workflows, including a provider-based contract send that the application does not use. It is not built, deployed or called.

## Collections

| Collection | Purpose | Client access |
| --- | --- | --- |
| `vehicles` | Fleet identity, state, current rates, compliance and photos | Staff read and write; admin delete |
| `customers` | Customer PII and licence metadata | Staff read and write; admin delete |
| `reservations` | Confirmed booking and immutable rate/quote snapshot | Staff read and write; admin delete |
| `rentals` / `inspections` | Operational rental lifecycle and inspections | Staff read and write; admin delete |
| `rentalFinancials`, `payments` | Rental totals and receipts | Staff read and write; payments are create-only for staff |
| `refunds`, `financialLedger` | Profit reporting | Admin read; staff may append ledger entries but never edit or delete them |
| `vehicleExpenses` | What the fleet costs to run | Staff create, with `recordedBy` forced to their own uid, and read back their own entries; admin reads all; nobody edits or deletes but an admin |
| `auditLogs` | Security trail | Admin read; staff append-only |
| `users` | Staff identity, requested role, assigned role and approval status | Self read; admin read, list, update and delete. A browser creates only its own pending profile and can never write `role` or `status` for itself. An administrator corrects another account's name, mobile and age from the Staff screen; role and status stay with the access controls beside it |
| `reservationContracts` | Contract review state: status, version and review metadata | Staff read; staff may submit for review; only an admin may approve or reject, and an approved contract is final |
| `reservationContracts/{id}/versions` | The frozen agreement as approved | Staff read; admin create only; never updated or deleted |
| `reservationContracts/{id}/deliveries` | Email delivery receipts | Staff read and create only; never updated or deleted |
| `idempotencyKeys` | Replay protection | Staff read and create only; never updated or deleted |

Rates and quote values use integer USD cents. A rental copies the rate snapshot and quote from its vehicle at reservation time; later rate edits cannot change historic revenue. Ledger and audit entries are append-only from the browser’s perspective.

## Consistency model

- Reservation creation transacts on vehicle/customer, checks overlapping confirmed reservations, snapshots rates, and marks the vehicle reserved.
- A booking may be backdated, for a hire that went out before it was booked here and has not come back. `createReservation` takes a `backdated` flag and applies `pickupWindowError` from the domain package: without it the pickup has to be ahead of now, with it the pickup has to be behind now and within two years, so neither kind can be entered by mistyping a date in the other one's form. Everything else is an ordinary booking — the vehicle is held, the overlap check still runs, and it is checked out, extended and returned through the same tabs — so it is marked `backdated: true` and deliberately not `isHistorical`, which would take a rental that is still out of the live listings. Compliance is judged against the pickup instant, which for a backdated booking is what the papers said when the vehicle actually went out.
- Checkout transacts reservation, vehicle and new rental/financial documents. The odometer is converted to kilometres once and the entered value and unit are stored alongside it, so a later return compares like with like.
- Return transacts rental, financial totals, adjustments, and vehicle cleaning status. Re-reading the rental status inside the transaction is what makes a repeated submission safe.
- Payment and expense operations require a UUID idempotency key and write an immutable record plus ledger event atomically. Additional booking fees raise `adjustmentCents` and `totalCents` together so the return, which recomputes the total from `baseRentalCents + adjustmentCents`, cannot count them twice.
- Contract review is a persisted state machine on `reservationContracts/{reservationId}`: an employee submits, which sets `status: "in_review"` and advances `version`; an administrator approves or rejects. Approval copies the customer, vehicle, period and money out of the stored records, inside the same transaction that records the decision, into `versions/v{n}`, which the rules make immutable. Rejection requires a note and sends the contract back for resubmission at the next version. An approved contract is terminal — no rule permits an update that moves it — so the agreement that was emailed can always be reproduced exactly.
- Staff access decisions transact the profile and its audit entry together, re-reading the profile inside the transaction, so an approval, refusal, suspension or role change is never recorded without the decision that caused it. An administrator's own account is excluded: the project must not be able to lose its last administrator to a mis-click.
- A past booking is entered rather than reconstructed. `recordPastRental` writes the completed reservation, the closed rental and its financial record in one transaction under an idempotency key, with `isHistorical: true` on all three. It refuses a window that has not finished, holds no vehicle and changes no vehicle status, because the rental it describes is already over. The employee it is attributed to is named from that employee's own profile inside the transaction, never from the form, so a historical record carries the same attribution a live one does.
- Rental history is one list, on the customers screen, and it joins the two records a rental keeps: `rentals`, which carries the dates, the status and the name of every employee who touched it, and `rentalFinancials`, which carries the money under the same document id. Two capped collection reads and an in-memory join, rather than one read per row. Entering a rental the office already ran belongs with the history it is missing from, so it is an action there rather than a workflow tab beside checkout and return.
- The renter settles the hire at two moments, and the data model follows them. At checkout the agreement records the rental days from the booking quote, the insurance and the car seats as charges, and the deposit separately as `depositHeldCents`: it is held rather than earned, so it never joins `totalCents`. At return the extension, the extra hours, the waivers, the cleaning or detailing, the refuelling and anything else are raised as adjustments in one submission, which is what moves the balance the till then collects.
- The waivers taken and the hours run over are recorded at return rather than at checkout, because that is when they are known. `returnRental` merges them into the rental's stored `agreement`, which `getRentalAgreement` rebuilds the printed copy from, so the agreement carries them once the vehicle is back. It follows that a copy printed at handover leaves those boxes blank; an approved contract snapshot is a separate immutable document and is untouched either way.
- The paperwork for a rental is read as one file rather than four screens. The dialog that opens from a history or records row offers the agreement, the renter's licence and the condition photographs taken at booking, at handover and at return, and only offers a tab that has something behind it. The agreement is rebuilt from the booking by `getRentalAgreement`; the rest is a second read, `getRentalDocuments`, because the licence lives on the customer and may have been replaced since the hire. A licence captured before the move to Cloudinary is a Firebase Storage path rather than a URL, and is resolved as one.
- Overdue state is derived from the expected-return time wherever it is displayed: the dashboard count, the dashboard rental list and the active-rentals table all apply the same rule at read time. Without Cloud Functions there is no scheduled job to stamp `status: "overdue"` on a rental document, and a stored flag would be stale rather than wrong-but-harmless, so none is kept.

## Query/cost controls

The dashboard uses Firestore aggregate counts, bounded compliance reads, and a ten-item reservation query. Fleet listing is capped at 100 results. Composite indexes tracked in `firestore.indexes.json` support the conflict and time-window queries; add an index only with a documented access pattern.
