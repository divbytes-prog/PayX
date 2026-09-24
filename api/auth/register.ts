import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSession, setSessionCookie } from "../../server/auth.js";
import { db, ensureSchema } from "../../server/db.js";
import { allowMethods, ApiError, ok, withApi } from "../../server/http.js";
import { hashPassword } from "../../server/security.js";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(10)
    .max(128)
    .regex(/[A-Z]/, "Add an uppercase letter")
    .regex(/[0-9]/, "Add a number"),
  organizationName: z.string().trim().min(2).max(100),
});

function slugify(value: string) {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 45) || "workspace";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    const input = schema.parse(req.body);
    await ensureSchema();
    const sql = db();
    const exists =
      await sql`SELECT 1 FROM users WHERE email = ${input.email} LIMIT 1`;
    if (exists.length)
      throw new ApiError(
        409,
        "EMAIL_EXISTS",
        "An account with this email already exists",
      );
    const userId = `usr_${randomUUID()}`;
    const organizationId = `org_${randomUUID()}`;
    const passwordHash = await hashPassword(input.password);
    await sql.begin(async (transaction) => {
      await transaction`INSERT INTO users (id, email, name, password_hash) VALUES (${userId}, ${input.email}, ${input.name}, ${passwordHash})`;
      await transaction`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, ${input.organizationName}, ${slugify(input.organizationName)})`;
      await transaction`INSERT INTO memberships (user_id, organization_id, role) VALUES (${userId}, ${organizationId}, 'owner')`;
    });
    const session = await createSession(userId, organizationId);
    setSessionCookie(res, session.token, session.expiresAt);
    return ok(
      res,
      {
        user: { id: userId, name: input.name, email: input.email },
        organization: { id: organizationId, name: input.organizationName },
        role: "owner",
      },
      201,
    );
  });
}
