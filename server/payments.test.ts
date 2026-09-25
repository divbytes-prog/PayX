import assert from "node:assert/strict";
import test from "node:test";
import { paymentSchema, selectProvider, fingerprint, toMinorUnits } from "./payments.js";
import { verifyCheckoutSignature } from "./razorpay.js";
import { createHmac } from "node:crypto";

test("routing policies select the expected provider", () => {
  const providers = ["stripe", "razorpay", "paytm"] as const;
  assert.equal(selectProvider([...providers], "balanced"), "stripe");
  assert.equal(selectProvider([...providers], "lowest_fee"), "paytm");
  assert.equal(selectProvider([...providers], "lowest_latency"), "paytm");
});

test("payment requests reject invalid values", () => {
  assert.equal(
    paymentSchema.safeParse({
      amount: 0,
      currency: "INR",
      idempotencyKey: "order_1",
    }).success,
    false,
  );
  assert.equal(
    paymentSchema.safeParse({
      amount: 1000,
      currency: "INR",
      idempotencyKey: "order_1",
    }).success,
    true,
  );
});

test("idempotency fingerprint rejects changed amount or mode and ignores metadata order", () => {
  const base = paymentSchema.parse({amount: 1000, currency: "inr", idempotencyKey: "order_1", metadata: {b:"2", a:"1"}});
  assert.equal(fingerprint(base, "test"), fingerprint(paymentSchema.parse({
    amount: 1000, currency: "INR", idempotencyKey: "order_1", metadata: {a:"1", b:"2"},
  }), "test"));
  assert.notEqual(fingerprint(base, "test"), fingerprint({...base, amount: 1001}, "test"));
  assert.notEqual(fingerprint(base, "test"), fingerprint(base, "live"));
});

test("Razorpay checkout signature binds both the stored order and payment ID", () => {
  const signature = createHmac("sha256", "merchant-secret")
    .update("order_123|pay_456").digest("hex");
  assert.equal(verifyCheckoutSignature("order_123", "pay_456", signature, "merchant-secret"), true);
  assert.equal(verifyCheckoutSignature("order_999", "pay_456", signature, "merchant-secret"), false);
  assert.equal(verifyCheckoutSignature("order_123", "pay_456", "invalid", "merchant-secret"), false);
  assert.equal(toMinorUnits(1000, "INR"), 100000);
});
