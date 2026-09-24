export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  sessionSecret: process.env.SESSION_SECRET ?? "",
  encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",
  sandboxOnly:
    (process.env.PAYX_SANDBOX_ONLY ?? "true").toLowerCase() !== "false",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeConnectClientId: process.env.STRIPE_CONNECT_CLIENT_ID ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function requireConfig(name: keyof typeof config): string {
  const value = config[name];
  if (typeof value !== "string" || !value) {
    throw new ConfigurationError(
      `Missing required environment variable for ${name}`,
    );
  }
  return value;
}
