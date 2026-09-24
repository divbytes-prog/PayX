import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireActor } from "../../server/auth.js";
import { db } from "../../server/db.js";
import { allowMethods, ok, withApi } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["GET"]);
    const actor = await requireActor(req);
    const sql = db();
    const rows = await sql<
      [
        {
          id: string;
          name: string;
          email: string;
          organization_id: string;
          organization_name: string;
          role: string;
          plan: string;
        },
      ]
    >`
      SELECT u.id, u.name, u.email, o.id AS organization_id, o.name AS organization_name, m.role, o.plan
      FROM users u JOIN memberships m ON m.user_id = u.id JOIN organizations o ON o.id = m.organization_id
      WHERE u.id = ${actor.userId} AND o.id = ${actor.organizationId} LIMIT 1`;
    const user = rows[0];
    return ok(res, {
      user: { id: user.id, name: user.name, email: user.email },
      organization: {
        id: user.organization_id,
        name: user.organization_name,
        plan: user.plan,
      },
      role: user.role,
    });
  });
}
