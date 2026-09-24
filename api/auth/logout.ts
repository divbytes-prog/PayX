import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookie } from "../../server/auth.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, cookieValue, ok, withApi } from "../../server/http.js";
import { hashToken } from "../../server/security.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    await ensureSchema();
    const token = cookieValue(req, "payx_session");
    if (token)
      await db()`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
    clearSessionCookie(res);
    return ok(res, { signedOut: true });
  });
}
