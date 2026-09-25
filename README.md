# PayX — SaaS Payment Orchestration

PayX is a multi-tenant payment orchestration platform and portfolio project. It provides one merchant-facing API for routing payments through Stripe, Razorpay, or Paytm while keeping provider credentials, webhook handling, idempotency, and transaction state behind a stable PayX contract.

**Live app:** https://pay-x-six.vercel.app/

The public experience includes an anonymous browser sandbox at [`#sandbox`](https://pay-x-six.vercel.app/#sandbox). It works without credentials and marks new payments as `simulated`. After the backend environment variables are configured, users can create an authenticated workspace with persistent transactions, encrypted gateway connections, API keys, and signed webhook updates.

## Implemented features

### Product interface

- Responsive React 19 + Vite marketing website
- Payment control-room dashboard
- Anonymous local sandbox for portfolio demonstrations
- Authenticated SaaS workspace backed by PostgreSQL
- Gateway health and routing configuration UI
- Central transaction ledger
- Developer-facing API documentation

### SaaS backend

- Organization-based multi-tenancy
- Owner, admin, developer, and viewer roles
- Password hashing with Node.js `scrypt`
- Random, hashed, HTTP-only sessions
- Test/live API keys stored only as SHA-256 hashes
- API keys displayed once at creation
- PostgreSQL persistence with idempotent schema initialization
- Unique organization + idempotency-key constraint
- Audit logs for security-sensitive actions
- AES-256-GCM encryption for merchant gateway credentials
- Normalized transaction records and provider errors
- Sandbox safety switch that blocks live gateway use by default; connected test accounts can still initiate provider test payments

### Payment gateways

- **Stripe:** Stripe Connect OAuth with one-time state, connected-account hosted Checkout, and signed Connect webhooks
- **Razorpay:** merchant credential validation, Orders + Standard Checkout, server-side signature and capture checks, and per-merchant signed webhooks
- **Paytm:** encrypted credentials, transaction initialization, JS Checkout, signed callback and server-to-server status verification
- Balanced, lowest-fee, and lowest-latency routing policies
- Provider adapter boundary so merchant requests stay stable

Stripe supports OAuth for connected accounts. Razorpay and Paytm merchant integrations use provider-issued API credentials; PayX encrypts these credentials instead of pretending those gateways offer the same OAuth flow.

## Architecture

```text
React/Vite dashboard
        │
        ▼
Vercel serverless API
        │
        ├── session/API-key authentication
        ├── organization authorization
        ├── idempotency and routing engine
        ├── encrypted gateway connections
        └── signed webhook handlers
        │
        ├── PostgreSQL transaction ledger
        └── Stripe / Razorpay / Paytm
```

## API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Deployment and configuration status |
| `POST` | `/api/auth/register` | Create a user, organization, owner membership, and session |
| `POST` | `/api/auth/login` | Start an HTTP-only session |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/auth/me` | Return the authenticated user and workspace |
| `GET/POST` | `/api/payments` | List or create idempotent payments |
| `GET/POST` | `/api/gateways` | List or connect encrypted gateway credentials |
| `GET/POST/DELETE` | `/api/api-keys` | Manage workspace API keys |
| `GET` | `/api/oauth/stripe` | Start Stripe Connect OAuth |
| `GET` | `/api/oauth/stripe/callback` | Verify OAuth state and save the connection |
| `POST` | `/api/webhooks/stripe` | Verify and process Stripe events |
| `POST` | `/api/webhooks/razorpay` | Verify and process Razorpay events |
| `POST` | `/api/webhooks/paytm` | Verify Paytm callbacks against its signed Status API |
| `POST` | `/api/payments/razorpay/verify` | Verify Checkout signature, order and captured status |

## Local setup

Requirements: Node.js 20+, npm, and PostgreSQL.

```bash
git clone https://github.com/divbytes-prog/PayX.git
cd PayX
npm install
cp .env.example .env.local
npm run dev
```

Vite serves the frontend during basic UI development. Use `vercel dev` when testing the frontend and serverless API together.

Generate secure values for the session and credential-encryption variables:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Use the first value for `SESSION_SECRET` and the second for `CREDENTIAL_ENCRYPTION_KEY`.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_URL` | Yes | Canonical frontend URL |
| `SESSION_SECRET` | Yes | Secret used to sign short-lived OAuth state |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Exactly 32 random bytes encoded as Base64 |
| `PAYX_SANDBOX_ONLY` | Yes | Keep `true` until live credentials and webhooks are verified |
| `STRIPE_SECRET_KEY` | Stripe OAuth | PayX platform secret key |
| `STRIPE_CONNECT_CLIENT_ID` | Stripe OAuth | Stripe Connect platform client ID |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Webhook signing secret |
| `STRIPE_LIVE_SECRET_KEY` | Live Stripe | Live platform secret key |
| `STRIPE_LIVE_CONNECT_CLIENT_ID` | Live Stripe | Live Connect client ID |
| `STRIPE_LIVE_WEBHOOK_SECRET` | Live Stripe | Live Connect webhook signing secret |

Never prefix secret values with `VITE_`; Vite exposes such values to browsers. Merchant keys are entered in the authenticated Gateways page and encrypted before storage.

## Payment request

Authenticated browser sessions can call the API with cookies. Server-to-server merchants use a PayX API key:

```bash
curl -X POST https://pay-x-six.vercel.app/api/payments \
  -H "Authorization: Bearer px_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "INR",
    "routingRule": "balanced",
    "idempotencyKey": "order_10241"
  }'
```

`amount` uses major currency units in the PayX contract. Provider adapters convert to provider-specific minor units where required.

## Gateway setup

### Stripe Connect

1. Create a Stripe Connect platform.
2. Add the callback URL: `https://pay-x-six.vercel.app/api/oauth/stripe/callback`.
3. Configure `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, and `STRIPE_WEBHOOK_SECRET`.
4. Register a **Connect account events** webhook URL: `https://pay-x-six.vercel.app/api/webhooks/stripe`, subscribing to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, and `payment_intent.processing`. Store the signing secret for the matching mode.
5. Sign in to PayX and choose **Connect Stripe OAuth**.

### Razorpay

1. Create test keys in the Razorpay dashboard.
2. Sign in to PayX and open **Gateways → Connect Razorpay**.
3. PayX validates the credentials against Razorpay before encrypting them.
4. Set a webhook secret when connecting the merchant. Register the exact URL shown in the Gateways page, which contains that connection's ID; subscribe to `payment.captured` and `payment.failed`. Each merchant owns their webhook secret.

### Paytm

1. Obtain a staging MID and merchant key.
2. Sign in to PayX and open **Gateways → Connect Paytm**.
3. Keep `PAYX_SANDBOX_ONLY=true` during staging verification. Paytm validates the key on the first test transaction. Its callback uses `/api/webhooks/paytm` and verifies status with Paytm before recording success.

## Quality checks

```bash
npm run build
npm run typecheck:api
npm test
```

Tests cover routing policy behavior, request validation, password hashing, and authenticated encryption. Production verification should additionally exercise registration, login, API-key creation, provider test transactions, idempotency retries, and signed webhook delivery.

## Deployment

The repository is configured for Vercel. Import it as a Vite project and add the environment variables above. Git pushes to `main` trigger production deployments through Vercel's Git integration.

The application starts in sandbox-only mode. Anonymous and unconnected test payments are labelled `simulated`. Connected test providers open a real **test** checkout. A live checkout is possible only after setting `PAYX_SANDBOX_ONLY=false`, configuring a public HTTPS `APP_URL`, connecting approved live merchant credentials, and setting up verified webhooks. The browser return is informational; only provider verification moves a payment to `succeeded`.

See [Production readiness](docs/PRODUCTION_READINESS.md) for the exact activation requirements and remaining operational work. Do not use the live switch until these requirements have been completed and a test transaction has passed for each provider.

The current deployment reports `database: not_configured` at `/api/health`; its public browser sandbox works, but account registration, Stripe OAuth, and connected provider payments need a PostgreSQL `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, and `CREDENTIAL_ENCRYPTION_KEY` configured on the Vercel project. Stripe OAuth also needs the Stripe platform keys and callback URL listed above. Moving real money additionally requires provider approval, verified webhooks, monitoring, and a controlled production launch.

## License

Portfolio and educational use.
