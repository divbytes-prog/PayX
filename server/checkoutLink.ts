import { createHmac, timingSafeEqual } from "node:crypto";
import { config, ConfigurationError } from "./config.js";
import { ApiError } from "./http.js";

export function checkoutToken(id: string, mode: "test" | "live") {
  if (config.sessionSecret.length < 32)
    throw new ConfigurationError("SESSION_SECRET must be at least 32 characters for customer checkout links");
  const signature = createHmac("sha256", config.sessionSecret)
    .update(`payx-checkout:v1:${id}:${mode}`).digest("hex");
  return `${id}.${signature}`;
}

export function validateCheckoutToken(value: string, id: string, mode: "test" | "live") {
  if (!/^px_[a-f0-9]{20}\.[a-f0-9]{64}$/.test(value))
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
  const actual = Buffer.from(value);
  const expected = Buffer.from(checkoutToken(id, mode));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ApiError(404, "NOT_FOUND", "Payment link not found");
}

export function checkoutUrl(id: string, mode: "test" | "live") {
  return `${config.appUrl}/?checkout=${encodeURIComponent(checkoutToken(id, mode))}#pay`;
}

export function checkoutExpiresAt(createdAt: string | Date, provider: string) {
  const lifetime = provider === "paytm" ? 14 : 60 * 24;
  return new Date(new Date(createdAt).getTime() + lifetime * 60_000);
}
