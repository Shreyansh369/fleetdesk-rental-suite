# Security model

## Roles

- **Administrator:** all operational reads and writes plus the financial reporting reads (expenses, ledger, refunds, audit logs) and staff-profile administration.
- **Operations:** the operational workflows — customers, vehicles, reservations, checkout, extension, return, payment, past-booking entry and expense recording. Operations cannot read the ledger, refunds, audit logs or anybody else's expenses, and the Finance screen is closed to them.

### Where the line between the two falls

Revenue reporting is administrator-only, and that is enforced in three places rather than one:

- The **Finance** link is not rendered in the navigation for an operations account, and the screen itself refuses to load for one.
- `getFinancialOverview` re-reads the caller's own `users/{uid}` profile and refuses before it issues a single read, so the refusal is a sentence the office can read rather than a raw permission error.
- The rules are the boundary that actually holds: `refunds`, `financialLedger` and `auditLogs` are admin-read, and `vehicleExpenses` is admin-read except for the entries the caller recorded itself. Opening `/finance` directly, or calling the same reads from a console, is refused by Firestore whatever the browser believes.

What operations keeps is what running a rental needs: a rental's own balance, so a payment can be taken at the counter, and the ability to record an expense. Recording an expense is operational work — the person holding the garage invoice is the one who took the car in — so it has a screen of its own at `/expenses`, separate from revenue reporting. An operations account reads back only the expenses it recorded; the cost side of the business as a whole stays with an administrator.

Editing a staff member's own details — name, mobile, age — is an administrator's write and leaves an audit entry. It deliberately cannot touch `role` or `status`: those are access decisions with their own controls, and the rules refuse a self-update that reaches for either.

Removing a staff member is the same decision taken to its end. Deleting `users/{uid}` is what removes the access, because that document is where the rules read `role` and `status`; it is admin-only, an administrator cannot remove their own account, and the audit entry is written in the same transaction and carries everything the profile held, since afterwards it is the only account of who was removed. It does **not** delete the Firebase Authentication user — a browser cannot — so that account can still sign in, lands on the "no staff profile" screen with no permissions, and can register again as a pending request. Deleting it for good is a console action.

A role only takes effect once an administrator sets `role` and `status: "approved"` on the staff member's `users/{uid}` document. Sign-up can only create its own profile with `status: "pending"` and `role: null`, and the rules refuse any self-update that touches `role`, `status` or `requestedRole`, so an account cannot promote itself.

That decision is made on the **Staff** screen, which only an administrator can list `users` to see, and every approval, refusal, suspension and role change is written together with its audit entry in one transaction. An administrator cannot act on their own account there: withdrawing the last administrator's own access would leave the project with nobody able to approve anyone, and it is the one change the screen refuses to make.

## Controls and residual responsibilities

| Threat | Implemented control |
| --- | --- |
| Client price/total tampering | The quote is computed inside the transaction from the vehicle's own rate document, never from the form; integer cents throughout |
| Booking races | Firestore transaction that re-reads every candidate reservation for the vehicle before writing |
| Duplicate payment/expense submission | UUID idempotency key recorded in the same transaction; the key document cannot be updated or deleted from a browser |
| Duplicate customer records | An edit writes back to the same customer document; a new document is only created when no customer id is supplied |
| Direct database manipulation / IDOR | Deny-by-default rules; role and approval read from `users/{uid}` inside the rules |
| Financial-history mutation | Payments are create-only for staff; ledger, expense and audit entries cannot be edited or deleted except by an administrator |
| Expense attributed to somebody else | An expense can only be created with `recordedBy` equal to the caller's own uid, so an entry cannot be filed under another account |
| Revenue reporting reached by a direct URL or API call | Admin-only in the navigation, in the screen, in the service call and — the part that binds — in the rules |
| Historical rental used to rewrite live state | A past booking is refused unless its whole window is in the past; it changes no vehicle status, holds no reservation and is flagged `isHistorical`, and its idempotency key stops the same record being entered twice |
| Invalid monetary or sensor values | Amounts rejected unless whole non-negative cents within a fixed ceiling; odometer and fuel values validated against fixed ranges and enums; `undefined` is never written |
| Malicious uploads | Image-only MIME allow-list and size ceiling before upload; unsigned Cloudinary preset carries no credential |
| Privilege escalation | Role and approval live in a document the account itself cannot modify |
| Data exfiltration | Financial and audit documents are admin-only; every query is capped |
| Contract tampering before delivery | An agreement can only be sent after an administrator approves it; approval freezes a snapshot in a subcollection the rules make immutable, and the message is rendered from that snapshot alone |
| Mail credential exposure | The deployed application uses no mail provider: an agreement leaves from the office's own mail account, so there is no sending credential to expose. The provider-based send in the unbuilt `functions/` reference reads its key from a secret, never from the bundle |
| Customer deletion covering tracks | Deletion is admin-only, is refused while any booking or rental references the customer, and writes an audit entry naming the record removed |
| XSS/injection | React rendering, no raw HTML rendering; the emailed agreement escapes every value that came from a person |

### Residual risks

The project stays on the Spark plan, so there is no general server-side enforcement layer. The consequences below are accepted and should be reviewed before the client scales up:

- An approved staff account can write any document the rules allow it to write, including a rental financial total, without passing through the validation in the application code. Firestore rules restrict who and what, not the arithmetic.
- Customer licence images and vehicle photos are delivered from Cloudinary over unguessable public URLs. The URL is stored only on the customer record, which is staff-only, but anyone holding the URL can open the image. Switching the Cloudinary account's delivery type to authenticated closes this without a code change.
- The upload preset is unsigned and its name is public, so the MIME and size limits in `lib/cloudinary.ts` bind the application, not the endpoint. Anyone who reads the bundle can post directly to Cloudinary and upload outside those limits. Mirror the restrictions on the preset itself in the Cloudinary console — allowed formats, a maximum file size, and a fixed folder — so the limits hold wherever the request comes from. Signed uploads would close it completely but need a server to sign with.
- Nothing deletes a Cloudinary asset. Replacing a licence image, removing a vehicle photo or deleting a customer drops the reference from Firestore and leaves the uploaded file in the account. Deleting a customer records the orphaned `licenceStoragePath` in the audit log so it can be purged from the console. Set a retention rule on the upload folder, or prune by tag (`customer-document`, `vehicle`), until there is a backend that can delete on the customer's behalf.

App Check with reCAPTCHA Enterprise is initialised when `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` is set and emulators are off. Without callable functions it cannot be enforced on Firestore from the Spark plan, so treat it as defence in depth rather than a gate.

Store credentials only in Firebase/GCP Secret Manager, GitHub Actions environments, or local untracked `.env.local`. Never add a service-account file, payment secret, or production Firebase project ID to source control. Run `pnpm audit --prod --audit-level=high` and secret scanning in CI before release.
