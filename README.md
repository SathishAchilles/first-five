# First Five

**Build with AI. Test with humans. Improve with First Five.**

First Five is a task-based usability research platform for people building digital products. A builder connects a website, chooses one task and a success condition, shares a test link, and sees who succeeded, where others struggled, what participants said, and what to try next.

This repository is the **Render-hosted application and backend**. The browser tracking SDK is developed in a **separate project**; this repo only generates installation snippets and exposes the SDK API contract.

| Doc | |
|---|---|
| Product requirements | [docs/First_Five_PRD_v1_1.md](docs/First_Five_PRD_v1_1.md) |
| Architecture | [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| Application API | [docs/api/API.md](docs/api/API.md) |
| SDK contract (for the SDK team) | [docs/integrations/SDK_INTEGRATION.md](docs/integrations/SDK_INTEGRATION.md) · [OpenAPI](docs/api/sdk-openapi.yaml) |
| Integrations | [PostHog](docs/integrations/POSTHOG_SETUP.md) · [UX Director](docs/integrations/UX_DIRECTOR.md) · [Pine Labs](docs/integrations/PINELABS_SETUP.md) |
| Deployment | [docs/deployment/RENDER.md](docs/deployment/RENDER.md) |
| Status | [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) · [LANDING_PAGE_IMPLEMENTATION_STATUS.md](LANDING_PAGE_IMPLEMENTATION_STATUS.md) · [INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md) |
| Landing design reference | [references/landing/](references/landing/) |

## Stack

TypeScript everywhere · React 18 + Vite + Tailwind + Lucide · Fastify 5 · Prisma 6 + PostgreSQL · Zod · Argon2id · Vitest · Playwright · Render (one web service + one PostgreSQL).

```
apps/server            Fastify API (services, routes, provider adapters, admin CLI)
apps/web               React SPA
packages/shared        Zod schemas, API types, plain-language labels
packages/sdk-contract  SDK wire contract — no SDK implementation
prisma/                Schema + migrations
tests/                 unit · integration · contract · e2e
```

## Run locally

Requirements: Node 20.18+ (22 recommended). No Docker needed — a local PostgreSQL is started with `embedded-postgres`.

```bash
npm install
cp .env.example .env
npm run dev:db
```
In a second terminal:
```bash
npx prisma migrate deploy
npm run dev:server
```
In a third terminal:
```bash
npm run dev:web
```
Open http://localhost:5173. The API runs on :3000 (Vite proxies `/api`).

Production-like run: `npm run build && npm start` → http://localhost:3000.

### Access model

- **Waitlist** (`/waitlist`): lead capture only — no account, no access.
- **₹99 one study** (`/access` → `/checkout`): one study credit after a *server-verified* Pine Labs payment. Checkout stays closed until `PAYMENTS_ENABLED=true` and the adapter is implemented — see [PINELABS_SETUP.md](docs/integrations/PINELABS_SETUP.md).
- **Invitation code** (`/redeem`): judges and pilot users get the same kind of study-credit entitlement without payment.
- A credit is consumed atomically when a test is first launched. Accounts without any grant can't use the workspace.

### Admin access and judge codes
```bash
npm run admin:grant-admin:dev -- --email you@example.com
npm run admin:codes:dev -- --label "Judges" --audience judge --plan complimentary --count 5 --uses 1 --expires-days 30
```
Or use **/app/admin** once you're an admin. Codes are printed once; only HMAC verifiers are stored.

## Tests

```bash
npm run test:unit          # pure logic (metrics, timelines, schemas, adapters)
npm run test:integration   # real PostgreSQL (embedded), full HTTP API, SDK contract fixtures
npm run build && npx playwright install chromium && npm run test:e2e   # browser tests
```
The contract tests and the e2e participant flow use **simulated SDK requests** (fixtures). They prove the Render side honours the contract; they are not proof that the separately built SDK works.

## Honesty rules built into the product

- No fake activity, sessions, feedback, AI findings, payments or "Connected" states.
- Numbers are deterministic (PostgreSQL), with numerators and denominators; empty denominators show "—".
- The sample report is labeled **Example report — illustrative data**.
- PostHog, the UX Director and Pine Labs show **Not configured** until a real verification passes.
