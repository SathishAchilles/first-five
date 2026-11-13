# First Five — Architecture

## Topology

```
Builder / participant browser ──► Render web service (Fastify, Node 22)
                                   ├─ React SPA (apps/web, served as static files)
                                   ├─ Builder API      /api/auth, /api/projects, /api/studies, /api/reports …
                                   ├─ Participant API  /api/public/…   (first-party cookies + feedback handoff)
                                   ├─ SDK API          /api/sdk/…      (CORS, bearer credentials, no cookies)
                                   ├─ Admin API        /api/admin/…    (role = superadmin)
                                   └─ Scheduler (best effort): deadline sweep, outbox delivery, retention
                                         │
Customer website + SDK (separate) ───────┘ HTTPS event batches
                                         │
                       Render PostgreSQL ◄┘  authoritative state
                       PostHog / AgenticOrg / Pine Labs ◄ adapters (not configured yet)
```

One web service and one database — no queues, Redis or microservices.

## Repository layout

| Path | Contents |
|---|---|
| `apps/server` | Fastify API. `services/` business logic, `routes/` HTTP, `integrations/` provider adapters, `cli/` admin commands |
| `apps/web` | React + Vite + Tailwind SPA |
| `packages/shared` | Zod request schemas, response DTO types, plain-language labels |
| `packages/sdk-contract` | SDK wire contract (types, schemas, limits, error codes). **No SDK code** |
| `prisma/` | Schema and SQL migrations |
| `tests/` | `unit/`, `integration/` (real PostgreSQL), `contract/` (SDK contract fixtures), `e2e/` (Playwright) |

Workspace packages are consumed as TypeScript source and bundled by tsup (server) and Vite (web).

## Key design decisions

| Decision | Why |
|---|---|
| PostgreSQL is the single source of truth for outcomes | PRD §4: PostHog/AgenticOrg are never authoritative for counts or state |
| Session transitions are conditional `UPDATE … WHERE status='pending'` | Concurrent goal/timeout/end cannot double-finalize |
| Deadline reconciliation runs on a timer **and** on demand before reads | Free Render instances sleep; correctness can't depend on `setInterval` |
| One-time tickets in URL fragments → bearer credentials | No third-party cookies; fragments never hit server logs or Referer |
| Only hashes of tokens/codes are stored | Session cookies, tickets, credentials (SHA-256), invitation codes (HMAC-SHA256) |
| Study versions are immutable once participants start | Changing a goal requires a new version; old results stay accurate |
| Report publishing requires an approval row for the current revision | Approval can't be bypassed from the UI; AgenticOrg reports need external HITL confirmation |
| Provider status = env presence + last real verification | "Verified" is never shown because of settings alone |
| Customer copy lives in `packages/shared/src/labels.ts` | Consistent plain-language terminology |

## Data model (Prisma)

Accounts: `users`, `auth_sessions`, `access_grants`, `invitation_codes`, `invitation_code_redemptions`, `waitlist_entries`.
Projects/SDK: `projects`, `project_origins`, `project_sdk_configs`, `setup_sessions`, `sdk_tickets`, `sdk_credentials`, `discovered_pages`, `discovered_elements`, `discovered_custom_events`.
Studies: `studies`, `study_versions`, `participant_invites`, `study_sessions`, `critical_event_receipts`, `event_records` (sanitized, purged after `EVENT_RETENTION_DAYS`).
Interviews: `interview_questions` (exact displayed text + source), `interview_responses`.
Reports: `reports`, `report_findings`, `report_approvals`, `agent_runs`.
Payments: `orders`, `payments`, `payment_webhook_events`.
Ops: `provider_connections`, `outbox_messages`, `audit_logs`.

## Security controls

- Argon2id password hashing (OWASP parameters), timing-equalized login, 30-day sliding sessions in HTTP-only `SameSite=Lax` cookies (`Secure` on HTTPS).
- CSRF: cookie-bearing state-changing requests must carry an `Origin` matching `APP_URL`.
- Every builder query is scoped by `ownerId` (cross-tenant IDs return 404).
- Rate limits: signup, login (IP+email), code redemption, participant start, SDK endpoints (per credential), webhooks.
- Strict CSP (`script-src 'self'`), HSTS on HTTPS, `frame-ancestors 'none'`.
- No server-side fetches of builder-supplied URLs (no SSRF surface). The only outbound calls go to admin-configured provider hosts.
- Event allowlists, field schemas, path/label sanitization, sensitive-key rejection, body limits, de-duplication by event UUID.
- Logs redact `authorization`, `cookie`, feedback tokens and `set-cookie`.
- Participant answers are stored as plain text (control chars stripped) and always rendered escaped.
