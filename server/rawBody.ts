import type { VercelRequest } from "@vercel/node";

export async function readRawBody(req: VercelRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
