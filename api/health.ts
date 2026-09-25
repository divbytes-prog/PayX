import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../server/config.js";
import { db } from "../server/db.js";
import { allowMethods, ok, withApi } from "../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    let database: "not_configured" | "configured" | "unavailable" = "not_configured";
    if (config.databaseUrl) {
      try { const sql = db(); await sql`SELECT 1`; database = "configured"; }
      catch { database = "unavailable"; }
    }
    return ok(res, {
      status: database === "unavailable" ? "degraded" : "ok",
      service: "payx-api",
      database,
      stripeOAuth: Boolean(config.stripeSecretKey && config.stripeConnectClientId && config.sessionSecret && config.encryptionKey),
      mode: config.sandboxOnly ? "sandbox" : "live_enabled",
      liveEnabled: !config.sandboxOnly && config.appUrl.startsWith("https://"),
      stripeLiveOAuth: Boolean(!config.sandboxOnly && config.stripeLiveSecretKey &&
        config.stripeLiveConnectClientId && config.stripeLiveWebhookSecret),
      timestamp: new Date().toISOString(),
    });
  });
}
