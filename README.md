# FleetDesk

Operations software for car rental businesses: bookings, checkout and return, rental agreements, damage records, payments, expenses, finance and staff access in one place.

## How it is offered

1. **Demo, in the browser.** Any build opens on a welcome page with pricing. *Open the demo* signs the visitor in to a complete workspace that runs entirely in their browser: every workflow works, data is kept on the device (IndexedDB), and nothing needs Firebase or any server. The demo accounts are published on the sign-in page; all use the password `Demo@1234`:

   | Account | Role |
   | --- | --- |
   | `demo.admin@gmail.com`, `demo.manager@gmail.com` | Administrator |
   | `demo.frontdesk@gmail.com`, `demo.fleet@gmail.com`, `demo.accounts@gmail.com`, `demo.hr@gmail.com` | Operations |
   | `demo.newhire@gmail.com` | Waiting for approval |

   The demo starts with no business data, for the visitor's own vehicles and rates; *Demo tools* loads a sample business (14 vehicles, 18 customers, six months of history and today's activity) through the same workflows.
2. **7-day free trial.** With Firebase configured, a visitor starts a trial at `/trial` with one administrator email (one trial per email, no card). It is a private workspace in the shared Firebase project; the administrator invites staff with a link from the Staff screen and approves them.
3. **A paid plan**, through Stripe: *Subscription* ($599, then $99/month from month 3) or *Buy outright* ($1,299 for the first year, maintenance for 3 months, $99/month from month 13). Hosting and the database are included. See [`docs/billing.md`](docs/billing.md).

The public site carries terms of service, privacy, cookie, refund and acceptable-use pages (`/terms`, `/privacy`, `/cookies`, `/refunds`, `/acceptable-use`), filled from `NEXT_PUBLIC_LEGAL_*`. They are written for how the product works but are not legal advice; have them reviewed before taking payment.

The interface is responsive from small Android phones to 4K TVs (large screens are scaled up for reading at a distance), respects iPhone safe areas, and can be installed from the browser as an app on any device.

## Included

- Next.js operations dashboard with Firebase Authentication gate
- Self-service staff registration with an administrator approval screen and role assignment
- Firestore/Storage security rules and indexes
- Transactional reservation, checkout, extension, return, pricing and payment workflows that run in the browser against Firestore, so no Blaze-plan Cloud Functions are required
- Manual entry of a rental the office already ran, recorded as a closed rental and marked as a past booking so it is never mistaken for a live one
- Backdated bookings on the booking screen for a hire that started before it was booked here and is still out: tick **This rental already started**, date the pickup in the past, and it is checked out, extended and returned like any other booking
- Rent on a long hire: every rental still out appears on the Payment tab, rent that has built up past the date it was charged to is priced from the rental's own rates, and taking it moves that date forward
- Discounts at checkout or at payment: an administrator's comes straight off the balance; an employee's waits for an administrator's approval, counted beside **Bookings** until it is decided
- Payment taken at checkout: choose Cash, Check or Credit card on the agreement and enter what was paid now; it is saved as a payment on the rental, and whatever is not paid stays as the balance due on the **Payment** tab
- Damage marked on the vehicle drawings — scratch, dent, chip / crack or other — at checkout and at return, printed on the agreement; the vehicle carries its marks from one hire to the next, new damage at a return is shown in red, and a repair is cleared from the vehicle's edit screen
- Every line under **Recent entries** on Finance opens as a bill: customer, vehicle, who recorded it, how it was paid, who offered and who approved a discount, and every other charge and payment on the same rental, printable
- Cancelled bookings are listed on **Bookings** with who cancelled them, when and why — a reason is required to cancel; bookings cancelled since you last looked are counted beside **Bookings** in the menu and the phone's bottom bar
- A rental record of every hire — customer, vehicle, the staff member who handled it, start, return and status — searchable from one box
- Expense recording on a screen of its own that operations can reach, kept apart from the administrator-only revenue reporting
- Cloudinary media capture for vehicle condition photos, fleet photos and driver's licence images
- Printable rental agreement rebuilt from the stored booking, with an employee review workflow — submit, approve or reject, then email — and an immutable snapshot of what was approved
- Approved agreements handed to the office's own mail account — Gmail compose, the device's mail app, or copy — so no mail provider, API key or extra deployment is involved
- Append-only audit and financial ledger records
- Spreadsheet import that defaults to dry-run and produces a validation report
- Emulator configuration, security-rule tests, unit tests, CI, and deployment/recovery documentation

## Start locally

The demo needs nothing but the app:

```bash
pnpm install
pnpm dev        # http://localhost:3000, no .env.local needed
```

For trials and workspaces against the emulators:

1. Copy `.env.example` to `.env.local` with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-fleetdesk` and any non-empty placeholder for the other `NEXT_PUBLIC_FIREBASE_*` values.
2. `pnpm exec firebase emulators:start --only auth,firestore,storage --project demo-fleetdesk`
3. In another terminal, `pnpm demo:seed` fills a paid workspace (`demo`) with the sample business, with sign-ins for the demo accounts above; or `pnpm bootstrap:admin -- you@example.com <password>` creates an empty one.
4. `pnpm dev`, then sign in from the welcome page.

`pnpm demo:hosted` still creates a separate hosted Firebase demo project; with the in-browser demo it is rarely needed.

## Inventory import

A sample workbook with fictional vehicles is in `samples/sample-inventory.xlsx`; an operator's own workbook needs the same `INVENTORY` sheet layout. The import deliberately flags missing VINs, years, insurance expirations, and rates; it does not silently invent values.

```powershell
pnpm import:inventory -- --file "./samples/sample-inventory.xlsx"
pnpm import:inventory -- --file "./samples/sample-inventory.xlsx" --commit --workspace <workspaceId>
```

The first command is dry-run. `--commit` is required to write, and each run creates a timestamped report under `reports/`. See `docs/migration.md` before importing production data.

## Commands

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rules
pnpm verify
```

## Workspaces, staff and licences

Every operator's data lives under `workspaces/{workspaceId}/` in one Firebase project; `accounts/{uid}` says which workspace an account belongs to. The application code addresses plain collection names and `lib/data/firestore.ts` places them in the signed-in account's workspace (or in the in-browser demo store).

- Starting a trial creates the workspace, the administrator's approved profile, their account entry and a claim on their email in one write; the rules allow nothing else to create an approved profile.
- Staff register from the administrator's invite link (`/signup?workspace=…`) and wait, `status: "pending"`, until an administrator approves them with a role on the **Staff** screen.
- When a trial ends, the rules stop serving the workspace's data until it is paid. Members still see who to ask, and the administrator sees the plans.
- Email/Password and Google sign-in must be enabled in Firebase Authentication for trials and staff registration.

`pnpm licence list|activate|restart-trial|revoke` manages licences from your side; see [`docs/billing.md`](docs/billing.md).

See [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), [`docs/deployment.md`](docs/deployment.md) and [`docs/billing.md`](docs/billing.md).
