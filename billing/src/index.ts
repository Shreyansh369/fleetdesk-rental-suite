import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import {
  defineSecret,
  defineString,
} from "firebase-functions/params";
import {
  HttpsError,
  onCall,
  onRequest,
} from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import Stripe from "stripe";

import {
  changeForEvent,
  checkoutSessionParams,
} from "./logic";

/*
 * FleetDesk billing on Stripe-hosted Checkout, following Stripe's
 * SaaS subscriptions guide: a Checkout Session is created on the
 * server, the customer pays on Stripe's page, and webhooks switch
 * the licence on and keep it in step with later payments.
 *
 *   createCheckoutSession  callable, workspace administrators only
 *   createPortalSession    callable, opens Stripe's customer portal
 *   stripeWebhook          HTTPS endpoint registered in Stripe
 *
 * Deployed as its own codebase (`firebase deploy --only
 * functions:billing`), which needs the Blaze plan. Configuration
 * and secrets are set as described in docs/billing.md. Stripe
 * customer and subscription ids live in workspaceBilling/{id},
 * which no browser can read.
 */

initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

const PRICE_SUBSCRIPTION_SETUP = defineString("STRIPE_PRICE_SUBSCRIPTION_SETUP");
const PRICE_BUYOUT = defineString("STRIPE_PRICE_BUYOUT");
const PRICE_MONTHLY = defineString("STRIPE_PRICE_MONTHLY");
const APP_URL = defineString("APP_URL");

const db = getFirestore();

function stripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value());
}

/* The caller's workspace, if they are an approved administrator of it. */
async function adminWorkspace(uid: string | undefined) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const account = await db.collection("accounts").doc(uid).get();
  const workspaceId = account.get("workspaceId");

  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("failed-precondition", "This account is not in a workspace.");
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [workspace, profile] = await Promise.all([
    workspaceRef.get(),
    workspaceRef.collection("users").doc(uid).get(),
  ]);

  if (
    !workspace.exists ||
    profile.get("status") !== "approved" ||
    profile.get("role") !== "admin"
  ) {
    throw new HttpsError("permission-denied", "Only a workspace administrator can manage billing.");
  }

  return { workspaceId, workspace };
}

export const createCheckoutSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const plan = (request.data as { plan?: unknown } | undefined)?.plan;

    if (plan !== "subscription" && plan !== "buyout") {
      throw new HttpsError("invalid-argument", "Choose a plan.");
    }

    const { workspaceId, workspace } = await adminWorkspace(request.auth?.uid);

    if (workspace.get("plan") === "paid") {
      throw new HttpsError("failed-precondition", "This workspace is already licensed.");
    }

    const billing = await db.collection("workspaceBilling").doc(workspaceId).get();

    const session = await stripe().checkout.sessions.create(
      checkoutSessionParams({
        plan,
        workspaceId,
        email: String(workspace.get("adminEmail") ?? request.auth?.token.email ?? ""),
        customerId: (billing.get("customerId") as string | undefined) ?? null,
        prices: {
          subscriptionSetup: PRICE_SUBSCRIPTION_SETUP.value(),
          buyout: PRICE_BUYOUT.value(),
          monthly: PRICE_MONTHLY.value(),
        },
        appUrl: APP_URL.value(),
        now: new Date(),
      }),
    );

    if (!session.url) {
      throw new HttpsError("internal", "Stripe did not return a checkout page.");
    }

    return { url: session.url };
  },
);

export const createPortalSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const { workspaceId } = await adminWorkspace(request.auth?.uid);
    const billing = await db.collection("workspaceBilling").doc(workspaceId).get();
    const customer = billing.get("customerId");

    if (typeof customer !== "string" || !customer) {
      throw new HttpsError("failed-precondition", "There is no billing account for this workspace yet.");
    }

    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${APP_URL.value().replace(/\/+$/, "")}/billing`,
    });

    return { url: session.url };
  },
);

export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (request, response) => {
    let event: Stripe.Event;

    try {
      event = stripe().webhooks.constructEvent(
        request.rawBody,
        String(request.headers["stripe-signature"] ?? ""),
        STRIPE_WEBHOOK_SECRET.value(),
      );
    } catch (error) {
      logger.warn("Rejected a webhook with a bad signature", error);
      response.status(400).send("Bad signature");
      return;
    }

    /* Stripe retries deliveries; each event is applied once. */
    const seen = db.collection("stripeEvents").doc(event.id);

    try {
      await seen.create({ type: event.type, receivedAt: FieldValue.serverTimestamp() });
    } catch {
      response.status(200).send("Already processed");
      return;
    }

    try {
      const change = changeForEvent(event, new Date());

      if (change) {
        let workspaceId = change.workspaceId;

        if (!workspaceId && change.customerId) {
          const match = await db
            .collection("workspaceBilling")
            .where("customerId", "==", change.customerId)
            .limit(1)
            .get();
          workspaceId = match.docs[0]?.id ?? null;
        }

        if (!workspaceId) {
          logger.warn(`No workspace for ${event.type} ${event.id}`);
        } else {
          const workspaceRef = db.collection("workspaces").doc(workspaceId);
          const stamp = (value: Record<string, unknown>) =>
            Object.fromEntries(
              Object.entries(value).map(([key, entry]) => [
                key,
                entry instanceof Date ? FieldValue.serverTimestamp() : entry,
              ]),
            );

          await db.runTransaction(async (transaction) => {
            const workspace = await transaction.get(workspaceRef);

            if (!workspace.exists) {
              throw new Error(`Workspace ${workspaceId} does not exist.`);
            }

            const update = stamp(change.workspace);

            /* A licence already on keeps its original payment date. */
            if (workspace.get("plan") === "paid") {
              delete update.paidAt;
            }

            transaction.update(workspaceRef, update);
            transaction.set(
              db.collection("workspaceBilling").doc(workspaceId!),
              { ...stamp(change.billing), updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            );
          });
        }
      }
    } catch (error) {
      /* Let Stripe retry: forget the event so the retry is applied. */
      await seen.delete().catch(() => undefined);
      logger.error(`Failed to apply ${event.type} ${event.id}`, error);
      response.status(500).send("Failed");
      return;
    }

    response.status(200).send("OK");
  },
);
