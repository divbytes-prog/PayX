# PayX production readiness

PayX can initiate provider-hosted payments. Its public sandbox is only a simulation. Real money is collected by the connected merchant's provider account, never by PayX itself. The merchant must finish onboarding and turn on a verified live integration.

## Implemented in the app

- Tenant-scoped users, sessions, roles, API keys, gateway credentials and transaction ledger.
- Stripe Connect OAuth with a one-time state, Stripe hosted Checkout, and connected-account signed webhooks.
- Razorpay Orders + Standard Checkout, authenticated server-side signature and captured-status verification, and a per-connection webhook URL/secret.
- Paytm transaction initialization + hosted payment page, checksum-checked callbacks, and signed server-to-server Status API verification.
- Test/live mode separation. The live switch is disabled by default; simulated payments cannot be mistaken for captured funds.
- Signed customer payment links show merchant, amount and provider before continuing to the provider's checkout. Customers do not need PayX merchant accounts; provider sign-in and mobile UPI authorization remain with the provider.
- Idempotency keys are checked against payment input, signed callbacks are matched to tenant, mode, amount and currency, and callbacks cannot downgrade a successful transaction.

## Before enabling live mode

1. Provision a production PostgreSQL database and back it up. Set `DATABASE_URL`, the canonical HTTPS `APP_URL`, a random `SESSION_SECRET`, and a 32-byte Base64 `CREDENTIAL_ENCRYPTION_KEY` in the production deployment. Restrict who can read those values.
2. Complete merchant onboarding with each provider, including their identity checks, settlement account, approved payment methods and provider account activation. PayX cannot do this on the merchant's behalf.
3. Configure Stripe test and live Connect keys separately. Register `/api/oauth/stripe/callback` as the OAuth redirect, and `/api/webhooks/stripe` as a **Connect** webhook for both modes using their separate signing secrets.
4. For each Razorpay merchant, connect the correct `rzp_test_` or `rzp_live_` key pair plus a unique webhook secret. Register the exact per-connection webhook URL shown in the dashboard. Configure automatic capture in Razorpay and verify a captured test payment.
5. For each Paytm merchant, obtain the staging or production MID/key and configure the public callback URL `/api/webhooks/paytm`. Verify the test payment through Paytm's Transaction Status API.
6. Test success, decline, cancellation, delayed webhook, duplicate webhook, idempotency retry, mismatched amount and currency, and a full return from provider checkout. Confirm the provider's dashboard and PayX ledger agree.
   Test each customer link in a private browser without a PayX merchant session. On mobile, verify the installed Paytm or UPI app opens when selected. On desktop, verify the provider's browser checkout or QR flow; do not promise an app handoff on devices where the provider does not offer one.
7. Set `PAYX_SANDBOX_ONLY=false` only after the preceding steps. Create a live API key as an owner or admin, connect a live provider, and make a small payment from a customer-controlled payment method. Confirm capture, webhook delivery and settlement in the provider dashboard. No agent should execute that financial transaction without a specified merchant, purpose and amount.

## Additional work before broad public SaaS use

- Add email ownership verification, password reset, invitations and multi-factor authentication for merchant accounts. Today the app has password sessions and per-identity login throttling, but does not send verification email.
- Move schema creation into reviewed database migrations and use a database role with minimal runtime privileges. The current server initializes schema on first use.
- Add monitoring, alerts for failed webhooks and stuck `created`/`processing` transactions, daily provider reconciliation, refund/dispute flows, a support process, and a written incident response path.
- Review applicable PCI scope, privacy terms, retention, taxes and payment regulations with the merchant and providers. Provider-hosted checkout keeps card entry off PayX pages; it does not replace those obligations.
- Replace demo routing estimates with measured provider performance and merchant-specific pricing before enabling automatic multi-provider live routing. Until then, PayX requires an explicit gateway when multiple live providers are connected.

The production URL currently reports `database: configured` and `mode: sandbox`; Stripe OAuth and live collection remain unconfigured. Provider secrets and merchant onboarding are external requirements; this repository does not contain those credentials.
