import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createSession, setSessionCookie } from "../../server/auth.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { verifyPassword } from "../../server/security.js";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    const input = schema.parse(req.body);
    await ensureSchema();
    const sql = db();
    const rows = await sql<
      [
        {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          organization_id: string;
          organization_name: string;
          role: string;
        },
      ]
    >`
      SELECT u.id, u.name, u.email, u.password_hash, m.organization_id, o.name AS organization_name, m.role
      FROM users u JOIN memberships m ON m.user_id = u.id JOIN organizations o ON o.id = m.organization_id
      WHERE u.email = ${input.email} ORDER BY m.created_at ASC LIMIT 1`;
    const user = rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Incorrect email or password",
      );
    }
    const session = await createSession(user.id, user.organization_id);
    setSessionCookie(res, session.token, session.expiresAt);
    return ok(res, {
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: user.organization_id, name: user.organization_name },
      role: user.role,
    });
  });
}
