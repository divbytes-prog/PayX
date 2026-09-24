import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireActor } from "../../server/auth.js";
import { listGateways, saveCredentialGateway } from "../../server/gateways.js";
import { allowMethods, ok, withApi } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET", "POST"]);
    const actor = await requireActor(
      req,
      req.method === "POST" ? ["owner", "admin"] : undefined,
    );
    if (req.method === "GET")
      return ok(res, { gateways: await listGateways(actor) });
    return ok(
      res,
      { gateway: await saveCredentialGateway(actor, req.body) },
      201,
    );
  });
}
