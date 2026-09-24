import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import { ConfigurationError } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function allowMethods(req: VercelRequest, methods: string[]) {
  if (!req.method || !methods.includes(req.method)) {
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      `Use ${methods.join(" or ")}`,
    );
  }
}

export function setSecurityHeaders(res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
}

export function ok(res: VercelResponse, body: unknown, status = 200) {
  setSecurityHeaders(res);
  return res.status(status).json(body);
}

export function handleError(res: VercelResponse, error: unknown) {
  setSecurityHeaders(res);
  if (error instanceof ApiError) {
    return res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: error.issues,
      },
    });
  }
  if (error instanceof ConfigurationError) {
    return res
      .status(503)
      .json({
        error: { code: "SERVICE_NOT_CONFIGURED", message: error.message },
      });
  }
  console.error(error);
  return res
    .status(500)
    .json({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    });
}

export async function withApi(
  res: VercelResponse,
  work: () => Promise<unknown>,
) {
  try {
    return await work();
  } catch (error) {
    return handleError(res, error);
  }
}

export function cookieValue(req: VercelRequest, name: string) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
