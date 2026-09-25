/// <reference path="../paytmchecksum.d.ts" />
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomUUID } from "node:crypto";
import { config as appConfig } from "../config.js";
import { db, ensureSchema } from "../db.js";
import { allowMethods, ApiError, ok, withApi } from "../http.js";
import { readRawBody } from "../rawBody.js";
import { revealGatewayCredentials, type StoredGateway } from "../gateways.js";

export const config = { api: { bodyParser: false } };

type PaytmReply = {
  head?: { signature?: string };
  body?: {
    mid?: string;
    orderId?: string;
    txnId?: string;
    txnAmount?: string;
    resultInfo?: { resultStatus?: string; resultMsg?: string };
  };
};

function parseCallback(raw: Buffer) {
  const params = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  return {
    mid: params.MID,
    orderId: params.ORDERID ?? params.ORDER_ID,
    signature: params.CHECKSUMHASH,
    params,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withApi(res, async () => {
    allowMethods(req, ["POST"]);
    const raw = await readRawBody(req);
    const callback = parseCallback(raw);
    if (!callback.orderId || !callback.mid || !callback.signature)
      throw new ApiError(400, "INVALID_CALLBACK", "Missing Paytm callback fields");
    await ensureSchema();
    const sql = db();
    const rows = await sql<(Record<string, unknown> & StoredGateway)[]>`
      SELECT t.id, t.organization_id, t.amount, t.currency, t.mode, t.status,
        g.encrypted_credentials, g.provider_account_id, g.provider, g.metadata
      FROM transactions t JOIN gateway_connections g
        ON g.organization_id = t.organization_id AND g.provider = 'paytm' AND g.mode = t.mode
      WHERE t.id = ${callback.orderId} AND t.provider = 'paytm'
        AND g.provider_account_id = ${callback.mid} LIMIT 1`;
    const row = rows[0];
    if (!row) throw new ApiError(404, "NOT_FOUND", "Payment not found");
    const { merchantKey } = revealGatewayCredentials<{ merchantKey: string }>(row);
    const { default: PaytmChecksum } = await import("paytmchecksum");
    const { CHECKSUMHASH: _signature, ...signedFields } = callback.params;
    if (!PaytmChecksum.verifySignature(signedFields, merchantKey, callback.signature))
      throw new ApiError(400, "INVALID_SIGNATURE", "Invalid Paytm checksum");

    // Callback fields only identify the order. A signed server-to-server status
    // request determines whether funds were actually captured.
    const body = { mid: callback.mid, orderId: callback.orderId };
    const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), merchantKey);
    const host = row.mode === "live" ? "https://securegw.paytm.in" : "https://securegw-stage.paytm.in";
    const response = await fetch(`${host}/v3/order/status`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, head: { signature } }),
    });
    const result = await response.json() as PaytmReply;
    if (!response.ok || !result.body || !result.head?.signature ||
        !PaytmChecksum.verifySignature(JSON.stringify(result.body), merchantKey, result.head.signature))
      throw new ApiError(502, "STATUS_UNVERIFIED", "Paytm status could not be verified");
    if (result.body.mid !== callback.mid || result.body.orderId !== callback.orderId)
      throw new ApiError(502, "STATUS_MISMATCH", "Paytm returned a different order");
    const status = result.body.resultInfo?.resultStatus;
    if (status === "TXN_SUCCESS" &&
        (row.currency !== "INR" || Number(result.body.txnAmount) !== Number(row.amount)))
      throw new ApiError(502, "AMOUNT_MISMATCH", "Paytm returned a different payment amount");
    const normalized = status === "TXN_SUCCESS" ? "succeeded"
      : status === "TXN_FAILURE" ? "failed" : "processing";
    await sql`UPDATE transactions SET status = ${normalized},
      failure_message = ${normalized === "failed" ? result.body.resultInfo?.resultMsg ?? "Paytm payment failed" : null},
      updated_at = NOW() WHERE id = ${callback.orderId}
      AND (status <> 'succeeded' OR ${normalized} = 'succeeded')`;
    const eventId = createHash("sha256").update(raw).digest("hex");
    await sql`INSERT INTO webhook_events (id, provider, provider_event_id, organization_id, event_type, payload)
      VALUES (${`evt_${randomUUID()}`}, 'paytm', ${eventId}, ${row.organization_id as string},
        ${status ?? "UNKNOWN"}, ${sql.json({ orderId: callback.orderId, status })})
      ON CONFLICT (provider, provider_event_id) DO NOTHING`;
    if (req.headers.accept?.includes("text/html")) {
      const url = `${appConfig.appUrl}/?payment=${encodeURIComponent(callback.orderId)}&mode=${row.mode}#dashboard`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body><a href="${url}">Return to PayX</a></body></html>`);
    }
    return ok(res, { received: true, status: normalized });
  });
}
