import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { requireActor } from "../../server/auth.js";
import { config, stripePlatform } from "../../server/config.js";
import { db } from "../../server/db.js";
import { allowMethods, ApiError, withApi } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    const actor = await requireActor(req, ["owner", "admin"]);
    const mode = req.query.mode === "live" ? "live" : "test";
    if (mode === "live" && (config.sandboxOnly || !config.stripeLiveWebhookSecret))
      throw new ApiError(409, "LIVE_NOT_READY", "Enable live mode and configure the Stripe live webhook before connecting");
    if (!config.sessionSecret) {
      throw new ApiError(
        503,
        "STRIPE_CONNECT_NOT_CONFIGURED",
        "Stripe Connect is not configured for this deployment",
      );
    }
    const platform = stripePlatform(mode);
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const sql = db();
    await sql`INSERT INTO oauth_states (id, user_id, organization_id, expires_at)
      VALUES (${nonce}, ${actor.userId}, ${actor.organizationId}, ${expiresAt})`;
    const state = await new SignJWT({ organizationId: actor.organizationId, mode })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(actor.userId ?? "")
      .setJti(nonce)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(config.sessionSecret));
    const url = new URL("https://connect.stripe.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", platform.clientId);
    url.searchParams.set("scope", "read_write");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", `${config.appUrl}/api/oauth/stripe/callback`);
    res.redirect(302, url.toString());
  });
}
