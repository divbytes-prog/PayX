import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SignJWT } from "jose";
import { requireActor } from "../../server/auth.js";
import { config } from "../../server/config.js";
import { allowMethods, ApiError, withApi } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    const actor = await requireActor(req, ["owner", "admin"]);
    if (!config.stripeConnectClientId || !config.sessionSecret) {
      throw new ApiError(
        503,
        "STRIPE_CONNECT_NOT_CONFIGURED",
        "Stripe Connect is not configured for this deployment",
      );
    }
    const state = await new SignJWT({ organizationId: actor.organizationId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(actor.userId ?? "")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(config.sessionSecret));
    const url = new URL("https://connect.stripe.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.stripeConnectClientId);
    url.searchParams.set("scope", "read_write");
    url.searchParams.set("state", state);
    res.redirect(302, url.toString());
  });
}
