import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { audit } from "./auth.js";
import { config, stripePlatform } from "./config.js";
import { db, ensureSchema } from "./db.js";
import { ApiError } from "./http.js";
import { decryptCredentials, encryptCredentials } from "./security.js";

export type Provider = "stripe" | "razorpay" | "paytm";
export type GatewayMode = "test" | "live";

export type StoredGateway = {
  id: string;
  organization_id: string;
  provider: Provider;
  mode: GatewayMode;
  status: "connected" | "degraded" | "disabled";
  encrypted_credentials: string | null;
  provider_account_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const connectionSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("razorpay"),
    mode: z.enum(["test", "live"]).default("test"),
    keyId: z.string().min(8).max(128),
    keySecret: z.string().min(8).max(256),
    webhookSecret: z.string().min(12).max(256).optional(),
  }),
  z.object({
    provider: z.literal("paytm"),
    mode: z.enum(["test", "live"]).default("test"),
    merchantId: z.string().min(4).max(64),
    merchantKey: z.string().min(8).max(256),
    website: z.string().min(2).max(64).default("WEBSTAGING"),
  }),
]);

export async function listGateways(actor: Actor) {
  await ensureSchema();
  const sql = db();
  const rows = await sql<StoredGateway[]>`
    SELECT id, provider, mode, status, provider_account_id, metadata, created_at, updated_at
    FROM gateway_connections
    WHERE organization_id = ${actor.organizationId}
    ORDER BY provider, mode`;
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    accountId: row.provider_account_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function validateRazorpay(keyId: string, keySecret: string) {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments?count=1", {
    headers: { Authorization: `Basic ${authorization}` },
  });
  if (response.status === 401)
    throw new ApiError(
      400,
      "INVALID_GATEWAY_CREDENTIALS",
      "Razorpay rejected these credentials",
    );
  if (!response.ok)
    throw new ApiError(
      502,
      "GATEWAY_UNAVAILABLE",
      "Razorpay could not validate the credentials",
    );
}

export async function saveCredentialGateway(actor: Actor, input: unknown) {
  const parsed = connectionSchema.parse(input);
  if (parsed.mode === "live" && config.sandboxOnly) {
    throw new ApiError(
      409,
      "SANDBOX_ONLY",
      "Set PAYX_SANDBOX_ONLY=false only after live credentials and webhooks are verified",
    );
  }
  if (parsed.provider === "razorpay") {
    const prefix = parsed.mode === "live" ? "rzp_live_" : "rzp_test_";
    if (!parsed.keyId.startsWith(prefix))
      throw new ApiError(400, "INVALID_GATEWAY_MODE", `Use a ${parsed.mode} Razorpay key`);
    if (parsed.mode === "live" && !parsed.webhookSecret)
      throw new ApiError(400, "WEBHOOK_NOT_CONFIGURED", "A Razorpay webhook secret is required for live mode");
  }
  if (parsed.provider === "paytm" && parsed.mode === "live" && !config.appUrl.startsWith("https://"))
    throw new ApiError(503, "CALLBACK_NOT_CONFIGURED", "A public HTTPS APP_URL is required for live Paytm callbacks");
  if (parsed.provider === "razorpay")
    await validateRazorpay(parsed.keyId, parsed.keySecret);
  const credentials =
    parsed.provider === "razorpay"
      ? { keyId: parsed.keyId, keySecret: parsed.keySecret, webhookSecret: parsed.webhookSecret ?? "" }
      : {
          merchantId: parsed.merchantId,
          merchantKey: parsed.merchantKey,
          website: parsed.website,
        };
  const metadata =
    parsed.provider === "razorpay"
      ? { keyIdSuffix: parsed.keyId.slice(-4), validation: "provider_api" }
      : {
          merchantId: parsed.merchantId,
          website: parsed.website,
          validation: "first_transaction",
        };
  const sql = db();
  const id = `gw_${randomUUID()}`;
  const encrypted = encryptCredentials(credentials);
  const rows = await sql<StoredGateway[]>`
    INSERT INTO gateway_connections
      (id, organization_id, provider, mode, status, encrypted_credentials, provider_account_id, metadata)
    VALUES
      (${id}, ${actor.organizationId}, ${parsed.provider}, ${parsed.mode}, 'connected', ${encrypted},
       ${parsed.provider === "paytm" ? parsed.merchantId : parsed.keyId}, ${sql.json(metadata)})
    ON CONFLICT (organization_id, provider, mode) DO UPDATE SET
      status = 'connected', encrypted_credentials = EXCLUDED.encrypted_credentials,
      provider_account_id = EXCLUDED.provider_account_id, metadata = EXCLUDED.metadata, updated_at = NOW()
    RETURNING *`;
  await audit(actor, "gateway.connected", "gateway_connection", rows[0].id, {
    provider: parsed.provider,
    mode: parsed.mode,
  });
  return {
    provider: parsed.provider,
    mode: parsed.mode,
    status: "connected",
    metadata,
  };
}

export async function saveStripeOAuthConnection(actor: Actor, code: string, requestedMode: GatewayMode) {
  const platform = stripePlatform(requestedMode);
  const stripe = new Stripe(platform.secretKey);
  const token = await stripe.oauth.token({
    grant_type: "authorization_code",
    code,
  });
  if (!token.stripe_user_id)
    throw new ApiError(
      502,
      "STRIPE_OAUTH_FAILED",
      "Stripe did not return a connected account",
    );
  const mode: GatewayMode = token.livemode ? "live" : "test";
  if (mode !== requestedMode)
    throw new ApiError(400, "INVALID_GATEWAY_MODE", "Stripe returned a different account mode");
  if (mode === "live" && config.sandboxOnly)
    throw new ApiError(
      409,
      "SANDBOX_ONLY",
      "Live Stripe connections are disabled while PAYX_SANDBOX_ONLY=true",
    );
  const sql = db();
  const id = `gw_${randomUUID()}`;
  const metadata = {
    scope: token.scope ?? "read_write",
  };
  await sql`INSERT INTO gateway_connections
      (id, organization_id, provider, mode, status, encrypted_credentials, provider_account_id, metadata)
    VALUES (${id}, ${actor.organizationId}, 'stripe', ${mode}, 'connected', ${null}, ${token.stripe_user_id}, ${sql.json(metadata)})
    ON CONFLICT (organization_id, provider, mode) DO UPDATE SET
      status = 'connected', encrypted_credentials = NULL,
      provider_account_id = EXCLUDED.provider_account_id, metadata = EXCLUDED.metadata, updated_at = NOW()`;
  await audit(actor, "gateway.connected", "gateway_connection", id, {
    provider: "stripe",
    mode,
  });
  return { provider: "stripe" as const, mode, accountId: token.stripe_user_id };
}

export async function getGatewayConnection(
  organizationId: string,
  provider: Provider,
  mode: GatewayMode,
) {
  const sql = db();
  const rows = await sql<StoredGateway[]>`
    SELECT * FROM gateway_connections
    WHERE organization_id = ${organizationId} AND provider = ${provider} AND mode = ${mode}
      AND status = 'connected'
    LIMIT 1`;
  return rows[0] ?? null;
}

export function revealGatewayCredentials<T extends Record<string, unknown>>(
  gateway: StoredGateway,
): T {
  if (!gateway.encrypted_credentials)
    throw new ApiError(
      409,
      "GATEWAY_NOT_CONFIGURED",
      `${gateway.provider} credentials are missing`,
    );
  return decryptCredentials<T>(gateway.encrypted_credentials);
}
