import type { Transaction } from "./payxEngine";

export type Session = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; plan?: string };
  role: string;
};

export type ConnectedGateway = {
  id: string;
  provider: "stripe" | "razorpay" | "paytm";
  mode: "test" | "live";
  status: "connected" | "degraded" | "disabled";
  accountId: string | null;
  metadata: Record<string, unknown>;
};

export type Checkout =
  | { kind: "redirect"; url: string }
  | { kind: "razorpay"; keyId: string; orderId: string; amount: number; currency: string }
  | { kind: "paytm"; merchantId: string; orderId: string; token: string; amount: string; mode: "test" | "live" };

export type Mode = "test" | "live";
const modeHeader = (mode: Mode) => ({ "X-PayX-Mode": mode });

type ApiErrorBody = { error?: { code?: string; message?: string } };

export class PayXApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayXApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok)
    throw new PayXApiError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "Request failed",
    );
  return body;
}

function titleCaseProvider(value: string) {
  if (value === "stripe") return "Stripe";
  if (value === "razorpay") return "Razorpay";
  if (value === "paytm") return "Paytm";
  return value;
}

function normalizeTransaction(value: Record<string, unknown>): Transaction {
  return {
    id: String(value.id),
    createdAt: String(value.createdAt),
    amount: Number(value.amount),
    currency: String(value.currency),
    gateway: titleCaseProvider(String(value.gateway)),
    status: String(value.status) as Transaction["status"],
    idempotencyKey: String(value.idempotencyKey),
    gatewayTransactionId: value.gatewayTransactionId
      ? String(value.gatewayTransactionId)
      : "pending",
    routedBy: String(value.routedBy),
  };
}

export const api = {
  health: () => request<{ status: string; database: "configured" | "not_configured" | "unavailable"; mode: string; stripeOAuth: boolean; liveEnabled: boolean; stripeLiveOAuth: boolean }>("/api/health"),
  me: () => request<Session>("/api/auth/me"),
  register: (input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
  }) =>
    request<Session>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  login: (input: { email: string; password: string }) =>
    request<Session>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () =>
    request<{ signedOut: boolean }>("/api/auth/logout", { method: "POST" }),
  transactions: async (mode: Mode = "test") => {
    const result = await request<{ transactions: Record<string, unknown>[] }>(
      "/api/payments", { headers: modeHeader(mode) },
    );
    return result.transactions.map(normalizeTransaction);
  },
  createPayment: async (input: {
    amount: number;
    currency: string;
    routingRule: string;
    idempotencyKey: string;
    preferredGateway?: "stripe" | "razorpay" | "paytm";
    mode: Mode;
  }) => {
    const result = await request<{
      transaction: Record<string, unknown> & { checkout?: Checkout };
      duplicate: boolean;
      sandbox?: boolean;
    }>("/api/payments", { method: "POST", headers: modeHeader(input.mode), body: JSON.stringify(input) });
    return { ...result, checkout: result.transaction.checkout, transaction: normalizeTransaction(result.transaction) };
  },
  verifyRazorpay: (input: { transactionId: string; orderId: string; paymentId: string; signature: string; mode: Mode }) =>
    request<{ status: string }>("/api/payments/razorpay/verify", {
      method: "POST", headers: modeHeader(input.mode), body: JSON.stringify(input),
    }),
  gateways: async () =>
    (await request<{ gateways: ConnectedGateway[] }>("/api/gateways")).gateways,
  connectGateway: (input: Record<string, unknown>) =>
    request<{ gateway: ConnectedGateway }>("/api/gateways", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  apiKeys: async () => (await request<{ apiKeys: Array<{ id: string; name: string; prefix: string; mode: Mode; created_at: string }> }>("/api/api-keys")).apiKeys,
  createApiKey: (name: string, mode: Mode) => request<{ apiKey: { id: string; secret: string; mode: Mode; prefix: string } }>("/api/api-keys", {
    method: "POST", body: JSON.stringify({ name, mode }),
  }),
  revokeApiKey: (id: string) => request<{ revoked: boolean }>(`/api/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
};
