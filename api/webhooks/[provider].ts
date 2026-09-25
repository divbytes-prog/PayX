import type { VercelRequest, VercelResponse } from "@vercel/node";
import stripe from "../../server/webhooks/stripe.js";
import razorpay from "../../server/webhooks/razorpay.js";
import paytm from "../../server/webhooks/paytm.js";

export const config = { api: { bodyParser: false } };

const handlers = { stripe, razorpay, paytm };

export default function handler(req: VercelRequest, res: VercelResponse) {
  const provider = req.query.provider;
  if (typeof provider !== "string" || !(provider in handlers)) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown webhook provider" } });
  }
  return handlers[provider as keyof typeof handlers](req, res);
}
