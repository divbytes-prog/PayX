import assert from "node:assert/strict";
import test from "node:test";
import { paymentSchema, selectProvider } from "./payments.js";

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
