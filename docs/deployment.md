# Deployment and recovery

## Rules are not deployed by merging

Firestore and Storage rules ship separately from the web build. Merging a pull request, and deploying hosting, both leave the rules in the live project exactly as they were.

The symptom when they fall behind is specific and misleading: a screen reports **"Your account does not have permission for this action."** to a user who has every permission, because the application is reading a collection the deployed rules do not mention and the default deny catches it. It is not an account problem and re-granting a role will not fix it.

So whenever a release adds or renames a collection, deploy the rules with it:

```bash
pnpm exec firebase deploy --project <project-id> --only firestore:rules,firestore:indexes
```

`tests/rules/firestore.rules.test.ts` asserts that every collection the client reads is matched by a rule in this repository, which catches the rule that was never written. It cannot see what is actually deployed, so the deploy step above is still yours to run.

Releases that have needed it so far: `reservationContracts` and its `versions`/`deliveries` subcollections, and `rentals/{id}/extensions`.

## Firebase Storage is not used

Media lives in Cloudinary: vehicle photos, condition evidence and driver's licence images all upload straight there. The only remaining reference to Firebase Storage is a fallback in `components/customer-license-capture.tsx` that resolves licence images captured *before* that migration, and it is dead on any project whose bucket was never provisioned.

So Storage is deliberately left unprovisioned, and `storage` is not in the deploy targets. Setting it up is what would force the Blaze plan; nothing in the application needs it. Attempting to deploy it on a project without a bucket fails with:

```
Error: Firebase Storage has not been set up on project '<id>'.
```

`storage.rules` and its tests are kept because they are correct and reviewed, and `firebase.json` still configures the Storage emulator so `pnpm test:rules` can exercise them. If Storage is ever genuinely needed — a migration away from Cloudinary, say — provision the bucket, add `storage` back to the `--only` list here and in `.github/workflows/deploy.yml`, and deploy the rules with it. Never enable the bucket without deploying those rules.

## Environment separation

Create three separate Firebase projects: development, staging and production. Register a web app in each and give only its public configuration to the matching environment file. Never set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` outside local development.

Before the first staging deployment:

1. Enable **Email/Password** and **Google** in Firebase Authentication → Sign-in method. Both are off in a new project, and until Email/Password is switched on every sign-in and registration fails with `auth/operation-not-allowed`, which the screens report as "Email and password sign-in is not enabled in Firebase Authentication". No amount of approval in this application works around it: the account cannot authenticate at all.
2. Seed the very first administrator directly in the Firestore console — approval requires an existing administrator, so nobody can approve the first one. Create the Authentication user, then write `users/{uid}` with `role: "admin"`, `status: "approved"` and `requestedRole: "admin"`. Every administrator after that is approved from the **Staff** screen in the application. Staff register themselves from the Sign up screen, which creates the pending profile the Staff screen lists.
3. Create the Firestore database. Do **not** set up Firebase Storage — see below. Set the Cloudinary cloud name and unsigned upload preset, and the reCAPTCHA Enterprise site key, in the corresponding hosting environment.
4. Replace `.firebaserc` aliases with real staging/production project IDs locally only if the repository is private; preferably use `firebase use --add` and keep deployment mapping in a secure CI environment.
5. Deploy rules and indexes first to staging: `pnpm exec firebase deploy --project <staging-project-id> --only firestore:rules,firestore:indexes`. Pass `--project` explicitly rather than relying on the `.firebaserc` default, which points at the emulator project.
6. Deploy web hosting only after `pnpm verify`, `pnpm test:rules`, and an approved staging acceptance run. Cloud Functions are not part of the deployment: the project stays on the Spark plan and every workflow runs in the browser.

The supplied `Deploy` workflow is manual-only and uses protected GitHub environments. In each `staging` and `production` environment, configure `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, and `FIREBASE_PROJECT_ID`; set the remaining public web configuration as GitHub environment variables named `FIREBASE_*` and `RECAPTCHA_ENTERPRISE_SITE_KEY` (the workflow maps each one explicitly, so a variable it does not name never reaches the build); require production reviewer approval. The deployer service account needs only the Firebase Hosting and Firestore rules/index deployment permissions. App Check enforcement and a named rollback owner must be confirmed before its first production run.

## Sending an approved agreement

There is nothing to configure and nothing to deploy. Once an administrator approves a contract, the agreement screen offers:

- **Print** — saves the signed copy as a PDF.
- **Send with Gmail** — opens a compose window addressed to the customer, subject and body already written; the operator attaches the PDF and sends.
- **Send from my mail app** — the same message handed to whatever mail client is installed.
- **Copy agreement** — the same text on the clipboard, for WhatsApp or anything else.

Because the message leaves the office's own account, it arrives from the address the renter would reply to and there is no deliverability question, no sending domain to verify and no mail-provider credential anywhere in the system.

The clauses are deliberately not in the message body: fourteen of them do not fit in a compose URL, and the copy the renter signs is the printed one, which the operator attaches.

## Staff approval

A staff account that registers is stored with `status: "pending"` and reaches no data at all until an administrator approves it. That approval happens on the **Staff** screen, which is visible to administrators and lists every account waiting, with the role each one asked for. Approving assigns the role, declining and suspending withdraw access, and each decision is written with an audit record.

Nothing is emailed when somebody registers, and nothing needs deploying for the approval to work. A waiting request is surfaced by a live count beside **Staff** in the navigation, so an administrator sees it from any screen in the workspace. The first administrator is the exception, seeded by hand as described above, because approval requires an administrator who already exists.

## Release checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
- `pnpm test:rules` with the Firestore, Auth and Storage emulators (the Storage emulator covers `storage.rules`, which are not deployed — see above)
- dependency audit and secret scan
- staging workflow: customer → reservation → checkout → inspection → payment → return → final balance; test a duplicate payment and conflicting reservation
- contract workflow: submit for review → reject with a note → resubmit → approve → email, and confirm the delivery receipt records the provider message ID
- rules deployed before hosting, and the booking, customers and dashboard screens loaded once against the deployed rules with no permission error
- mobile browser verification for sign-in, photo capture and return inspection

## Recovery

- **Bad frontend:** redeploy the previously approved hosting build.
- **Bad rules:** restore the preceding reviewed rules file, deploy it, then run its emulator tests before reopening access.
- **Migration incident:** stop the import, preserve its report and `imports` document, restore affected documents from the pre-import Firestore export, and perform a reviewed reconciliation. Historic payments, refunds and ledger records are corrected with new compensating records rather than deletion.

The `functions/` directory is kept as the reference implementation of the rental workflows for a future move to the Blaze plan. It is not built, deployed or called by the application, and `pnpm verify` does not compile it.
