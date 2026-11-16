# Deploying First Five on Vercel

First Five runs on Vercel (team `curious-minds3`, Hobby plan) with its data in the shared hosted Supabase project (`jyefwcjbsmekmdubykyo`, ap-southeast-1). This replaces Render (see `RENDER.md`, kept for rollback).

## How it runs

| Piece | Where | Notes |
|---|---|---|
| Web app (React SPA) | Vercel CDN, from `apps/web/dist` | Every non-API route falls back to `index.html` |
| API (Fastify) | One Vercel Function, `api/index.mjs` → `apps/server/dist/vercel.js` | Region `sin1`, Node 22.x, `maxDuration` 300 s |
| `/healthz`, `/readyz` | Same function | Same paths as before |
| Database | Supabase schema `first_five` (production), `first_five_preview` (previews) | Prisma reaches it through the Supavisor pooler |
| Maintenance | Vercel cron, daily at 21:30 UTC (03:00 IST) → `GET /api/internal/maintenance` | Hobby allows one run a day |

Work a request starts but doesn't await (analytics outbox delivery, analytics snapshot refresh, UX Director analysis) is handed to Vercel's `waitUntil` through `ctx.defer`, so it isn't frozen when the response is sent.

## Build and migrations

`vercel.json` runs `npm run vercel-build`:

```
prisma generate && prisma migrate deploy && npm run build -w @firstfive/web && npm run build -w @firstfive/server
```

- Each environment's `DIRECT_URL` points at its own schema, so production builds migrate `first_five` and preview builds migrate `first_five_preview`. A preview never touches production data.
- A failed migration fails the build, and the previous production deployment keeps serving.
- Render's `npm start` (migrate, then `node apps/server/dist/index.js`) is unchanged.

## Environment variables

Set per scope in the Vercel project. "Same" means the same key with the scope's own value. Never reuse production `SESSION_SECRET` or `CRON_SECRET` on previews.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | `production` | |
| `DATABASE_URL` | Supavisor 6543, `?pgbouncer=true&connection_limit=1&schema=first_five` | same, `schema=first_five_preview` | Runtime connections (transaction pooler) |
| `DIRECT_URL` | Supavisor 5432, `?schema=first_five` | same, `schema=first_five_preview` | `prisma migrate` (session pooler) |
| `APP_URL` | `https://<APP_DOMAIN>` | not set | Previews derive the URL from `VERCEL_BRANCH_URL` and also trust `VERCEL_URL` |
| `SESSION_SECRET` | copied exactly from Render | new random value | A different production value signs everyone out |
| `CRON_SECRET` | new random value (≥ 32 chars) | different random value | Guards `/api/internal/*`; Vercel cron sends it |
| `INVOCATION_SOFT_LIMIT_MS` | `200000` | `200000` | An analysis run hands itself to a new invocation after this |
| `DISABLE_SCHEDULER` | `true` | `true` | Not read on Vercel; set for clarity |
| `SDK_SCRIPT_URL` | from Render | same | |
| `PAID_STUDY_PRICE_MINOR`, `PAID_STUDY_CURRENCY`, `PAID_STUDY_CREDITS`, `PAID_PARTICIPANT_CAP` | from Render (defaults otherwise) | same | |
| `PAYMENTS_ENABLED`, `UPI_PAYEE_VPA`, `UPI_PAYEE_NAME` | from Render | same | |
| `POSTHOG_HOST`, `POSTHOG_API_HOST`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | from the Render env group | same | `POSTHOG_PROJECT_TOKEN` is also accepted for the project key |
| `UX_DIRECTOR_PROVIDER` | `anthropic` | `anthropic` | |
| `ANTHROPIC_API_KEY` | from Render | same | `GEMINI_API_KEY` only if the provider is `gemini` |
| `UX_DIRECTOR_MODEL_Q2`, `UX_DIRECTOR_MODEL_MAP`, `UX_DIRECTOR_MODEL_REDUCE`, `UX_DIRECTOR_MODEL_SCORE` | unset (provider defaults) | unset | |
| `UX_DIRECTOR_Q2_TIMEOUT_MS`, `UX_DIRECTOR_RUN_BUDGET_MS`, `UX_DIRECTOR_FINDING_THRESHOLD`, `UX_DIRECTOR_RECOMMENDATION_THRESHOLD` | unset unless Render sets them | same | Run budget stays 600 s across invocations |
| `PINELABS_ENV`, `PINELABS_BASE_URL`, `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET`, `PINELABS_MERCHANT_ID`, `PINELABS_WEBHOOK_SECRET` | from the Render env group | same | |
| `ADMIN_FLAG_NO_WEBSITE_DAYS`, `ADMIN_FLAG_NOT_CONNECTED_DAYS`, `ADMIN_FLAG_NO_ATTEMPTS_HOURS` | unset (defaults 3 / 2 / 48) | same | |
| `DEFAULT_CODE_STUDY_CREDITS`, `DEFAULT_CODE_PARTICIPANT_CAP`, `MAX_DRAFT_STUDIES` | unset (defaults) | same | |
| `EVENT_RETENTION_DAYS`, `OUTBOX_RETENTION_DAYS`, `ANALYTICS_SNAPSHOT_TTL_SECONDS` | unset (defaults) | same | |
| `LOG_LEVEL` | `info` | `info` | |
| `PORT`, `HOST`, `SWEEP_INTERVAL_SECONDS`, `RENDER_EXTERNAL_URL`, `DEV_WEB_ORIGIN` | not used on Vercel | not used | Render or local only |

Not carried over: `AGENTICORG_*`, `ADMIN_BOOTSTRAP_TOKEN` (no longer read).

Vercel sets `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_BRANCH_URL` itself; the app reads them only on previews.

## Cron and analysis continuation

- **Maintenance:** the daily cron calls `GET /api/internal/maintenance` with `Authorization: Bearer $CRON_SECRET`. It reconciles expired sessions, retries the analytics outbox, refreshes stale snapshots, purges data past retention and resumes stalled analysis runs. Without the secret the endpoint answers 401; with no `CRON_SECRET` set it answers 503.
- **Analysis continuation:** a function invocation is capped at 300 s, but a UX Director run may take up to 600 s. After `INVOCATION_SOFT_LIMIT_MS` the run stops between batches and calls `POST /api/internal/analysis/:runId/continue` (same secret) to continue in a new invocation. Step leases stop two invocations from running the same step.
- **Safety net:** opening a report that is still `processing` resumes its run, so a broken continuation recovers on the next poll instead of waiting for the daily cron.

Run the cron by hand: `vercel crons run /api/internal/maintenance`, or `curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_DOMAIN>/api/internal/maintenance`.

## Moving the data from Render

The production dataset is copied directly from Render Postgres into Supabase schema `first_five` in one streamed, single-transaction `pg_dump | psql` run (`scripts/db-copy/`). Nothing is staged on disk; any failure rolls back the whole copy and Render is only read.

The copy needs `pg_dump`/`psql` 17 (`brew install libpq`; the script uses `/opt/homebrew/opt/libpq/bin` unless `PG_BIN` says otherwise). No Docker.

1. Open the Render DB `ipAllowList` to the operator's IP and set `SRC` (Render external URL, `sslmode=require`) and `DST` (Supabase session pooler 5432).
2. Pre-flight, with Render live: the schema-only dump has no `CREATE SCHEMA/EXTENSION/FUNCTION`; Supabase `public` has no tables or enum types.
3. Cutover: suspend the Render web service, run `scripts/db-copy/copy-render-to-supabase.sh` once, check the row counts it prints, `prisma migrate deploy` with the production `DIRECT_URL`, promote the production deployment, attach the domain and smoke-test.

There is no rehearsal copy. If the copy fails, its transaction rolls back and Supabase is unchanged: resume Render, fix, and try again. A second run into an existing `first_five` stops at `CREATE SCHEMA` instead of merging.

The tables land in `first_five` with row level security on and no policies, so Supabase's public data API returns nothing for them; Prisma connects as the owner and isn't affected.

## Rollback

Same day only: resume the Render web service. Its database is never written by the copy and keeps running until 2026-11-23. Data written on Vercel after cutover is lost on rollback, and builders' old snippets (which point at the Render host) work again.

## Things to know

- **Snippets change host.** The public host moves from `*.onrender.com` to `<APP_DOMAIN>`; builders with installed snippets must copy the new one.
- **Rate limits are per instance** (in memory). Add Vercel WAF rate-limit rules for `/api/auth/*`, `/api/access-codes/*` and `/api/sdk/exchange`.
- **Previews are behind Vercel Deployment Protection.** SDK tests from external sites need a bypass token; production on the custom domain is public.
- **Hobby is for non-commercial use.** First Five sells studies; revisit the plan before turning payments on.
