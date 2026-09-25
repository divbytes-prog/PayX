import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { db, ensureSchema } from "./db.js";
import { config } from "./config.js";
import { ApiError, cookieValue } from "./http.js";
import { createOpaqueToken, hashToken } from "./security.js";

export type Actor = {
  userId: string | null;
  organizationId: string;
  role: "owner" | "admin" | "developer" | "viewer";
  mode: "test" | "live";
  authType: "session" | "api_key";
};

export async function createSession(userId: string, organizationId: string) {
  await ensureSchema();
  const sql = db();
  const token = createOpaqueToken("sess_");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await sql`INSERT INTO sessions (token_hash, user_id, organization_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${organizationId}, ${expiresAt})`;
  return { token, expiresAt };
}

export function setSessionCookie(
  res: VercelResponse,
  token: string,
  expiresAt: Date,
) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `payx_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`,
  );
}

export function clearSessionCookie(res: VercelResponse) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `payx_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function requireActor(
  req: VercelRequest,
  roles?: Actor["role"][],
): Promise<Actor> {
  await ensureSchema();
  const sql = db();
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer?.startsWith("px_")) {
    const rows = await sql<
      [
        {
          organization_id: string;
          created_by: string;
          mode: "test" | "live";
          role: Actor["role"];
        },
      ]
    >`
      SELECT k.organization_id, k.created_by, k.mode, m.role
      FROM api_keys k
      JOIN memberships m ON m.user_id = k.created_by AND m.organization_id = k.organization_id
      WHERE k.key_hash = ${hashToken(bearer)} AND k.revoked_at IS NULL
      LIMIT 1`;
    const key = rows[0];
    if (!key) throw new ApiError(401, "UNAUTHORIZED", "Invalid API key");
    if (key.mode === "live" && config.sandboxOnly)
      throw new ApiError(409, "SANDBOX_ONLY", "Live API keys are disabled");
    void sql`UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = ${hashToken(bearer)}`;
    const actor: Actor = {
      userId: key.created_by,
      organizationId: key.organization_id,
      role: key.role,
      mode: key.mode,
      authType: "api_key",
    };
    if (roles && !roles.includes(actor.role))
      throw new ApiError(403, "FORBIDDEN", "Insufficient role");
    return actor;
  }

  const token = cookieValue(req, "payx_session");
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method ?? "")) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!origin || !host || !URL.canParse(origin) || new URL(origin).host !== host)
      throw new ApiError(403, "INVALID_ORIGIN", "Payment requests must come from this site");
  }
  const rows = await sql<
    [{ user_id: string; organization_id: string; role: Actor["role"] }]
  >`
    SELECT s.user_id, s.organization_id, m.role
    FROM sessions s
    JOIN memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > NOW()
    LIMIT 1`;
  const session = rows[0];
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "Session expired");
  const actor: Actor = {
    userId: session.user_id,
    organizationId: session.organization_id,
    role: session.role,
    mode: req.headers["x-payx-mode"] === "live" ? "live" : "test",
    authType: "session",
  };
  if (actor.mode === "live" && (config.sandboxOnly || !["owner", "admin"].includes(actor.role)))
    throw new ApiError(403, "LIVE_NOT_ALLOWED", "Live payments require an owner or admin and enabled live mode");
  if (roles && !roles.includes(actor.role))
    throw new ApiError(403, "FORBIDDEN", "Insufficient role");
  return actor;
}

export async function audit(
  actor: Actor,
  action: string,
  resourceType: string,
  resourceId?: string,
  context: Record<string, unknown> = {},
) {
  const sql = db();
  await sql`INSERT INTO audit_logs (id, organization_id, actor_id, action, resource_type, resource_id, context)
    VALUES (${`audit_${randomUUID()}`}, ${actor.organizationId}, ${actor.userId}, ${action}, ${resourceType}, ${resourceId ?? null}, ${sql.json(JSON.parse(JSON.stringify(context)))})`;
}
