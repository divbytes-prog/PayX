import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { checkoutExpiresAt, validateCheckoutToken } from "../../server/checkoutLink.js";
import { config } from "../../server/config.js";
import { db, ensureSchema } from "../../server/db.js";
import { getGatewayConnection, revealGatewayCredentials } from "../../server/gateways.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { toMinorUnits, type Checkout } from "../../server/payments.js";
import { verifyCheckoutSignature } from "../../server/razorpay.js";

const verifySchema = z.object({
  token: z.string().max(128),
  paymentId: z.string().startsWith("pay_").max(128),
  orderId: z.string().startsWith("order_").max(128),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
});

type PublicPayment = {
  id: string; organization_id: string; organization_name: string;
  amount: number; currency: string; status: string; provider: "stripe" | "razorpay" | "paytm";
  mode: "test" | "live"; created_at: Date; checkout_data: Checkout | Record<string, never>;
  provider_payment_id: string | null;
};

async function findPayment(token: string) {
  const id = token.split(".")[0];
  if (!/^px_[a-f0-9]{20}$/.test(id))
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  await ensureSchema();
  const sql = db();
  const rows = await sql<PublicPayment[]>`
    SELECT t.id, t.organization_id, o.name AS organization_name, t.amount, t.currency,
      t.status, t.provider, t.mode, t.created_at, t.checkout_data, t.provider_payment_id
    FROM transactions t JOIN organizations o ON o.id = t.organization_id
    WHERE t.id = ${id} LIMIT 1`;
  const payment = rows[0];
  if (!payment || payment.status === "simulated")
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  validateCheckoutToken(token, payment.id, payment.mode);
  return payment;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET", "POST"]);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const payment = await findPayment(token);
      const expiresAt = checkoutExpiresAt(payment.created_at, payment.provider);
      const canPay = Date.now() < expiresAt.getTime() &&
        !["succeeded", "failed"].includes(payment.status) &&
        (payment.mode === "test" || !config.sandboxOnly);
      return ok(res, {
        id: payment.id, merchant: payment.organization_name,
        amount: Number(payment.amount), currency: payment.currency,
        status: payment.status, provider: payment.provider, mode: payment.mode,
        expiresAt: expiresAt.toISOString(),
        checkout: canPay && "kind" in payment.checkout_data ? payment.checkout_data : null,
      });
    }

    const origin = req.headers.origin;
    if (!origin || !URL.canParse(origin) || new URL(origin).host !== req.headers.host)
      throw new ApiError(403, "INVALID_ORIGIN", "Verification must come from the checkout site");
    const input = verifySchema.parse(req.body);
    const payment = await findPayment(input.token);
    if (payment.provider !== "razorpay" || payment.provider_payment_id !== input.orderId)
      throw new ApiError(404, "NOT_FOUND", "Razorpay order not found");
    if (payment.status === "succeeded") return ok(res, { status: "succeeded" });
    const connection = await getGatewayConnection(payment.organization_id, "razorpay", payment.mode);
    if (!connection) throw new ApiError(409, "GATEWAY_NOT_CONFIGURED", "Razorpay is not connected");
    const { keyId, keySecret } = revealGatewayCredentials<{ keyId: string; keySecret: string }>(connection);
    if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature, keySecret))
      throw new ApiError(400, "INVALID_SIGNATURE", "Razorpay checkout signature is invalid");
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    });
    if (!response.ok) throw new ApiError(502, "GATEWAY_UNAVAILABLE", "Unable to verify Razorpay payment status");
    const providerPayment = await response.json() as { order_id?: string; amount?: number; currency?: string; status?: string };
    if (providerPayment.order_id !== input.orderId ||
        providerPayment.amount !== toMinorUnits(Number(payment.amount), payment.currency) ||
        providerPayment.currency !== payment.currency)
      throw new ApiError(502, "PAYMENT_MISMATCH", "Razorpay returned different payment details");
    const status = providerPayment.status === "captured" ? "succeeded" : "processing";
    const sql = db();
    await sql`UPDATE transactions SET status = ${status}, updated_at = NOW()
      WHERE id = ${payment.id} AND (status <> 'succeeded' OR ${status} = 'succeeded')`;
    return ok(res, { status });
  });
}
