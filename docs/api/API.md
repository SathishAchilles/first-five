# First Five — Application API

All routes are JSON. Builder routes use the `ff_session` cookie. Errors: `{ "error": { "code", "message", "fields?" } }`.
SDK endpoints are specified separately in [SDK_INTEGRATION.md](../integrations/SDK_INTEGRATION.md) and [sdk-openapi.yaml](sdk-openapi.yaml).

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | Process up |
| GET | `/readyz` | Database reachable (503 otherwise) |

## Auth & access
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup` | `{ email, password, name?, invitationCode? }` → 201, sets cookie. **No access is granted at signup.** |
| POST | `/api/auth/login` | 10 / 15 min per IP+email |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | User + entitlement (`status: none|active`, study credits, usage) |
| PATCH | `/api/account` | `{ name }` |
| POST | `/api/access/redeem` | `{ code }` — atomic, audited; grants the code's study credits |
| GET | `/api/billing/offer` | ₹99 single-study offer; `checkoutAvailable` false unless `PAYMENTS_ENABLED=true` AND Pine Labs implemented + configured |
| POST | `/api/payments/checkout` | 503 `payment_unavailable` while checkout is closed |
| GET | `/api/payments/orders/:id` | Owner-only order status, read from the database (never from redirect parameters) |
| POST | `/api/payments/webhook/pinelabs` | Raw body, signature-verified, idempotent |
| POST | `/api/waitlist` | `{ name, email, productDescription?, productUrl?, source?, utm? }` → 201 `created` / 200 `already_registered`. Lead only — never an account or access. Honeypot + rate limit |
| POST | `/api/events` | Allowlisted client funnel events (`landing_page_viewed`, `paid_cta_clicked`, `waitlist_cta_clicked`, `access_page_viewed`) |

All workspace routes (`/api/projects…`, `/api/studies…`, `/api/reports…`, `/api/sessions…`) return **403 `no_entitlement`** for accounts that have never received a paid or complimentary grant. Accounts whose credits are used up keep read access to their work.

## Websites (projects)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects` | Create validates URL, entitlement; returns snippet |
| GET/DELETE | `/api/projects/:id` | Owner only |
| POST/DELETE | `/api/projects/:id/origins` | Manage allowed origins |
| POST | `/api/projects/:id/snippet-copied` | `setup_not_started → awaiting_connection` |
| POST | `/api/projects/:id/check-connection` | Status from real evidence only |
| POST | `/api/projects/:id/setup-sessions` | Starts walkthrough → one-time `#ff_setup=` URL |
| GET | `/api/projects/:id/discovery` | Pages, elements (available vs clicked), custom events |
| GET | `/api/projects/:id/studies` | |

## Tests (studies)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/studies` | Create = draft; verification flags derived from discovery |
| GET/PATCH/DELETE | `/api/studies/:id` | PATCH of definition after participants → 409 `version_locked` unless `createNewVersion: true` |
| POST | `/api/studies/:id/launch` | First launch consumes one study credit in the same transaction (422 `launch_blocked` / `no_study_credits` otherwise). Pause/resume/new versions don't consume more |
| POST | `/api/studies/:id/pause` · `/resume` · `/close` | Lifecycle |
| GET | `/api/studies/:id/dashboard?version=` | Deterministic metrics, behavior, insights state |
| GET | `/api/studies/:id/sessions?status=&version=` | Attempt list |
| GET | `/api/sessions/:id/details` | Timeline + feedback |
| GET | `/api/studies/:id/quotes` | Exact answers available for findings |
| GET/POST | `/api/studies/:id/reports` | Owner-written report (snapshot of metrics) |
| POST | `/api/studies/:id/analyze` | UX Director; 503 `provider_not_configured` until connected |

## Reports
| Method | Path | Notes |
|---|---|---|
| GET | `/api/reports`, `/api/reports/:id` | Owner only |
| PATCH | `/api/reports/:id` | Title/summary (draft only) |
| POST | `/api/reports/:id/refresh-metrics` | |
| POST · PUT · DELETE | `/api/reports/:id/findings[/:findingId]` | Evidence validated against the study; quotes copied verbatim |
| POST | `/api/reports/:id/request-review` | draft → awaiting_review |
| POST | `/api/reports/:id/review` | `{ decision: approved|rejected|revision_requested }` (owner reports) |
| POST | `/api/reports/:id/reopen` | New revision (old approvals no longer apply) |
| POST | `/api/reports/:id/publish` · `/unpublish` | Requires approval for the current revision |
| GET | `/api/public/reports/:token` | Published reports only, no internal IDs |

## Participant
| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/studies/:publicId` | Task, time, status, existing attempt for this browser |
| POST | `/api/public/studies/:publicId/attempts` | `{ consent: true }` → attempt + one-time launch URL; sets `ff_p_<study>` cookie |
| GET | `/api/public/studies/:publicId/attempt` | Current attempt |
| POST | `/api/public/studies/:publicId/attempt/end` | `{ reason }` — fallback controls on the First Five tab |
| GET/POST | `/api/public/studies/:publicId/feedback` | Header `x-ff-feedback: <handoff>` |

## Superadmin (role = superadmin; everyone else gets 404)
| Method | Path |
|---|---|
| GET | `/api/admin/overview` |
| GET | `/api/admin/integrations` · POST `/api/admin/integrations/:provider/verify` |
| GET/POST | `/api/admin/codes` · POST `/api/admin/codes/:id/disable` |
| POST | `/api/admin/maintenance` |
