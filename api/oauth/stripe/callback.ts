import type { VercelRequest, VercelResponse } from "@vercel/node";
import { jwtVerify } from "jose";
import { requireActor } from "../../../server/auth.js";
import { config } from "../../../server/config.js";
import { db } from "../../../server/db.js";
import { saveStripeOAuthConnection } from "../../../server/gateways.js";
import { allowMethods, ApiError, withApi } from "../../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    const actor = await requireActor(req, ["owner", "admin"]);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state || !config.sessionSecret)
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
    const mode = verified.payload.mode;
    if (
      verified.payload.sub !== actor.userId ||
      verified.payload.organizationId !== actor.organizationId ||
      !verified.payload.jti ||
      (mode !== "test" && mode !== "live")
    ) {
      throw new ApiError(
        403,
        "INVALID_OAUTH_STATE",
        "Stripe OAuth state does not match this workspace",
      );
    }
    const sql = db();
    const consumed = await sql`DELETE FROM oauth_states
      WHERE id = ${verified.payload.jti} AND user_id = ${actor.userId}
        AND organization_id = ${actor.organizationId} AND expires_at > NOW()
      RETURNING id`;
    if (!consumed.length)
      throw new ApiError(403, "OAUTH_STATE_USED", "Stripe connection link has expired or was already used");
    if (req.query.error === "access_denied") {
      const denied = new URL(config.appUrl);
      denied.searchParams.set("gateway", "stripe");
      denied.searchParams.set("error", "Stripe connection was canceled");
      return res.redirect(302, denied.toString());
    }
    if (!code) throw new ApiError(400, "INVALID_OAUTH_CALLBACK", "Stripe did not return an authorization code");
    const connection = await saveStripeOAuthConnection(actor, code, mode);
    const redirect = new URL(config.appUrl);
    redirect.searchParams.set("gateway", "stripe");
    redirect.searchParams.set("connected", "true");
    redirect.searchParams.set("mode", connection.mode);
    res.redirect(302, redirect.toString());
  });
}
