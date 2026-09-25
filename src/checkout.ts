import type { Checkout, Mode } from "./api";
import { api } from "./api";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
    Paytm?: { CheckoutJS?: {
      onLoad(callback: () => void): void;
      init(options: Record<string, unknown>): Promise<void>;
      invoke(): void;
    } };
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

export async function openCheckout(checkout: Checkout, transactionId: string, mode: Mode, onStatus: (status: string) => void) {
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
            transactionId, orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature, mode,
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
  const host = checkout.mode === "live" ? "https://secure.paytmpayments.com" : "https://securestage.paytmpayments.com";
  await loadScript(`${host}/merchantpgpui/checkoutjs/merchants/${encodeURIComponent(checkout.merchantId)}.js`);
  const widget = window.Paytm?.CheckoutJS;
  if (!widget) throw new Error("Paytm Checkout is unavailable");
  await new Promise<void>((resolve, reject) => {
    widget.onLoad(() => {
      widget.init({
        root: "", flow: "DEFAULT",
        data: { orderId: checkout.orderId, token: checkout.token,
          tokenType: "TXN_TOKEN", amount: checkout.amount },
        handler: { notifyMerchant: () => onStatus("Paytm checkout updated; awaiting verified status") },
      }).then(() => { widget.invoke(); resolve(); }).catch(reject);
    });
  });
}
