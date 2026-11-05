# First Five — Implementation Status

As of 24 Oct 2026. "Tested" means an automated test that actually ran and passed (unit 34, integration/contract 49, browser 9). Deployed to https://first-five.onrender.com on 24 Oct 2026 (read-only smoke test 9/9 passed).
Landing page and access system details: [LANDING_PAGE_IMPLEMENTATION_STATUS.md](LANDING_PAGE_IMPLEMENTATION_STATUS.md). Integrations: [INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md).

| Feature | Implemented | Tested | Connected | Where | Known limitations | Next action |
|---|---|---|---|---|---|---|
| Email/password auth, Argon2id, HTTP-only sessions, CSRF origin check, rate limits | Yes | Yes | n/a | `services/auth.ts`, `/api/auth/*` | No email verification or password reset (no email service) | Add an email provider if needed |
| Study-credit entitlements (₹99 / invitation code), workspace gating | Yes | Yes | n/a | `services/entitlements.ts` | — | — |
| Invitation codes + admin generation (UI + CLI) | Yes | Yes | n/a | `/redeem`, `/app/admin`, `npm run admin:codes` | — | Generate judge codes after deploy |
| Waitlist leads | Yes | Yes | n/a | `/waitlist`, `POST /api/waitlist` | No confirmation email | — |
| Websites (projects), origin allowlist, unique public IDs | Yes | Yes | n/a | `/api/projects` | — | — |
| Installation snippet (configurable `SDK_SCRIPT_URL`, preview label) | Yes | Yes | SDK pending | `services/projects.ts` | Shows "Setup preview" until the SDK URL is set | Set `SDK_SCRIPT_URL` |
| Connection status from real evidence only | Yes | Yes | SDK pending | `check-connection`, `GET /api/sdk/config` | — | Connect the SDK |
| Setup walkthrough + discovery catalog | Yes | Contract tests | SDK pending | `/api/projects/:id/setup-sessions`, `/api/sdk/*` | Tested with fixtures only | Real SDK walk |
| Study builder (guided), versions, lifecycle | Yes | Yes | n/a | `/app/tests/new`, `services/studies.ts` | — | — |
| Participant consent, attempts, capacity, resume | Yes | Yes (incl. browser) | n/a | `/t/:id`, `/api/public/*` | — | — |
| Cross-domain launch tickets → SDK credentials | Yes | Contract tests | SDK pending | `/api/sdk/exchange` | Fragment handoff untested with real SPAs | Test on Demo A |
| Event ingestion (validation, sanitization, dedupe, rate limits) | Yes | Contract tests | SDK pending | `/api/sdk/events` | — | — |
| Session engine (goal verification, deadlines, invalid, concurrency) | Yes | Yes | n/a | `services/sessions.ts`, `services/sdk.ts` | In-process scheduler pauses while a free instance sleeps (on-demand reconciliation covers correctness) | Optional paid cron for `admin:sweep` |
| Post-task interview (Q1, contextual/fallback Q2, Q3) | Yes | Yes | UX Director contextual Q2 via Claude (falls back after 8 s) | `/t/:id/feedback` | — | — |
| Dashboard metrics, participant list, session timeline | Yes | Yes | PostHog pending | `/app/tests/:id` | Local analytics only | Connect PostHog |
| Reports: owner-written findings, evidence validation, review, publish | Yes | Yes | n/a | `/app/reports/:id`, `/r/:token` | — | — |
| UX Director analysis (in house) | Yes — durable pipeline (evidence → map → reduce → verify → rubric score → ready), Claude structured outputs, one-click publish; AgenticOrg retired | Local stub harness (`scripts/ux-director-local.ts`): order, retries, drop rule, publish policy, restart resume | Needs `ANTHROPIC_API_KEY` on Render | `integrations/ux-director.ts`, `ux-director/*`, `services/analysis-pipeline.ts`, `services/evidence.ts`, `services/reports.ts` | Rubric weights and thresholds still to tune from real runs | Set `ANTHROPIC_API_KEY`; run Admin verification; live end-to-end run |
| PostHog delivery/query | Adapter implemented | Unit (mapping, capture) | **Not configured** | `integrations/posthog.ts` | Never tested against live PostHog | "Connect PostHog" |
| Pine Labs checkout | Interface + order model | Integration (gating, verified-only grants) | **Not configured**; `PAYMENTS_ENABLED=false` | `integrations/pinelabs.ts` | No live calls implemented | "Connect Pine Labs" (UAT) |
| Admin: integrations, codes, real activity & funnel | Yes | Partly (API) | n/a | `/app/admin` | — | Grant yourself admin after deploy |
| Landing page + access funnel | Yes | Yes | n/a | `/`, `/access`, `/waitlist`, `/redeem`, `/checkout`, `/payment/status` | Privacy/Terms are drafts needing legal review | Legal review |
| Render deployment | Yes | Smoke test 9/9 on live URL | **Live** at https://first-five.onrender.com | `render.yaml`, `scripts/smoke.sh` | Free plan: sleeps after 15 min; DB expires 23 Nov 2026 | Grant yourself admin; generate judge codes |
