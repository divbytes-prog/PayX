# PayX — Payment Gateway Orchestrator

PayX is a hackathon-ready payment orchestration product demo for modern e-commerce platforms, SaaS businesses, marketplaces, and developers that need one integration layer across multiple payment gateways.

## What is implemented in this demo

- Responsive React + Vite product website
- Live sandbox for creating simulated payments
- Configurable routing policies: balanced, lowest fee, lowest latency
- Multi-gateway configuration and health simulation
- Idempotency demo: repeating the same key returns the original transaction
- Centralized transaction ledger persisted in browser localStorage
- Unified normalized transaction response
- API documentation and conceptual request/response flow
- Gateway adapter architecture view
- Security/reliability guidance without exposing real credentials
- Roadmap clearly separated from demo functionality

> **Important:** This is a sandbox/product demo. It does not move real money or contain production gateway secrets.

## Tech stack

- React 19
- TypeScript
- Vite
- Browser localStorage for demo-state persistence
- Production architecture targets Node.js + Express + PostgreSQL + Docker/Docker Compose, matching the product specification

## Local run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

1. Push this folder to a GitHub repository named `PayX`.
2. Import the repository in Vercel.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Output directory: `dist`.

`vercel.json` includes SPA rewrites for direct navigation.

## Demo flow

1. Open **Dashboard**.
2. Enter an amount, currency, routing policy, and idempotency key.
3. Create a payment.
4. PayX selects an enabled gateway using the selected routing policy.
5. Retry with the exact same idempotency key to see duplicate-payment protection.
6. Open **Gateways** and set a provider offline/degraded.
7. Return to Dashboard and observe routing adapt to the remaining enabled providers.

## Production evolution

The hackathon brief describes Node.js, Express, PostgreSQL, Docker / Docker Compose, secure credential management, recurring payments, additional routing logic, failover, reconciliation, smart routing, fraud/risk integrations, SDKs, and marketplace capabilities. These are production architecture or roadmap concerns unless explicitly implemented in the demo.

## Suggested production entities

- `users`
- `gateway_configurations`
- `transactions`
- `subscriptions`
- `merchant_credentials`

A transaction should retain the PayX transaction ID, merchant/user, amount, currency, selected gateway, status, idempotency key, provider transaction ID, and timestamps.

## License

Portfolio / hackathon project.
