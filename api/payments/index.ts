import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireActor } from "../../server/auth.js";
import { allowMethods, ok, withApi } from "../../server/http.js";
import { createPayment, listTransactions } from "../../server/payments.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET", "POST"]);
    const actor = await requireActor(req);
    if (req.method === "GET")
      return ok(res, {
        transactions: await listTransactions(
          actor,
          Number(req.query.limit ?? 50),
        ),
      });
    return ok(res, await createPayment(actor, req.body), 201);
  });
}
