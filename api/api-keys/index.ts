import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, requireActor } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { createOpaqueToken, hashToken } from "../../server/security.js";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mode: z.enum(["test", "live"]).default("test"),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET", "POST", "DELETE"]);
    const actor = await requireActor(
      req,
      req.method === "GET" ? undefined : ["owner", "admin"],
    );
    const sql = db();
    if (req.method === "GET") {
      const keys =
        await sql`SELECT id, name, prefix, mode, last_used_at, created_at FROM api_keys
        WHERE organization_id = ${actor.organizationId} AND revoked_at IS NULL ORDER BY created_at DESC`;
      return ok(res, { apiKeys: keys });
    }
    if (req.method === "DELETE") {
      const id = z.string().min(1).parse(req.query.id);
      const updated =
        await sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ${id} AND organization_id = ${actor.organizationId} AND revoked_at IS NULL RETURNING id`;
      if (!updated.length)
        throw new ApiError(404, "NOT_FOUND", "API key not found");
      await audit(actor, "api_key.revoked", "api_key", id);
      return ok(res, { revoked: true });
    }
    const input = createSchema.parse(req.body);
    const token = createOpaqueToken(
      input.mode === "live" ? "px_live_" : "px_test_",
    );
    const id = `key_${randomUUID()}`;
    const prefix = token.slice(0, 17);
    await sql`INSERT INTO api_keys (id, organization_id, created_by, name, prefix, key_hash, mode)
      VALUES (${id}, ${actor.organizationId}, ${actor.userId}, ${input.name}, ${prefix}, ${hashToken(token)}, ${input.mode})`;
    await audit(actor, "api_key.created", "api_key", id, { mode: input.mode });
    return ok(
      res,
      {
        apiKey: {
          id,
          name: input.name,
          prefix,
          mode: input.mode,
          secret: token,
        },
        warning: "Copy this key now. It will not be shown again.",
      },
      201,
    );
  });
}
