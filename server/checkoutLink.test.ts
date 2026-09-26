import assert from "node:assert/strict";
import test from "node:test";
import { checkoutExpiresAt, checkoutToken, validateCheckoutToken } from "./checkoutLink.js";
import { config } from "./config.js";

test("customer checkout links bind the payment and mode and resist tampering", () => {
  const previous = config.sessionSecret;
  config.sessionSecret = "test-only-secret-with-at-least-32-characters";
  try {
    const id = "px_0123456789abcdef0123";
    const token = checkoutToken(id, "test");
    assert.doesNotThrow(() => validateCheckoutToken(token, id, "test"));
    assert.throws(() => validateCheckoutToken(token, id, "live"));
    assert.throws(() => validateCheckoutToken(token, "px_99999999999999999999", "test"));
    assert.throws(() => validateCheckoutToken(`${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`, id, "test"));
  } finally {
    config.sessionSecret = previous;
  }
});

test("Paytm checkout link expires before its provider token", () => {
  const created = new Date("2026-09-26T10:00:00Z");
  assert.equal(checkoutExpiresAt(created, "paytm").toISOString(), "2026-09-26T10:14:00.000Z");
  assert.equal(checkoutExpiresAt(created, "stripe").toISOString(), "2026-09-27T10:00:00.000Z");
});
