export type Gateway = {
  id: string;
  name: string;
  successRate: number;
  latency: number;
  fee: number;
  enabled: boolean;
  status: "healthy" | "degraded" | "offline";
};

export type Transaction = {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  gateway: string;
  status:
    | "created"
    | "requires_payment_method"
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled";
  idempotencyKey: string;
  gatewayTransactionId: string;
  routedBy: string;
};

export const defaultGateways: Gateway[] = [
  {
    id: "stripe",
    name: "Stripe",
    successRate: 99.2,
    latency: 310,
    fee: 2.9,
    enabled: true,
    status: "healthy",
  },
  {
    id: "razorpay",
    name: "Razorpay",
    successRate: 98.7,
    latency: 260,
    fee: 2.0,
    enabled: true,
    status: "healthy",
  },
  {
    id: "paytm",
    name: "Paytm",
    successRate: 98.9,
    latency: 220,
    fee: 1.8,
    enabled: true,
    status: "healthy",
  },
];

export function routePayment(
  gateways: Gateway[],
  rule: "balanced" | "lowest_fee" | "lowest_latency",
) {
  const healthy = gateways.filter((g) => g.enabled && g.status !== "offline");
  if (!healthy.length) return null;
  if (rule === "lowest_fee")
    return [...healthy].sort((a, b) => a.fee - b.fee)[0];
  if (rule === "lowest_latency")
    return [...healthy].sort((a, b) => a.latency - b.latency)[0];
  return [...healthy].sort(
    (a, b) => b.successRate - a.successRate || a.latency - b.latency,
  )[0];
}

export function simulatePayment(params: {
  amount: number;
  currency: string;
  idempotencyKey: string;
  gateways: Gateway[];
  rule: "balanced" | "lowest_fee" | "lowest_latency";
  existing: Transaction[];
}): { transaction: Transaction; duplicate: boolean } {
  const duplicate = params.existing.find(
    (t) => t.idempotencyKey === params.idempotencyKey,
  );
  if (duplicate) return { transaction: duplicate, duplicate: true };
  const gateway = routePayment(params.gateways, params.rule);
  const failed =
    !gateway || (gateway.status === "degraded" && Math.random() < 0.2);
  const id = `px_${crypto.randomUUID().slice(0, 10)}`;
  return {
    duplicate: false,
    transaction: {
      id,
      createdAt: new Date().toISOString(),
      amount: params.amount,
      currency: params.currency,
      gateway: gateway?.name ?? "No route",
      status: failed ? "failed" : "succeeded",
      idempotencyKey: params.idempotencyKey,
      gatewayTransactionId: failed
        ? "—"
        : `${gateway?.id}_${crypto.randomUUID().slice(0, 8)}`,
      routedBy: params.rule,
    },
  };
}
