import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { config as appConfig } from "../../server/config.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { readRawBody } from "../../server/rawBody.js";

export const config = { api: { bodyParser: false } };

function mapStatus(type: string) {
  if (type === "payment_intent.succeeded") return "succeeded";
  if (
    type === "payment_intent.payment_failed" ||
    type === "payment_intent.canceled"
  )
    return "failed";
  if (type === "payment_intent.processing") return "processing";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    if (!appConfig.stripeWebhookSecret || !appConfig.stripeSecretKey)
      throw new ApiError(
        503,
        "STRIPE_WEBHOOK_NOT_CONFIGURED",
        "Stripe webhook credentials are missing",
      );
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string")
      throw new ApiError(400, "MISSING_SIGNATURE", "Missing Stripe signature");
    const raw = await readRawBody(req);
    const stripe = new Stripe(appConfig.stripeSecretKey);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        signature,
        appConfig.stripeWebhookSecret,
      );
    } catch {
      throw new ApiError(
        400,
        "INVALID_SIGNATURE",
        "Invalid Stripe webhook signature",
      );
    }
    await ensureSchema();
    const sql = db();
    const inserted =
      await sql`INSERT INTO webhook_events (id, provider, provider_event_id, organization_id, event_type, payload)
      VALUES (${`evt_${randomUUID()}`}, 'stripe', ${event.id}, NULL, ${event.type}, ${sql.json(JSON.parse(JSON.stringify(event)))})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    if (!inserted.length) return ok(res, { received: true, duplicate: true });
    const status = mapStatus(event.type);
    if (status && event.data.object.object === "payment_intent") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payxId = intent.metadata.payx_transaction_id;
      if (payxId) {
        await sql`UPDATE transactions SET status = ${status}, provider_payment_id = ${intent.id},
          failure_message = ${intent.last_payment_error?.message ?? null}, updated_at = NOW()
          WHERE id = ${payxId} AND provider = 'stripe'`;
      }
    }
    return ok(res, { received: true });
  });
}
