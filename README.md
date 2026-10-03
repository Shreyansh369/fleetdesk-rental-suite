# FleetDesk

Secure, white-label operations software for car rental businesses: bookings, checkout and return, rental agreements, damage records, payments, expenses, finance and staff access in one place. Company name, logo and agreement terms are placeholders to be replaced per operator.

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

1. Copy `.env.example` to `.env.local` and fill in a **development** Firebase project configuration.
2. Install dependencies with `pnpm install`.
3. Run `pnpm exec firebase login`, then replace the staging/production aliases in `.firebaserc`. The default `demo-fleetdesk` alias is emulator-only and cannot deploy a real project.
4. Start local services: `pnpm exec firebase emulators:start`.
5. In another terminal run `pnpm dev` and open `http://localhost:3000`.

The application refuses to initialise Firebase until all public configuration values are present. Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` for local work.

## Demo data

To show the application to a prospective operator, fill the local emulators with fictional data — every name, number, address and vehicle is invented:

```powershell
pnpm exec firebase emulators:start --only auth,firestore,storage --project demo-fleetdesk
# in a second terminal
pnpm demo:seed
pnpm dev
```

For `pnpm dev`, `.env.local` needs `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-fleetdesk`, and any non-empty placeholder for the other `NEXT_PUBLIC_FIREBASE_*` values.

The seed signs in as each staff member and runs the same workflows the screens use, so it produces:

- 14 vehicles, one due for service, one in the workshop and one with insurance about to expire
- 18 customers, and about six months of finished rentals and running costs, so Finance has history to report on
- Bookings coming up, vehicles out on hire, one overdue, one returned today with fuel and cleaning to settle, and payments taken
- Two cancelled bookings with their reasons, a discount waiting for approval, one approved agreement and one waiting for review
- A staff sign-up waiting on the **Staff** screen

Sign in with any of these accounts; the password for all of them is `DemoPass123!`:

| Account | Role |
| --- | --- |
| `admin@demo.fleetdesk.app` | Administrator |
| `maria@demo.fleetdesk.app`, `james@demo.fleetdesk.app`, `priya@demo.fleetdesk.app` | Operations |
| `tom@demo.fleetdesk.app` | Waiting for approval |

The emulators start empty each time, so run `pnpm demo:seed` again after restarting them; it refuses to run on data that is already there. To seed a hosted demo project instead, point the `NEXT_PUBLIC_FIREBASE_*` values at it, sign in with `gcloud auth application-default login`, enable Email/Password sign-in, and run `pnpm demo:seed -- --remote --confirm=<projectId>`. It only seeds a project with no vehicles, so it cannot be pointed at an operator's live data by mistake.

## Inventory import

A sample workbook with fictional vehicles is in `samples/sample-inventory.xlsx`; an operator's own workbook needs the same `INVENTORY` sheet layout. The import deliberately flags missing VINs, years, insurance expirations, and rates; it does not silently invent values.

```powershell
pnpm import:inventory -- --file "./samples/sample-inventory.xlsx"
pnpm import:inventory -- --file "./samples/sample-inventory.xlsx" --commit
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

## Staff access

A new account registers itself and is stored with `status: "pending"`. It can sign in, and it reaches nothing: the security rules read `role` and `status` from `users/{uid}`. An administrator approves it and assigns the role on the **Staff** screen, and the account opens as soon as it does — no second sign-in needed.

Two things have to be true before anyone can register at all:

- **Email/Password and Google must be enabled** in Firebase Authentication → Sign-in method. They are off in a new project, and until then sign-in fails with `auth/operation-not-allowed` however correct the credentials are.
- **One administrator must exist already**, because approval is an administrator's decision. Seed the first one by hand — see [`docs/deployment.md`](docs/deployment.md).

Nothing is emailed when somebody registers. A waiting request shows as a count beside **Staff** in the sidebar, so an administrator sees it from any screen.

See [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), and [`docs/deployment.md`](docs/deployment.md).
