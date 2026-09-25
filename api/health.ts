import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../server/config.js";
import { allowMethods, ok, withApi } from "../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    return ok(res, {
      status: "ok",
      service: "payx-api",
      database: config.databaseUrl ? "configured" : "not_configured",
      stripeOAuth: Boolean(config.stripeSecretKey && config.stripeConnectClientId && config.sessionSecret && config.encryptionKey),
      mode: config.sandboxOnly ? "sandbox" : "live_enabled",
      timestamp: new Date().toISOString(),
    });
  });
}
