import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { audit } from "./auth.js";
import { config } from "./config.js";
import { db, ensureSchema } from "./db.js";
import { ApiError } from "./http.js";
import {
  getGatewayConnection,
  revealGatewayCredentials,
  type Provider,
} from "./gateways.js";

export const paymentSchema = z.object({
  amount: z.number().int().positive().max(100_000_000),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  routingRule: z
    .enum(["balanced", "lowest_fee", "lowest_latency"])
    .default("balanced"),
  idempotencyKey: z.string().trim().min(4).max(128),
  customerId: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});

const providerProfile: Record<
  Provider,
  { fee: number; latency: number; reliability: number }
> = {
  stripe: { fee: 2.9, latency: 310, reliability: 99.2 },
  razorpay: { fee: 2.0, latency: 260, reliability: 98.7 },
  paytm: { fee: 1.8, latency: 220, reliability: 98.9 },
};

export function selectProvider(
  providers: Provider[],
  rule: z.infer<typeof paymentSchema>["routingRule"],
): Provider {
  if (!providers.length) return "stripe";
  const sorted = [...providers].sort((left, right) => {
    const a = providerProfile[left];
    const b = providerProfile[right];
    if (rule === "lowest_fee") return a.fee - b.fee;
    if (rule === "lowest_latency") return a.latency - b.latency;
    return b.reliability - a.reliability || a.latency - b.latency;
  });
  return sorted[0];
}

function normalized(
  row: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    id: row.id,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    gateway: row.provider,
    gatewayTransactionId: row.provider_payment_id,
    idempotencyKey: row.idempotency_key,
    routedBy: row.routing_rule,
    mode: row.mode,
    createdAt: row.created_at,
    ...extra,
  };
}

function toMinorUnits(amount: number, currency: string) {
  const zeroDecimal = new Set([
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
  ]);
  return zeroDecimal.has(currency) ? amount : amount * 100;
}

async function runStripe(
  gateway: Awaited<ReturnType<typeof getGatewayConnection>>,
  input: z.infer<typeof paymentSchema>,
  transactionId: string,
) {
  if (!gateway)
    throw new ApiError(
      409,
      "GATEWAY_NOT_CONFIGURED",
      "Stripe is not connected",
    );
  const credentials = revealGatewayCredentials<{ accessToken: string }>(
    gateway,
  );
  const stripe = new Stripe(credentials.accessToken);
  const intent = await stripe.paymentIntents.create(
    {
      amount: toMinorUnits(input.amount, input.currency),
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: input.description,
      metadata: { payx_transaction_id: transactionId, ...input.metadata },
    },
    { idempotencyKey: input.idempotencyKey },
  );
  return {
    providerId: intent.id,
    status: intent.status,
    clientSecret: intent.client_secret,
  };
}

async function runRazorpay(
  gateway: Awaited<ReturnType<typeof getGatewayConnection>>,
  input: z.infer<typeof paymentSchema>,
  transactionId: string,
) {
  if (!gateway)
    throw new ApiError(
      409,
      "GATEWAY_NOT_CONFIGURED",
      "Razorpay is not connected",
    );
  const credentials = revealGatewayCredentials<{
    keyId: string;
    keySecret: string;
  }>(gateway);
  const authorization = Buffer.from(
    `${credentials.keyId}:${credentials.keySecret}`,
  ).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: toMinorUnits(input.amount, input.currency),
      currency: input.currency,
      receipt: transactionId,
      notes: input.metadata,
    }),
  });
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    error?: { description?: string };
  };
  if (!response.ok || !body.id)
    throw new ApiError(
      502,
      "GATEWAY_ERROR",
      body.error?.description ?? "Razorpay order creation failed",
    );
  return {
    providerId: body.id,
    status: body.status === "paid" ? "succeeded" : "requires_action",
    clientSecret: null,
  };
}

async function runPaytm(
  gateway: Awaited<ReturnType<typeof getGatewayConnection>>,
  input: z.infer<typeof paymentSchema>,
  transactionId: string,
) {
  if (!gateway)
    throw new ApiError(409, "GATEWAY_NOT_CONFIGURED", "Paytm is not connected");
  const credentials = revealGatewayCredentials<{
    merchantId: string;
    merchantKey: string;
    website: string;
  }>(gateway);
  const { default: PaytmChecksum } = await import("paytmchecksum");
  const body = {
    requestType: "Payment",
    mid: credentials.merchantId,
    websiteName: credentials.website,
    orderId: transactionId,
    txnAmount: { value: input.amount.toFixed(2), currency: input.currency },
    userInfo: {
      custId:
        input.customerId ??
        `guest_${createHash("sha256").update(transactionId).digest("hex").slice(0, 12)}`,
    },
  };
  const signature = await PaytmChecksum.generateSignature(
    JSON.stringify(body),
    credentials.merchantKey,
  );
  const host =
    gateway.mode === "live"
      ? "https://securegw.paytm.in"
      : "https://securegw-stage.paytm.in";
  const response = await fetch(
    `${host}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(credentials.merchantId)}&orderId=${encodeURIComponent(transactionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, head: { signature } }),
    },
  );
  const result = (await response.json()) as {
    body?: { txnToken?: string; resultInfo?: { resultMsg?: string } };
  };
  if (!response.ok || !result.body?.txnToken)
    throw new ApiError(
      502,
      "GATEWAY_ERROR",
      result.body?.resultInfo?.resultMsg ??
        "Paytm transaction initialization failed",
    );
  return {
    providerId: transactionId,
    status: "requires_action",
    clientSecret: result.body.txnToken,
  };
}

export async function createPayment(actor: Actor, inputValue: unknown) {
  await ensureSchema();
  const input = paymentSchema.parse(inputValue);
  const sql = db();
  const existing = await sql<Record<string, unknown>[]>`
    SELECT * FROM transactions WHERE organization_id = ${actor.organizationId}
      AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
  if (existing[0])
    return { transaction: normalized(existing[0]), duplicate: true };

  const connections = await sql<{ provider: Provider }[]>`
    SELECT provider FROM gateway_connections WHERE organization_id = ${actor.organizationId}
      AND mode = ${actor.mode} AND status = 'connected'`;
  const provider = selectProvider(
    connections.map((row) => row.provider),
    input.routingRule,
  );
  const id = `px_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const initialStatus = config.sandboxOnly ? "succeeded" : "created";
  const inserted = await sql<Record<string, unknown>[]>`
    INSERT INTO transactions
      (id, organization_id, amount, currency, status, provider, idempotency_key, routing_rule, mode, metadata)
    VALUES (${id}, ${actor.organizationId}, ${input.amount}, ${input.currency}, ${initialStatus}, ${provider},
      ${input.idempotencyKey}, ${input.routingRule}, ${actor.mode}, ${sql.json(input.metadata)})
    ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    RETURNING *`;
  if (!inserted[0]) {
    const duplicate = await sql<Record<string, unknown>[]>`
      SELECT * FROM transactions WHERE organization_id = ${actor.organizationId}
        AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
    return { transaction: normalized(duplicate[0]), duplicate: true };
  }

  if (config.sandboxOnly) {
    const providerId = `${provider}_test_${randomUUID().slice(0, 8)}`;
    const rows = await sql<Record<string, unknown>[]>`
      UPDATE transactions SET provider_payment_id = ${providerId}, updated_at = NOW()
      WHERE id = ${id} RETURNING *`;
    await audit(actor, "payment.created", "transaction", id, {
      provider,
      sandbox: true,
    });
    return {
      transaction: normalized(rows[0]),
      duplicate: false,
      sandbox: true,
    };
  }

  try {
    const connection = await getGatewayConnection(
      actor.organizationId,
      provider,
      actor.mode,
    );
    const result =
      provider === "stripe"
        ? await runStripe(connection, input, id)
        : provider === "razorpay"
          ? await runRazorpay(connection, input, id)
          : await runPaytm(connection, input, id);
    const rows = await sql<Record<string, unknown>[]>`
      UPDATE transactions SET status = ${result.status}, provider_payment_id = ${result.providerId}, updated_at = NOW()
      WHERE id = ${id} RETURNING *`;
    await audit(actor, "payment.created", "transaction", id, {
      provider,
      sandbox: false,
    });
    return {
      transaction: normalized(rows[0], { clientSecret: result.clientSecret }),
      duplicate: false,
      sandbox: false,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Gateway request failed";
    await sql`UPDATE transactions SET status = 'failed', failure_code = 'gateway_error', failure_message = ${message}, updated_at = NOW() WHERE id = ${id}`;
    throw error;
  }
}

export async function listTransactions(actor: Actor, limit = 50) {
  await ensureSchema();
  const sql = db();
  const safeLimit = Math.max(1, Math.min(100, limit));
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM transactions WHERE organization_id = ${actor.organizationId}
    ORDER BY created_at DESC LIMIT ${safeLimit}`;
  return rows.map((row) => normalized(row));
}
