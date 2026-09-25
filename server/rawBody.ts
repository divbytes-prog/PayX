import type { VercelRequest } from "@vercel/node";
import { ApiError } from "./http.js";

export async function readRawBody(req: VercelRequest, maxBytes = 1024 * 1024) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
