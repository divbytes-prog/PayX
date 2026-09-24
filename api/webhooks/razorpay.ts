import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config as appConfig } from "../../server/config.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
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
    if (!appConfig.razorpayWebhookSecret)
      throw new ApiError(
        503,
        "RAZORPAY_WEBHOOK_NOT_CONFIGURED",
        "Razorpay webhook secret is missing",
      );
    const signature = req.headers["x-razorpay-signature"];
    if (typeof signature !== "string")
      throw new ApiError(
        400,
        "MISSING_SIGNATURE",
        "Missing Razorpay signature",
      );
    const raw = await readRawBody(req);
    if (!validSignature(raw, signature, appConfig.razorpayWebhookSecret))
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
    await ensureSchema();
    const sql = db();
    const eventId = createHmac("sha256", appConfig.razorpayWebhookSecret)
      .update(raw)
      .digest("hex");
    const inserted =
      await sql`INSERT INTO webhook_events (id, provider, provider_event_id, organization_id, event_type, payload)
      VALUES (${`evt_${randomUUID()}`}, 'razorpay', ${eventId}, NULL, ${event.event}, ${sql.json(JSON.parse(JSON.stringify(event)))})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    if (inserted.length && providerId && status) {
      await sql`UPDATE transactions SET status = ${status}, failure_message = ${event.payload?.payment?.entity?.error_description ?? null}, updated_at = NOW()
        WHERE provider = 'razorpay' AND provider_payment_id = ${providerId}`;
    }
    return ok(res, { received: true, duplicate: !inserted.length });
  });
}
