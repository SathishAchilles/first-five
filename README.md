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

### Roles, superadmin access and judge codes
- **Account admin**: whoever signs up. They run their own builder account (websites, tests, reports, payments). Every new account gets this role.
- **Superadmin**: First Five operators (the founder). Sees the Superadmin area (`/app/admin`): overview, clients, payments, codes, integrations, support actions and view-as-client. There is no in-app way to become one; it's granted only from the server:
```bash
npm run admin:grant-superadmin:dev -- --email you@example.com            # grant
npm run admin:grant-superadmin:dev -- --list                             # who has it
npm run admin:grant-superadmin:dev -- --revoke --email someone@example.com
npm run admin:codes:dev -- --label "Judges" --audience judge --plan complimentary --count 5 --uses 1 --expires-days 30
```
Or generate codes in **/app/admin** once you're a superadmin. Codes are printed once; only HMAC verifiers are stored.

### Reviewing clients (/app/admin/clients)
- **Clients tab**: every builder account with access, credits left, live payments (sandbox orders shown separately as "test"), websites on the account (connection problems show as the "Connection issue" flag), tests launched, finished attempts, latest report status, last seen and a waitlist marker. Flags highlight stuck builders: connection issue (website not connected) after `ADMIN_FLAG_NOT_CONNECTED_DAYS` (2), 0 attempts `ADMIN_FLAG_NO_ATTEMPTS_HOURS` (48) after launch, report failed, payment awaiting check, no access. The "no website" flag (`ADMIN_FLAG_NO_WEBSITE_DAYS`, 3) is still computed by the API but not shown. Search, filter by flag and access, sort and page.
- **Client detail**: grants, orders, websites, tests and their sessions, reports and the audit trail. Sessions and reports open in the builder's own views (reports read-only). Opening a tester session writes an `admin.session_viewed` audit row.
- **Support actions** (each needs a written reason; the change and an audit row with before/after values commit together): grant access, revoke a grant, add credits, extend a test (at most 30 days out; owner-closed tests can't be reopened), re-run a failed or out-of-date UX Director report, add a website for a client stuck at setup (their own website limit applies; they still install the snippet).
- **Onboard a client** (Clients → Onboard client): for someone you already gave an invitation code. Enter their name, company, email, the code and a reason. It creates their account, applies the code (an invite-code grant, not a payment) and returns a one-time set-password link (7 days) to send them. Nobody can log in until they choose their own password there. A new link from the client page replaces the old one.
- **View as client**: a read-only session for 30 minutes, never extended. The server refuses every write with `read_only_view`, admin routes are hidden, a banner stays on every page, and start/stop/expiry are audited. The client's own sessions and last-seen time are untouched; tester and SDK traffic ignore it.
- **Rollback**: the migration only adds two columns to `auth_sessions`. If you roll back the code, first run `DELETE FROM auth_sessions WHERE "impersonatorUserId" IS NOT NULL;` so no view-as session outlives the read-only guard.

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
