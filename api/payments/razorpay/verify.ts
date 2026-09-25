import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { requireActor } from "../../../server/auth.js";
import { db } from "../../../server/db.js";
import { getGatewayConnection, revealGatewayCredentials } from "../../../server/gateways.js";
import { allowMethods, ApiError, ok, withApi } from "../../../server/http.js";
import { toMinorUnits } from "../../../server/payments.js";
import { verifyCheckoutSignature } from "../../../server/razorpay.js";

const inputSchema = z.object({
  transactionId: z.string().startsWith("px_").max(64),
  paymentId: z.string().startsWith("pay_").max(128),
  orderId: z.string().startsWith("order_").max(128),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    const actor = await requireActor(req);
    const input = inputSchema.parse(req.body);
    const sql = db();
    const rows = await sql<{ id: string; amount: number; currency: string; status: string }[]>`
      SELECT id, amount, currency, status FROM transactions
      WHERE id = ${input.transactionId} AND organization_id = ${actor.organizationId}
        AND provider = 'razorpay' AND mode = ${actor.mode}
        AND provider_payment_id = ${input.orderId} LIMIT 1`;
    const transaction = rows[0];
    if (!transaction) throw new ApiError(404, "NOT_FOUND", "Payment not found");
    const connection = await getGatewayConnection(actor.organizationId, "razorpay", actor.mode);
    if (!connection) throw new ApiError(409, "GATEWAY_NOT_CONFIGURED", "Razorpay is not connected");
    const { keyId, keySecret } = revealGatewayCredentials<{ keyId: string; keySecret: string }>(connection);
    if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature, keySecret))
      throw new ApiError(400, "INVALID_SIGNATURE", "Razorpay checkout signature is invalid");
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    });
    if (!response.ok) throw new ApiError(502, "GATEWAY_UNAVAILABLE", "Unable to verify Razorpay payment status");
    const payment = await response.json() as { order_id?: string; amount?: number; currency?: string; status?: string };
    if (payment.order_id !== input.orderId || payment.amount !== toMinorUnits(Number(transaction.amount), transaction.currency) ||
        payment.currency !== transaction.currency)
      throw new ApiError(502, "PAYMENT_MISMATCH", "Razorpay returned different payment details");
    const status = payment.status === "captured" ? "succeeded" : "processing";
    await sql`UPDATE transactions SET status = ${status}, updated_at = NOW()
      WHERE id = ${transaction.id} AND (status <> 'succeeded' OR ${status} = 'succeeded')`;
    return ok(res, { transactionId: transaction.id, status });
  });
}
