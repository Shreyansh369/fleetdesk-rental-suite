# Plans, trials and Stripe billing

## The offer

| | Subscription | Buy outright |
| --- | --- | --- |
| Paid when the plan is chosen | $599 | $1,299 |
| Monthly fee (subscription + maintenance) | $99 from month 3 | $99 from month 13 |
| Change requests included | Always (in the monthly fee) | First 3 months; quoted until month 13 |
| First 12 months in total | $1,589 | $1,299 (saves $290) |

Every plan starts with a free 7-day trial for one administrator email; no card is needed to start. Hosting, the database (Firebase), backups and security updates are included in the price. The only extras are at cost: an Android Play Store listing ($25 one-time) and a custom domain ($12/year). Installing the web app from a browser on any phone, tablet, computer or TV is free.

All of these numbers live in `lib/license.ts` (`PLANS`, `ADD_ONS`, `TRIAL_DAYS`). The pricing page, Billing screen, legal pages and the billing function all read them from there. `TRIAL_DAYS` is repeated in `firestore.rules`, which is what actually closes an expired trial; change both together.

## How a trial becomes a paid workspace

1. A visitor starts a trial at `/trial`. Their workspace is open for 7 days; the rules close it after that unless `workspaces/{id}.plan == "paid"`.
2. The administrator chooses a plan on **Billing** (or on the screen shown when the trial ends) and pays on Stripe's page.
3. The licence is switched on, either:
   - **automatically**, by the `stripeWebhook` function, when the billing function is deployed, or
   - **by you**, with `pnpm licence activate <workspace id or admin email> --plan <subscription|buyout>`, when Payment Links are used.
4. From then on Stripe charges the monthly fee automatically (autopay) when it starts. A failed payment is shown to the administrator with a link to the customer portal to update the card.

Nothing a browser can write changes `plan`, `licenceType`, `paidAt` or `trialStartedAt`; only the Admin SDK (the function or `scripts/licence.ts`) can.

## Stripe Dashboard setup (both ways)

Create three prices in **Product catalogue**:

| Product | Price | Type |
| --- | --- | --- |
| FleetDesk Subscription setup | $599 | One-off |
| FleetDesk Buy outright, first year | $1,299 | One-off |
| FleetDesk monthly plan | $99 | Recurring, monthly |

Then in **Settings**:

- **Branding**: logo and colours for Checkout.
- **Billing → Customer portal**: allow updating the payment method, viewing invoices and cancelling the subscription.
- **Payment methods**: enable what you accept.
- **Tax** (optional): automatic tax collection.

## Option A: Stripe Checkout through the billing function (recommended once orders come in)

This follows Stripe's *Sell subscriptions as a SaaS startup* guide: Checkout Sessions are created on the server, and webhooks provision access.

Each plan is one Stripe subscription with two line items: the plan's one-off price, charged at checkout, and the $99 monthly price, held back by `subscription_data.trial_end` until month 3 (Subscription) or month 13 (Buy outright). See `billing/src/logic.ts`.

1. Move the Firebase project to the **Blaze** plan (Cloud Functions need it; at this volume the cost is close to zero and is covered by the plan prices).
2. Set the configuration and secrets:

   ```bash
   pnpm exec firebase functions:secrets:set STRIPE_SECRET_KEY
   pnpm exec firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

   and in `billing/.env.<project id>`:

   ```
   STRIPE_PRICE_SUBSCRIPTION_SETUP=price_...
   STRIPE_PRICE_BUYOUT=price_...
   STRIPE_PRICE_MONTHLY=price_...
   APP_URL=https://your-site.example
   ```

3. Deploy: `pnpm exec firebase deploy --only functions:billing`.
4. In Stripe **Workbench → Webhooks**, add the `stripeWebhook` function URL and select `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. Build the site with `NEXT_PUBLIC_STRIPE_CHECKOUT_FUNCTION=true`.

**Test before going live.** In test mode, buy each plan with card `4242 4242 4242 4242` and check in the Dashboard that the one-off amount was charged at checkout and that the subscription shows a trial ending in month 3 or 13. The webhook only switches a licence on when the completed session's `payment_status` is `paid`; if Stripe ever deferred the one-off charge to the end of the subscription trial, the session would complete unpaid, the workspace would be flagged as *payment submitted* instead of opened, and you would see it in `pnpm licence list`.

## Option B: Payment Links (no server)

1. In Stripe, create one Payment Link per plan with the same two prices: the plan's one-off price plus the $99 monthly price with a free trial of 60 days (Subscription) or 365 days (Buy outright).
2. Set each link's confirmation page to redirect to `https://your-site.example/billing/success`.
3. Build with `NEXT_PUBLIC_STRIPE_LINK_SUBSCRIPTION`, `NEXT_PUBLIC_STRIPE_LINK_BUYOUT` and, optionally, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL` (the portal's login link).

The Billing page adds `client_reference_id=<workspace id>` and the administrator's email to the link. When a payment arrives, find it in Stripe (the workspace id is shown as the client reference), then:

```bash
gcloud auth application-default login
pnpm licence list --project <id>              # workspaces not yet paid; "PAYMENT SUBMITTED" means they returned from Stripe
pnpm licence activate <workspace id> --plan buyout --reference pi_... --project <id>
pnpm licence restart-trial <workspace id> --project <id>   # a fresh 7 days, for a sales follow-up
pnpm licence revoke <workspace id> --project <id>
```

## What is stored

- `workspaces/{id}`: `plan` (`trial` or `paid`), `licenceType`, `trialStartedAt`, `paidAt`, `paymentSubmittedAt`, `billingIssue`, `subscriptionCancelled`. Members can read it; only the Admin SDK changes the licence fields.
- `workspaceBilling/{id}`: Stripe customer and subscription ids and the last payment events. No browser can read it.
- `stripeEvents/{eventId}`: webhook deliveries already applied, so a retried delivery is applied once.

A cancelled or failing subscription is recorded and shown, but does not close the workspace on its own; `pnpm licence revoke` does, when you decide to.
