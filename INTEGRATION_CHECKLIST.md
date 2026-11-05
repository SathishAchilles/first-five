# Integration Checklist

Nothing below is marked ready because of scaffolding alone. "Verified" requires a real end-to-end check recorded with a date.

| Integration | Current status | What exists in this repo | What's needed to connect | Verify by |
|---|---|---|---|---|
| **First Five SDK** (separate project) | **Pending connection** — separately developed, never tested against this backend | Snippet generation (`SDK_SCRIPT_URL`, preview label when unset), full SDK API (config, exchange, session, events, end, setup finish), origin allowlists, discovery catalog, session engine, contract docs + OpenAPI, contract tests with fixtures | Hosted SDK URL → set `SDK_SCRIPT_URL`; SDK built against [SDK_INTEGRATION.md](docs/integrations/SDK_INTEGRATION.md) | §12 of the SDK guide: real setup walk turns website **Connected**; real participant completes; feedback loads |
| **PostHog Cloud** | **Pending configuration** (Not configured) | Adapter: event mapping, `/batch/` capture, HogQL query, round-trip verification, durable outbox with retries | `POSTHOG_HOST`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | `/app/admin` → Run verification → **Verified** (event captured and read back) — [guide](docs/integrations/POSTHOG_SETUP.md) |
| **UX Director (First Five)** | **Implemented (in house); live verification pending a valid API key**. AgenticOrg retired | Claude model client (structured outputs, effort, refusal fallbacks), durable step pipeline, rubric scoring with drop rule, one-click publish, stale signal, legacy reports | `ANTHROPIC_API_KEY` on Render (optional per-step model overrides and thresholds) | `/app/admin` → UX Director (First Five) → Run verification; Findings → Run analysis → Ready with scores → Publish — [guide](docs/integrations/UX_DIRECTOR.md) |
| **Pine Labs** | **Pending configuration** (Not configured; API calls intentionally not implemented). Checkout additionally gated by `PAYMENTS_ENABLED=false` | Orders/payments/webhook tables, ₹99 single-study offer, order-status endpoint + `/payment/status` page, idempotent webhook handling, amount check, credit-granted-only-after-verification rule, UAT/live flag | UAT credentials, current API reference, webhook registration | Legitimate UAT transaction → `paid_verified` order + one paid grant — [guide](docs/integrations/PINELABS_SETUP.md) |
| **Direct UPI (manual confirmation)** | **Enabled on Render** (`PAYMENTS_ENABLED=true`, payee UPI ID configured). Each payment is confirmed by an admin in `/app/admin` | QR/deep link checkout, UTR submission, admin confirm/reject, one credit per confirmed order | — | Pay ₹99 from a phone, submit UTR, confirm in admin, credit appears — [guide](docs/integrations/UPI_PAYMENTS.md) |
| **Render PostgreSQL** | **Verified on Render** — free PostgreSQL 16 `first-five-db` (Singapore, internal-only), migrations applied at deploy, `/readyz` → `database: ok`. **Free plan expires 23 Nov 2026** | Prisma schema, migrations, `render.yaml` (free plan, internal-only) | Deploy the Blueprint | `GET /readyz` → `{"database":"ok"}` on the Render URL; `/app/admin` → Postgres → Run verification |
| **Render web service** | **Deployed & smoke-tested** — https://first-five.onrender.com (free plan, sleeps after 15 min idle) | `render.yaml`, build/start scripts, `/healthz`, `/readyz`, graceful shutdown | Your approval + a Git repository Render can read | `bash scripts/smoke.sh https://<service>.onrender.com` |

## Connection log

| Date | Integration | Result | Evidence |
|---|---|---|---|
| 2026-10-24 | Render web service + PostgreSQL | Live; `scripts/smoke.sh` 9/9 PASS | Deploy `dep-dbe9og4s728c73bh6bgg`, service `srv-dbe9ofcs728c73bh695g` |
| 2026-10-24 | AgenticOrg UX Director | Live end-to-end (local app, real agents): 5/5 contextual questions from `ff_q2_generator`, report draft with 2 validated findings from `ff_ux_director` in 27 s, publish blocked until approval | `scripts/agenticorg-live-check.ts`, run `run_86e24adb68c0` |
