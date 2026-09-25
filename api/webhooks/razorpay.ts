import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db, ensureSchema } from "../../server/db.js";
import { revealGatewayCredentials, type StoredGateway } from "../../server/gateways.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { toMinorUnits } from "../../server/payments.js";
import { readRawBody } from "../../server/rawBody.js";

export const config = { api: { bodyParser: false } };

function validSignature(raw: Buffer, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    const connectionId = typeof req.query.connection === "string" ? req.query.connection : "";
    if (!/^gw_[a-f0-9-]{36}$/.test(connectionId))
      throw new ApiError(400, "MISSING_CONNECTION", "Razorpay connection ID is required");
    await ensureSchema();
    const sql = db();
    const gateways = await sql<StoredGateway[]>`
      SELECT * FROM gateway_connections WHERE id = ${connectionId} AND provider = 'razorpay'
        AND status = 'connected' LIMIT 1`;
    const gateway = gateways[0];
    if (!gateway) throw new ApiError(404, "NOT_FOUND", "Gateway connection not found");
    const credentials = revealGatewayCredentials<{ webhookSecret: string }>(gateway);
    if (!credentials.webhookSecret)
      throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "Connect a Razorpay webhook secret");
    const signature = req.headers["x-razorpay-signature"];
    if (typeof signature !== "string")
      throw new ApiError(
        400,
        "MISSING_SIGNATURE",
        "Missing Razorpay signature",
      );
    const raw = await readRawBody(req);
    if (!validSignature(raw, signature, credentials.webhookSecret))
      throw new ApiError(
        400,
        "INVALID_SIGNATURE",
        "Invalid Razorpay webhook signature",
      );
    const event = JSON.parse(raw.toString("utf8")) as {
      event: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            status?: string;
            amount?: number;
            currency?: string;
            error_description?: string;
          };
        };
      };
    };
    const providerId =
      event.payload?.payment?.entity?.order_id ??
      event.payload?.payment?.entity?.id;
    const status =
      event.event === "payment.captured"
        ? "succeeded"
        : event.event === "payment.failed"
          ? "failed"
          : null;
    const eventId = `${gateway.id}:${req.headers["x-razorpay-event-id"] ?? createHmac("sha256", credentials.webhookSecret).update(raw).digest("hex")}`;
    const transaction = providerId && status ? await sql<{ id: string; amount: number; currency: string }[]>`
      SELECT id, amount, currency FROM transactions
      WHERE organization_id = ${gateway.organization_id} AND mode = ${gateway.mode}
        AND provider = 'razorpay' AND provider_payment_id = ${providerId} LIMIT 1` : [];
    const payment = event.payload?.payment?.entity;
    if (transaction[0] && payment &&
        (payment.amount !== toMinorUnits(Number(transaction[0].amount), transaction[0].currency)
          || payment.currency !== transaction[0].currency))
      throw new ApiError(400, "PAYMENT_MISMATCH", "Razorpay amount or currency does not match");
    if (transaction[0] && status)
      await sql`UPDATE transactions SET status = ${status},
        failure_message = ${status === "failed" ? payment?.error_description ?? "Payment failed" : null},
        updated_at = NOW() WHERE id = ${transaction[0].id}
          AND (status <> 'succeeded' OR ${status} = 'succeeded')`;
    const inserted = await sql`INSERT INTO webhook_events
      (id, provider, provider_event_id, organization_id, event_type, payload)
      VALUES (${`evt_${randomUUID()}`}, 'razorpay', ${eventId}, ${gateway.organization_id},
        ${event.event}, ${sql.json(event)})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    return ok(res, { received: true, duplicate: !inserted.length });
  });
}
