import type { Checkout } from "./api";
import { api } from "./api";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error("Payment provider checkout could not load"));
    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.append(script);
    }
  });
}

export async function openCheckout(checkout: Checkout, token: string, onStatus: (status: string) => void) {
  if (checkout.kind === "redirect") {
    const url = new URL(checkout.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
      throw new Error("Invalid Stripe checkout destination");
    window.location.assign(url.href);
    return;
  }
  if (checkout.kind === "razorpay") {
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");
    const widget = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: "PayX",
      handler: async (response: Record<string, string>) => {
        try {
          const verified = await api.verifyRazorpay({
            token, orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          onStatus(verified.status === "succeeded" ? "Payment confirmed by Razorpay" : "Payment processing; awaiting capture");
        } catch (error) {
          onStatus(error instanceof Error ? error.message : "Payment verification failed");
        }
      },
    });
    widget.open();
    return;
  }
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(checkout.merchantId))
    throw new Error("Invalid Paytm merchant ID");
  if (!/^px_[a-f0-9]{20}$/.test(checkout.orderId) || !checkout.token)
    throw new Error("Invalid Paytm order details");
  const host = checkout.mode === "live" ? "https://secure.paytmpayments.com" : "https://securestage.paytmpayments.com";
  const action = new URL("/theia/api/v1/showPaymentPage", host);
  action.searchParams.set("mid", checkout.merchantId);
  action.searchParams.set("orderId", checkout.orderId);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action.href;
  for (const [name, value] of Object.entries({ mid: checkout.merchantId, orderId: checkout.orderId, txnToken: checkout.token })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}
