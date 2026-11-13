# PostHog Cloud — Setup Guide

**Status:** adapter implemented ([`apps/server/src/integrations/posthog.ts`](../../apps/server/src/integrations/posthog.ts)), **not connected or verified** against a live PostHog project.

## 1. What it does
- Render forwards every accepted, sanitized SDK event to PostHog via a durable outbox (`outbox_messages`) with retries and backoff.
- Events use the PostHog capture format: `event`, `distinct_id` (pseudonymous participant key, never an email), `uuid` (= First Five `event_id`, for idempotency), `timestamp`, and `ff_*` properties (`ff_project_id`, `ff_study_id`, `ff_session_id`, `ff_mode`, `ff_page_path`, `ff_element_key`, …). PostHog's own `$session_id` is never overwritten. `$process_person_profile` is `false`.
- Future reads (paths, funnels, timelines) use the HogQL Query API with strict study/project filters and size caps.
- PostgreSQL remains authoritative for outcomes and counts. If PostHog is down, dashboards still show correct numbers.
- Events received **before** PostHog is configured are not back-filled.

## 2. What it needs
| Variable | Example | Secret? |
|---|---|---|
| `POSTHOG_HOST` | `https://us.i.posthog.com` or `https://eu.i.posthog.com` | no |
| `POSTHOG_PROJECT_API_KEY` | `phc_…` (project token for ingestion) | low (write-only) |
| `POSTHOG_PERSONAL_API_KEY` | `phx_…` (personal API key with *Query Read* scope) | **yes** |
| `POSTHOG_PROJECT_ID` | `12345` | no |
| `POSTHOG_API_HOST` | `https://us.posthog.com` (optional; derived from `POSTHOG_HOST`) | no |

## 3. Where to get it
PostHog → **Project settings → General**: project token (`phc_`), project ID and region. **Account → Personal API keys → Create**: scope it to this project with *Query: Read* only. In **Project settings → Autocapture & Session replay**, keep both **off** for this project.

## 4. Where to configure it
Render dashboard → service **first-five** → **Environment** → add the variables → **Save, rebuild and deploy**. Never commit keys to Git or paste them in chat; the browser never receives them.

## 5. How to test
1. Log in as a superadmin (`npm run admin:grant-superadmin -- --email you@…`).
2. Open **/app/admin → Integrations → PostHog → Run verification**.
3. The server sends one `ff_integration_check` event, then queries it back with HogQL.

## 6. Expected success
Status **Verified**, message “Test event captured and read back.” Then run a setup walkthrough and confirm `ff_page_viewed` events appear in PostHog with `ff_project_id`.

## 7. Common errors
| Message | Cause |
|---|---|
| `Missing: POSTHOG_…` | Variable not set / service not redeployed |
| `Capture failed: HTTP 401` | Wrong project token or wrong region host |
| `Verification pending … query access isn't configured` | Personal key or project ID missing |
| `Verification pending … not queryable yet` | Normal ingestion delay — retry after a minute |
| `Query failed: HTTP 403` | Personal key lacks *Query Read* scope or belongs to another project |

## 8. Troubleshooting
Check `/app/admin` for the last error, Render logs for `analytics outbox delivery failed`, and the `outbox_messages` table (`status`, `attempts`, `last_error`). Messages become `dead` after 8 attempts; set them back to `pending` after fixing credentials.

## 9. How to disconnect
Remove the `POSTHOG_*` variables and redeploy. Status returns to **Not configured**; ingestion continues into PostgreSQL only. Delete data in PostHog separately if required.

## 10. Re-run regression tests
```bash
npm test
```
Unit tests cover the event mapping and adapter; integration tests confirm “Not configured” behaviour. After connecting, also repeat the walkthrough in step 6.

**Claude Code prompt:** “Connect PostHog” — reads this guide, asks only for the values in §2, and verifies a real round-trip.
