import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jwtVerify } from "jose";
import { requireActor } from "../../../server/auth.js";
import { config } from "../../../server/config.js";
import { saveStripeOAuthConnection } from "../../../server/gateways.js";
import { allowMethods, ApiError, withApi } from "../../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    const actor = await requireActor(req, ["owner", "admin"]);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state || !config.sessionSecret)
      throw new ApiError(
        400,
        "INVALID_OAUTH_CALLBACK",
        "Missing Stripe OAuth code or state",
      );
    const verified = await jwtVerify(
      state,
      new TextEncoder().encode(config.sessionSecret),
      { algorithms: ["HS256"] },
    );
    if (
      verified.payload.sub !== actor.userId ||
      verified.payload.organizationId !== actor.organizationId
    ) {
      throw new ApiError(
        403,
        "INVALID_OAUTH_STATE",
        "Stripe OAuth state does not match this workspace",
      );
    }
    const connection = await saveStripeOAuthConnection(actor, code);
    const redirect = new URL(config.appUrl);
    redirect.searchParams.set("gateway", "stripe");
    redirect.searchParams.set("connected", "true");
    redirect.searchParams.set("mode", connection.mode);
    res.redirect(302, redirect.toString());
  });
}
