import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { config as appConfig } from "../../server/config.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { readRawBody } from "../../server/rawBody.js";
import { toMinorUnits } from "../../server/payments.js";

export const config = { api: { bodyParser: false } };

function mapStatus(type: string) {
  if (type === "payment_intent.succeeded" || type === "checkout.session.async_payment_succeeded") return "succeeded";
  if (
    type === "payment_intent.payment_failed" ||
    type === "payment_intent.canceled" ||
    type === "checkout.session.async_payment_failed"
  )
    return "failed";
  if (type === "payment_intent.processing") return "processing";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    if (!appConfig.stripeWebhookSecret && !appConfig.stripeLiveWebhookSecret)
      throw new ApiError(
        503,
        "STRIPE_WEBHOOK_NOT_CONFIGURED",
        "Stripe webhook credentials are missing",
      );
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string")
      throw new ApiError(400, "MISSING_SIGNATURE", "Missing Stripe signature");
    const raw = await readRawBody(req);
    const stripe = new Stripe(appConfig.stripeSecretKey || appConfig.stripeLiveSecretKey);
    let event: Stripe.Event | null = null;
    let mode: "test" | "live" | null = null;
    for (const candidate of [
      { mode: "test" as const, secret: appConfig.stripeWebhookSecret },
      { mode: "live" as const, secret: appConfig.stripeLiveWebhookSecret },
    ]) {
      if (!candidate.secret) continue;
      try {
        const verified = stripe.webhooks.constructEvent(raw, signature, candidate.secret);
        if (verified.livemode !== (candidate.mode === "live")) continue;
        event = verified;
        mode = candidate.mode;
        break;
      } catch { /* Try the other configured webhook secret. */ }
    }
    if (!mode || !event) {
      throw new ApiError(
        400,
        "INVALID_SIGNATURE",
        "Invalid Stripe webhook signature",
      );
    }
    await ensureSchema();
    const sql = db();
    let status = mapStatus(event.type);
    let paymentId = "";
    let amount: number | null = null;
    let currency = "";
    const data = event.data.object;
    if (data.object === "checkout.session") {
      const session = data as Stripe.Checkout.Session;
      paymentId = session.metadata?.payx_transaction_id ?? session.client_reference_id ?? "";
      amount = session.amount_total;
      currency = session.currency ?? "";
      if (event.type === "checkout.session.completed")
        status = session.payment_status === "paid" ? "succeeded" : "processing";
    } else if (data.object === "payment_intent") {
      const intent = data as Stripe.PaymentIntent;
      paymentId = intent.metadata.payx_transaction_id ?? "";
      amount = intent.amount;
      currency = intent.currency;
    }
    const transaction = paymentId && event.account ? await sql<{ id: string; amount: number; currency: string; organization_id: string }[]>`
      SELECT t.id, t.amount, t.currency, t.organization_id FROM transactions t
      JOIN gateway_connections g ON g.organization_id = t.organization_id
        AND g.provider = 'stripe' AND g.mode = t.mode AND g.status = 'connected'
        AND g.provider_account_id = ${event.account}
      WHERE t.id = ${paymentId} AND t.provider = 'stripe' AND t.mode = ${mode}
      LIMIT 1` : [];
    if (transaction[0] && status) {
      if (amount !== toMinorUnits(Number(transaction[0].amount), transaction[0].currency) ||
          currency.toUpperCase() !== transaction[0].currency)
        throw new ApiError(400, "PAYMENT_MISMATCH", "Stripe amount or currency does not match");
      await sql`UPDATE transactions SET status = ${status}, updated_at = NOW()
        WHERE id = ${transaction[0].id}
          AND (status <> 'succeeded' OR ${status} = 'succeeded')`;
    }
    const inserted = await sql`INSERT INTO webhook_events (id, provider, provider_event_id, organization_id, event_type, payload)
      VALUES (${`evt_${randomUUID()}`}, 'stripe', ${event.id}, ${transaction[0]?.organization_id ?? null},
        ${event.type}, ${sql.json({ id: event.id, account: event.account, type: event.type, mode })})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    return ok(res, { received: true, duplicate: !inserted.length });
  });
}
