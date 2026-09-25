import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createHash } from "node:crypto";
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
    const remote = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
    const attemptKey = createHash("sha256").update(`${input.email}:${remote}`).digest("hex");
    const attempts = await sql<{ failures: number }[]>`
      SELECT failures FROM login_attempts WHERE attempt_key = ${attemptKey}
        AND window_start > NOW() - INTERVAL '15 minutes' LIMIT 1`;
    if (attempts[0]?.failures >= 8)
      throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Try signing in again after 15 minutes");
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
      await sql`INSERT INTO login_attempts (attempt_key, failures) VALUES (${attemptKey}, 1)
        ON CONFLICT (attempt_key) DO UPDATE SET
          failures = CASE WHEN login_attempts.window_start < NOW() - INTERVAL '15 minutes'
            THEN 1 ELSE login_attempts.failures + 1 END,
          window_start = CASE WHEN login_attempts.window_start < NOW() - INTERVAL '15 minutes'
            THEN NOW() ELSE login_attempts.window_start END,
          updated_at = NOW()`;
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Incorrect email or password",
      );
    }
    await sql`DELETE FROM login_attempts WHERE attempt_key = ${attemptKey}`;
    const session = await createSession(user.id, user.organization_id);
    setSessionCookie(res, session.token, session.expiresAt);
    return ok(res, {
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: user.organization_id, name: user.organization_name },
      role: user.role,
    });
  });
}
