# FIRST FIVE
## Final Product Requirements Document — v1.1

**Track:** AI for Builders · AI Builders Day 2026  
**Date:** 24 October 2026  
**Document type:** Business case + product specification + technical implementation contract  
**Status:** Approved implementation baseline, conditional on live credential and integration checks  
**Stack:** Render web/API · Render PostgreSQL · PostHog Cloud · First Five JavaScript SDK · AgenticOrg (UX Director) · Pine Labs  
**Product promise:** **Build with AI. Test with humans. Improve with First Five.**

> **Reading guide.** **MUST / P0** means required for a credible hackathon MVP; **SHOULD / P1** means high-value if P0 works; **LATER / P2** means intentionally excluded. Examples are illustrative unless explicitly labeled as observed research. This PRD defines application endpoints and tool interfaces to implement; it does not imply these endpoints already exist in AgenticOrg, PostHog, Pine Labs, or Render.

---

# 1. Executive decision and business case

## 1.1 What First Five is

First Five is a **task-based usability research and feedback-to-fix platform** for builders of websites and web applications. The customer installs **one reusable tracking SDK**, receives a **project-specific script snippet**, defines a real task such as completing onboarding or checkout, invites people to attempt it, and sees behavioral evidence plus **mandatory post-task interview opportunities**. A UX Director agent analyzes verified numbers and participants' own explanations, then drafts an evidence-linked report and actionable experiments for a human to approve.

First Five is **not** an automated functional test runner, an all-purpose analytics replacement, a promise of finding every UX bug, an A/B-test significance engine, or an AI that automatically changes a customer's code.

## 1.2 The problem and the insight

AI-assisted tools can make building and deploying software fast. But **a working product is not necessarily a usable product**. A developer can verify that a button responds; they cannot conclude that a person can discover it, understand it, trust it, or complete the underlying task. Early-stage builders often lack research skills, time, recruitment access, or a simple way to connect the observed behavior to the reason a participant provides.

**Unmet job:** “I built a new flow. Show me whether real people can finish it, where they struggle, what they expected, and what to change next — without teaching me enterprise analytics or UX research.”

**Hypothesis, not proven fact:** a tightly guided, affordable *behavior → explanation → evidence → action* loop will be more useful to first-time AI builders than raw metrics alone. The category is competitive: Maze, PostHog, Microsoft Clarity and other usability tools already offer overlapping capabilities. First Five differentiates on beginner-first setup, one-task studies, explicit intended-versus-observed-versus-reported comparisons, and copy-ready improvement experiments; it does not claim that click tracking or AI research is unprecedented.

## 1.3 Customers, users and buyers

| Actor | Who | Job / permissions |
|---|---|---|
| **Builder / buyer (primary)** | AI-assisted founder, indie hacker, freelancer or new product developer | Installs SDK, configures a task, invites testers, reviews and approves report, buys additional access |
| **Secondary builder** | Product manager, agency, commerce team | Runs the same workflow for a feature, onboarding, product discovery or checkout |
| **Participant / tester** | Invited prospective or current user | Consents, attempts one task, optionally describes their experience; must not see private builder analytics |
| **Reviewing human** | Authorized project owner or designated research approver | Reviews proposed findings; actually approves or rejects the publishing action |
| **First Five operator** | Company team | Supports integrations, verifies event delivery, monitors proof and resolves failures with restricted access |
| **UX Director** | AgenticOrg agent | Questions, explains, groups patterns, proposes experiments; no autonomous code changes or unapproved publication |

**Who pays:** the builder or business commissioning research, not the tester. **Why now:** early-stage builders can deploy before gaining user research capability. **Why Track 03:** the official booklet explicitly includes developer workflows such as testing and tools that help people build; this product addresses usability validation after building.

## 1.4 Business model and access decision

**Competition access policy (locked for v1.1):**

- **Free pilot:** one genuine study, up to five unique invited participants, basic metrics and one draft report; account proceeds into the working product.
- **Paid pilot:** an illustrative ₹99 upgrade for an additional study or more capacity, implemented through Pine Labs hosted checkout; price is **unvalidated** and may change.
- **Complimentary code:** a legitimate, auditable access grant for judges and approved pilot users; **not a fake payment**.
- **Waitlist:** only for future capabilities or users beyond pilot capacity; capture a real lead, show a truthful “we'll contact you,” and never count a waitlist-only signup as an active product user.

This consciously revises the earlier “free CTA goes nowhere” proposal: a waitlist-only free route conflicts with demonstrating 20 real people using the core product. Keep **real usage** distinct from **test payment** and from **genuine paying traction**.

## 1.5 Expected outcomes and hypotheses to test

| Outcome | Evidence | Caveat |
|---|---|---|
| Builder can activate independently | Project created, SDK installation verified, study launched | A signup alone is not activation |
| Real task performance is measured | Valid, consented, finalized study attempts | Do not count setup walks |
| Builder understands friction | Event timelines plus participant responses | Never manufacture “why” from clicks |
| Builder receives useful next action | Evidence-linked issue, hypothesis and proposed experiment | Improvement effect is not proven until retested |
| Willingness to pay | Verified real Pine Labs payment (live only) | UAT payment is integration proof, not paid traction |
| Product helps a real builder | One external builder completes full flow and acts on or evaluates findings | Save timestamped evidence |

**North-star (post-hackathon):** verified studies that result in at least one actionable, evidence-backed insight a builder judges useful. **MVP scorecard:** verified SDK integrations, launched studies, distinct active builders, valid participant attempts, interview response rate, successful agent runs, approved/published reports, real payments, and research-reported actions taken. Never aggregate distinct builder users and testers into a single unspecified “customers” number.

## 1.6 Competition constraints and scoring

Official booklet requires a live public product; **one real AgenticOrg agent doing meaningful work**, **human-in-the-loop step**, **working Pine Labs payment flow**, **20 real free users OR five real paying users**, and **one builder using the service end-to-end**. Real users must be outside the team; mentors and organizer staff do not count. A sandbox Pine Labs transaction is permitted on the 20-free-user route. A submitted demo video is at most two minutes; a public LinkedIn and X/Instagram post with required tags, proof of user activity, payment and agent logs, and submission details are mandatory. Judges may check live.

**Ambiguity to resolve with mentor:** whether invited testers completing studies qualify as product “users.” Safest practice: recruit actual builders who create or meaningfully use studies as well as testers; report both populations separately. No fake, bot or teammate accounts in traction. Code must be written that day under the booklet's rules; open-source dependencies and starter kits are permitted.

| Judge criterion | Round 1 | Round 2 | What First Five demonstrates |
|---|---:|---:|---|
| Problem and insight | 25% | 20% | Builder discovers missed usability friction |
| Ambition and originality | 15% | 20% | Guided expectation-gap and feedback-to-fix research |
| Agentic depth | 15% | 20% | Connected UX Director, tools, logs, real approval |
| Traction | 25% | 30% | Distinct real builders, actual studies, evidence |
| Demo and polish | 20% | 10% | One reliable end-to-end journey |

---

# 2. Product principles, non-goals and terminology

1. **One flow at a time.** A study has a task, start condition, success condition, deadline and optional milestones.
2. **Record only authorized study behavior.** The SDK is *not* always-on marketing surveillance; setup discovery and consented tasks have explicit modes.
3. **Separate fact, statement and inference.** “Clicked Pricing” (observed), “I wanted price clarity” (reported), “Pricing uncertainty may delay signup” (hypothesis).
4. **Human before consequential action.** The agent may draft; the authorized review actually gates publishing or sending.
5. **Deterministic arithmetic.** LLM must not decide counts or overwrite metric definitions.
6. **Honest uncertainty.** Missing feedback means “reason unavailable”; five participants are exploratory, not statistically representative of all customers.
7. **One reusable SDK.** The same JavaScript build works on both demo websites. Customers get a generated snippet with a unique public ID, not custom code.
8. **No sensitive fields.** Never record passwords, OTP, raw form values, card details or full personal URLs.

**Definitions**

- **Project:** one builder-owned website integration.
- **Setup walk:** builder's deliberate discovery/verification visit, excluded from study outcome totals.
- **Study:** an objective and its configured task goal, deadline and authorized participant link.
- **Participant:** an individual consenting tester; one person can make more than one attempt.
- **Task attempt / First Five session:** one server-created attempt to complete a study. **Not** the same as a browser or PostHog session.
- **Finalized:** attempt has an authoritative `completed`, `dropped` or `invalid` outcome.
- **Drop:** a task not completed by explicit stop or deadline, **not** long-term churn.
- **Feedback:** post-task answers linked to a specific attempt.
- **Finding:** a traceable statement produced by UX Director with source references.

---

# 3. End-to-end experiences and screen contracts

## 3.1 Journey A — Landing, free, paid and complimentary access (P0)

**Screens:** Landing → signup/login → plan/access selection → project list. Hero copy: **“Building got easier. Understanding your users didn't.”** Supporting copy explains install, test one task, see what happens, ask why, receive recommended changes. CTA **Start Free** opens usable pilot rather than an inert waitlist; secondary CTA **See how it works**. Clearly separated optional future-feature waitlist collects email/consent and confirms that access is not yet provided.

**Paid path:** choose Plus → Render makes pending order → Pine Labs hosted checkout → verified server-side status → access grant → create project. **Complimentary path:** restricted promo-code validation → audit access grant → project setup. Existing account login is mandatory; minimal email/password or hosted auth is acceptable if safe. Never expose provider secrets in frontend.

**Success:** one authenticated builder can enter project setup without payment on free pilot; a payment route can be demonstrated in UAT without confusing it with actual revenue.

## 3.2 Journey B — Project, SDK snippet and verification (P0)

Builder enters project name, canonical HTTPS origin and optional description. Render creates project, registered origins, public `project_id` and SDK config. Setup UI shows unique script snippet, copy button, “Paste into Claude Code / Lovable” installation instruction, detected status and “Start verification.” Customer inserts same SDK script into shared website layout and deploys.

**Example (placeholder domain only):**

```html
<script async src="https://FIRSTFIVE_RENDER_DOMAIN/sdk/firstfive.js"
        data-project-id="ffp_123"></script>
```

Builder opens the customer website in a **signed, short-lived setup session**, conducts the target walk and returns to First Five. SDK captures setup page/element discovery, sends through Render to PostHog, and Render stores a discovery catalog. Builder sees “Connected,” timestamp of last valid event, pages, available interactive elements, and any failed diagnostics. **Only actual discovered or explicitly configured elements** appear; don't say all buttons in entire site were detected.

## 3.3 Journey C — Create and publish study (P0)

Builder chooses **one** linked project, gives study name and participant-friendly task (“Create an account and reach your dashboard”), start path/condition, goal type (**button click / page reached / explicitly instrumented custom event**), target dropdown populated from setup discovery, time limit (default 5 minutes), allowed attempts, desired number of participants, and optional intermediate funnel milestones.

**Semantic truth:** Clicking “Pay now” measures the click, **not** completed payment. Reaching `/order/success` or `order_completed` is better for checkout outcome. Selected goal type must be displayed on the dashboard. Builder previews and publishes an invitation link. Render validates that the goal belongs to project, SDK is verified, and study status permits starts.

## 3.4 Journey D — Consent, cross-domain launch and task (P0)

1. Participant opens `https://FIRSTFIVE_DOMAIN/study/{study_id}`.
2. First Five shows one task, approximate time, privacy disclosure, consent, and start button.
3. After affirmative consent, Render creates attempt in Postgres with server start and deadline; issues a **one-time, short-lived launch token**, scoped to project, study, attempt, allowed origin, and expiry.
4. Participant is redirected to the **registered customer website** with a limited launch handoff (fragment or carefully controlled query) that its SDK can read. Do not rely on cross-domain cookies. Avoid exposing reusable secrets in URL; strip handoff data with `history.replaceState` once exchanged, protect referrers, and test against target SPA routing.
5. SDK exchanges handoff for a limited session credential at Render, checks consent/expiry, activates `live` mode, and records normalized interactions.
6. Study-specific, SDK-injected small **First Five task control** stays available without obscuring the website: task reminder, **“I'm stuck”** and **“Finish test.”** Use CSS isolation / Shadow DOM when appropriate and keyboard-accessible controls.
7. On verified goal, render marks `completed` idempotently and SDK offers **Continue to feedback**. “I'm stuck” explicitly ends as `dropped`; “Finish test” submits the end request and Render determines whether a goal was actually verified.
8. Participant returns to `firstfive.../study/{id}/feedback?handoff=...` through a **new expiring feedback handoff**. Frontend never uses bare session ID as authority. Tracking stops when task ends or consent is withdrawn.
9. Participant answers 2–3 post-task questions; sees a thank-you screen.

**What if browser closes?** The study will time out at its server-side deadline. No interview is guaranteed; display `feedback unavailable`. **What if flow has multiple domains or third-party hosted checkout?** Detailed interaction tracking stops when the participant leaves instrumented, allowed origins unless those origins install the SDK too. Do not infer unobserved offsite interactions. **What if the test widget itself fails?** Participant's original invite page contains a recovery/finish URL or obvious way back to First Five; backend still expires the task.

## 3.5 Journey E — Post-task qualitative interview (P0, mandatory opportunity)

**Q1 standardized:** “How easy or difficult was this task?” (fixed scale plus “couldn't complete”). **Q2 contextual:** user-specific neutral question based on a real event (“You visited pricing before signup. What were you trying to find?”). **Q3 open:** “What would have made this task easier?” Responses may be skipped; collect exact text or choice and timestamp, and mark missing separately. Do not force “why was it confusing?”

Render assembles a **sanitized** session summary and starts AgenticOrg contextual-question workflow where feasible. Initial Q1 and Q3 display immediately; Q2 is shown if valid agent output arrives within a short bounded wait. Otherwise use a safe default (“Was anything different from what you expected?”). **Agent unavailability never blocks interview submission.** Store actual displayed question as well as the answer. Do not generate more than one personalized question for MVP. The generic study language is English for MVP; localization is P2.

## 3.6 Journey F — Builder dashboard and drill-downs (P0)

**Header:** Project, study, task text, goal type and definition, study status, data timestamp, participant count and task deadline. **Cards:** started valid attempts, completed, dropped, pending, completion rate among finalized valid attempts, median time to completion, interview response rate. Show `3/5` beside percentages. A small funnel exists if builder confirmed its stages; otherwise show page/action path observations instead of inventing funnel steps.

**Completed detail:** sortable attempt list with duration, event count, pages, detours/backtracking, repeat clicks, participant feedback; selecting an attempt opens timestamped event timeline and evidence-linked individual findings. “Completed” does not mean “no friction.”

**Dropped detail:** last observed reliable step, deadline/explicit stop, errors, repeated actions, time to last observed activity, available feedback or “Reason unknown,” event timeline. Last interaction must not be labeled the cause of drop.

**Insights detail:** issue title, affected counts, supporting sessions/events, exact relevant quotes, contradicting sessions, observed/reported/inferred labels, strength of evidence, experiment recommendation, expected success signal, and review/approval status. Builder can inspect source evidence and reject or request revision before publication.

**Dashboard during study:** quantitative cards may load before AI report; progress shows `Collecting`, `Metrics ready`, `Analyzing`, `Draft awaiting review`, `Approved`, or `Failed/retry`. Empty states never fabricate numbers. Private owner can read draft findings; sharing/sending the final report requires real HITL approval.

---

# 4. Technical ownership and system topology

```text
BUILDER / PARTICIPANT BROWSER
  │                    ┌─ Customer's own web app ─┐
  ├─ First Five UI     │ Installed First Five SDK  │
  │                    └──────────┬────────────────┘
  ▼                               ▼
RENDER WEB APP + API  <── HTTPS event batches, session handshake
  ├─ Auth & permissions
  ├─ Projects / SDK config / discovery / studies
  ├─ Session state machine & critical event receipts (authoritative)
  ├─ Interview collection, reports, access grants
  ├─ Analytics read/API / background outbox processor
  │         │
  │         ├── RENDER POSTGRES — operational + critical state
  │         ├── POSTHOG CLOUD — detailed behavior, paths, funnel analysis
  │         ├── AGENTICORG — UX Director, HITL, run evidence
  │         └── PINE LABS — verified hosted checkout
  ▼
CUSTOMER DASHBOARD — facts + feedback + approved findings
```

**Render serves frontend and backend.** Render Postgres is mandatory unless replaced with another genuine transactional database. **PostHog is not a replacement for Postgres.** PostHog is the analytics source of raw interaction histories; the backend is authoritative for task starts, goal achievements, timeout/end outcomes, study configuration, permissions, payment, consent, responses and report publication. AgenticOrg is not the metrics calculator. Pine Labs is a payment service, not a study-session system.

### 4.1 Technical stack and ownership table

| Component | MUST do | MUST NOT do |
|---|---|---|
| First Five SDK | Setup discovery; consented live events; secure session handoff; goal signals; test control; safe batch transmission | Intercept private form contents; collect all site visitors; hold admin/provider credentials |
| Render API | Auth, project/study/config, event validation, state transitions, provider calls, billing authorization | Blindly trust frontend “completed” or “paid” flags |
| Postgres | Durable operational truth, event outbox, session idempotency, approvals sync, reports | Be replaced by local Render filesystem/SQLite for durable customer data |
| PostHog Cloud | Event storage, scoped paths/funnels, bounded queries | Own auth/payments or decide authoritative task outcome |
| AgenticOrg | Structured contextual question, individual/aggregate evidence analysis, HITL-connected publication | Fabricate feedback; silently publish; change measurements |
| Pine Labs | Checkout and verified order status | Be called from frontend with client secret |
| Render frontend | Participant and owner flows, status, reports, drill-down | Display unsafe mixed-tenant event data |

---

# 5. SDK specification: reusable browser library

## 5.1 Packaging and configuration

**Build:** one versioned, minified JavaScript bundle served from Render `/sdk/v1/firstfive.js` (convenience alias `/sdk/firstfive.js`). Load asynchronously from all website pages via shared layout. All customers share bundle; `data-project-id` varies. A version/SDK timestamp appears in verification diagnostics. No separate per-customer bundle or PostHog project.

**Public config fetch:** `GET /api/sdk/config?project_id=...` returns **nonsecret** project status, allowed origins, supported SDK version, endpoint URL, event allowlist and upload bounds. Request for config alone may register a *technical installation ping* but may not collect behavioral events without setup mode or consented live token.

**CSP/CORS:** documentation specifies `script-src` allowance for the SDK's Render host, `connect-src` for Render API, and allowed browser origins. `Origin` and `Referer` checks are defense in depth, not authentication against a malicious caller. A public project ID is **never an authorization secret**.

## 5.2 State machine

```text
UNINITIALIZED → CONFIG_LOADING → READY (no behavioral tracking)
READY → SETUP_ACTIVE [signed setup authorization]
READY → LIVE_ACTIVE  [consent + exchanged signed one-time launch token]
SETUP_ACTIVE → SETUP_FINISHED → READY
LIVE_ACTIVE → TASK_FINALIZING → FEEDBACK_HANDOFF → STOPPED
ANY ACTIVE → STOPPED [consent withdrawal / study closed / expired]
ANY → DEGRADED [network/integration issue] → RETRY / STOPPED
```

Reloads must restore only an unexpired **current-origin** authorized task-session credential, not infer a task session from local account cookies. End, expiry and withdrawal clear it. Client state is not proof of a final outcome; Render verifies the transition.

## 5.3 Public and internal functions

| Function | Mode | Contract |
|---|---|---|
| `init(projectId)` | All | Parse script args, fetch config, set diagnostics |
| `exchangeLaunchToken(token)` | Setup/live | Obtain short-lived scoped authorization; reject consumed, expired, wrong origin |
| `scanPage()` | Setup | Catalog visited path and eligible elements, with safe labels and stable IDs |
| `observeDynamicElements()` | Setup | Debounced DOM changes for late-rendered buttons/links; bounded scanning |
| `trackPageView(path)` | Active | Initial load, `pushState`, `replaceState`, `popstate`, hash changes if configured |
| `trackElementClick(element)` | Active | Capture tag, stable ID, page and safe label without input contents |
| `trackFormSubmit(form)` | Active | Record safe form ID and submission *attempt*, never form values |
| `trackCustomEvent(name, allowlistedProps)` | Active | Application may explicitly signal `signup_completed`, `order_completed` etc. |
| `observeActivity()` | Live | Rate-limited last-active signals, visibility status as available |
| `sendBatch(events)` | Active | HTTPS, per-event UUID, ordered client sequence, bounded batch, retry safely |
| `showTaskControl()` | Live | Accessible overlay with task/“I'm stuck”/“Finish test” and confirmation states |
| `requestEnd(reason)` | Live | Server determines verified outcome; generates authorized feedback handoff |
| `stop(reason)` | All | Remove listeners/widget, invalidate local tracking authorization, stop sending |
| `diagnose()` | Setup | SDK version, connection, consent/mode, last acknowledged event, nonsecret errors |

SDK should never monkeypatch app business logic or prevent an application action. Use stable `data-firstfive-id` where supplied; fallback element identity is best effort and can be invalidated by UI changes. Exclude sensitive nodes, text inputs and payment forms from discovery and tracking. SDK must not promise full heatmaps or replay in MVP.

## 5.4 Setup discovery algorithm

During setup walk only: on each observed page, collect normalized path (strip sensitive query components), scan DOM for supported `button`, anchors, `[role=button]`, selected input submit controls and explicit `data-firstfive-id`. Collect safe label, node type and stable attribute; deduplicate as `(project, route, element_key)`. Optionally use a throttled `MutationObserver` for client-rendered controls. Record *available* elements and *clicked* elements as different facts. Builder confirms/corrects goal selections. Do not infer inaccessible iframe contents or unvisited screens.

## 5.5 Allowed browser events

| First Five event | Safe fields | Essential? |
|---|---|---|
| `ff_page_viewed` | route, client timestamp, sequence | P0 |
| `ff_element_clicked` | element ID/type/safe label, route, timestamp | P0 |
| `ff_form_submitted` | safe form ID, route; no values | P0 |
| `ff_custom_event` | preapproved event and validated properties | P0 for native outcomes |
| `ff_activity` | last active, visibility signal, throttled | P1 |
| `ff_client_error` | sanitized error type and route | P1 |
| `ff_element_discovered` | available element catalog in setup mode | P0 |
| `ff_goal_reached` | SDK hint only; must be server verified | P0 internal derived outcome |

**Server-generated** authoritative `session_started`, `goal_verified`, `session_finalized` are in Postgres. Do not trust user-controlled client event claims blindly.

## 5.6 Canonical event contract v1

```json
{
  "schema_version": 1,
  "event_id": "uuid-event-01",
  "event_name": "ff_element_clicked",
  "project_id": "ffp_123",
  "study_id": "ffs_456",
  "session_id": "ffx_789",
  "mode": "live",
  "client_sequence": 17,
  "client_timestamp": "2026-10-24T09:00:00Z",
  "page_path": "/signup",
  "element_key": "create_account",
  "element_type": "button",
  "element_label": "Create Account"
}
```

Transport credential is provided separately (signed setup/study credential in header) and is never stored as a PostHog property. Render stamps `received_at` and validates event type, size, origin, project, session, study, schema version and maximum clock skew. Field allowlists prevent arbitrary PII or oversized labels.

## 5.7 Event ingestion and reliability

1. SDK batches small event groups, generating a UUID and increasing client sequence for each.
2. `POST /api/sdk/events` authenticates the **scoped study/setup credential**, checks approved project-origin/session-state, validates/sanitizes each field, rate-limits by project/attempt, rejects too-large batches.
3. Inside a Postgres transaction, persist any **critical** state updates and an **outbox record** for accepted events. Respond accepted only after durable commit; return per-batch result for retry/dedup.
4. Render forwards outbox payloads to PostHog with idempotency metadata, tracks delivery/attempts and bounded backoff. Retry delivery on next worker job/eligible app request if dedicated worker unavailable; do not falsely claim always-on delivery without worker deployment.
5. Refresh dashboard summary from Postgres; load richer click/journey details from bounded PostHog queries, showing processing/data-delay status when not yet available.
6. Retain undelivered events for recovery; alert on persistent errors; expire/purge temporary outbox records after confirmed delivery and retention policy.

**Edge cases:** duplicate event UUID → acknowledge but never double-count; late goal after deadline → enforce server event-time and quality rules, flag contested cases; out-of-order events → sort using sequence and trusted timestamps but never permit an expired client to revive session; missing event batch → `incomplete_tracking` data quality; browser offline/close → best-effort beacon only, server deadline always finalizes; PostHog delay → not a reason to change completed to dropped.

---

# 6. Session, identity and metrics contracts

## 6.1 Identity and attempts

- `user_id` = authenticated builder.
- `project_id` = website integration.
- `study_id` = one task specification.
- `participant_key` = pseudonymous identifier scoped to study/invite; never use email as PostHog `distinct_id`.
- `attempt_id`/`session_id` = one First Five task attempt created server-side.
- `event_id` = one browser event UUID.
- PostHog's `$session_id` is not First Five's task-session ID; store `ff_session_id` separately.

For the 5-person study, default **one eligible counted attempt per invitation**, while retain additional attempts flagged `repeat` and exclude from primary outcomes unless builder deliberately includes them. Browser refresh is the *same* attempt if token still valid. Shared anonymous links require issuance of distinct participant tokens or honest limitation in “unique participants.” Do not treat pageviews as users.

## 6.2 Authoritative session states

```text
CREATED → PENDING (task started)
PENDING → COMPLETED [validated goal, before deadline]
PENDING → DROPPED  [explicit unable-to-complete or expiry]
PENDING → INVALID  [integration compromised / technical failure / ineligible]
COMPLETED, DROPPED, INVALID = terminal (audited admin correction only)
```

A separate `feedback_status`: `not_prompted`, `awaiting`, `submitted`, `skipped`, `unavailable`. Feedback does not change task outcome. Use atomic conditional updates in PostgreSQL so two simultaneous goal/timeout/finish requests cannot both finalize. Preserve `finalized_at`, `final_reason`, `verified_goal_event_id`, `data_quality_flag`. Expiration must be server-run on a schedule or audited on-demand sweep when worker/cron unavailable; **no browser close event required**.

## 6.3 Source-of-truth formulas

| Metric | Authoritative definition |
|---|---|
| Valid started attempts | `completed + dropped + pending` (exclude invalid/setup/repeats for primary view) |
| Completed attempts | Valid terminal `completed` attempts |
| Dropped attempts | Valid terminal `dropped` attempts |
| Pending | Valid started attempts not finalized |
| Finalized | Completed + dropped |
| Completion rate | Completed / finalized; show `—` if finalized=0 |
| Drop rate | Dropped / finalized; show counts alongside % |
| Median time to goal | Median(`goal_verified_at` - `started_at`) over completed attempts |
| Feedback response rate | Eligible finalized attempts with at least one submitted response / eligible finalized attempts |
| Unique participants | Count reliable distinct `participant_key`; show reliability caveat |
| Unique sessions clicking target | Distinct eligible task-session IDs with a qualifying clicked event |
| Goal click rate | Eligible sessions clicking target / sessions that reached eligible target context; for click objectives only |
| Step progression | Distinct eligible attempts reaching next **configured** milestone after prior one / attempts at previous milestone |
| Page revisit/backtrack | Defined from ordered `ff_page_viewed` sequence, ignoring immediate duplicate events |

**Cohort caveat:** finalized-only conversion changes when pending attempts later finalize. Always label numerator, denominator, data refresh time and scope. For five-person tests, prefer “2 of 5 attempts did not finish” over “40% churn.” A selected click goal must be labeled **click outcome**, not signup or revenue conversion.

## 6.4 Optional funnel contract

Builder may configure 2–5 ordered milestones via discovered route/element/custom event. Render validates each milestone against project, calculates a monotonic per-attempt first-reached timestamp and makes funnel table for that study. **Without milestones, show actual paths and goal completion; do not invent steps or label every page a required funnel stage.** Separate visited/seen from clicked/acted.

---

# 7. PostHog Cloud specification

## 7.1 Connection and scope

One PostHog Cloud project for initial First Five MVP, with per-event property filters `ff_project_id`, `ff_study_id`, `ff_session_id`, `ff_mode` and pseudonymous participant identity. **No individual customer gets the PostHog API key.** PostHog ingestion project token and instance host are Render secrets/config; authenticated analytics API key stays server-side. PostHog API host may be US/EU; configure exact host from workspace, not guessed.

## 7.2 Schema mapping (critical)

First Five canonical event is not directly the PostHog capture format. Render maps:

```json
{
  "event": "ff_element_clicked",
  "distinct_id": "pseudonymous_study_participant_17",
  "timestamp": "2026-10-24T09:00:00Z",
  "properties": {
    "ff_event_id": "uuid-event-01",
    "ff_project_id": "ffp_123",
    "ff_study_id": "ffs_456",
    "ff_session_id": "ffx_789",
    "ff_mode": "live",
    "ff_client_sequence": 17,
    "ff_page_path": "/signup",
    "ff_element_key": "create_account"
  }
}
```

The PostHog project token is supplied using the official library or accepted capture endpoint format; exact field/wrapper depends on the SDK/API version. Use a supported server library where possible. Event names and identifier properties must be standardized, consistent and tested by reading back a real event. Never overwrite PostHog's own `$session_id` with `ff_session_id`.

## 7.3 PostHog reads

Render analytics service uses authenticated, bounded **HogQL/Query API** calls or PostHog insights endpoints with strict study and project filters. Queries supply page/action timelines, distinct sessions clicking elements, alternative paths, error event counts, and configured funnels where useful. Query by explicit study ID, time window and size cap; cache recent responses; paginate only when required. Never load “all PostHog events” from all projects into the agent or a customer browser. If API is delayed or fails, show authoritative completion counts from Postgres and mark detailed analysis `processing`/`temporarily unavailable`.

## 7.4 Data quality

Track event-delivery lag, ingestion rejections, duplicates, session IDs missing, filtered events and successful reads. An insight must not claim “no errors” simply because `ff_client_error` instrumentation is unavailable. Route and label sanitization is mandatory; PostHog's default autocapture/replay should stay **off** in MVP unless separately consented and configured to avoid duplicate or excessive recording.

---

# 8. Render/Postgres operational database

## 8.1 Required tables and key fields

| Table | Critical fields and constraints |
|---|---|
| `users` | UUID PK, email unique, password/auth reference, created timestamp |
| `projects` | UUID PK, owner FK, name, canonical origin, public SDK ID unique, integration status, SDK version |
| `project_domains` | project FK, verified allowed origin, verification timestamp |
| `discovered_elements` | project FK, normalized route, element key, safe label/type, first/last seen; unique(project,route,element key) |
| `studies` | project FK, task text, start rule, goal JSON, optional ordered milestones JSON, deadline, attempt/participant cap, status, version |
| `participant_invites` | study FK, invite token hash, participant pseudonym, max eligible attempts, expiry, issued timestamp |
| `study_sessions` | study/invite FK, status, started/deadline/goal/finalized times, final reason, repeat flag, consent evidence, data quality flag |
| `critical_event_receipts` | event UUID unique, session FK, event type/time, received time, verified flag |
| `event_outbox` | UUID, sanitized PostHog payload, delivery state, retries, last error, retention/deletion time |
| `feedback_responses` | session FK, question ID/type/text, answer/choice, displayed time, submitted time, response status |
| `analysis_jobs` | study/session FK, data snapshot/version, agent run ref, queued/running/failed/succeeded, error |
| `reports` | study FK, metrics snapshot JSON, individual/aggregate findings JSON, evidence refs, status, generation time, version, approver ID |
| `approval_actions` | report FK, agenticorg run/approval ID, reviewer, decision, action, status, timestamps; unique external action ID |
| `payment_orders` | user FK, plan, amount/currency, environment UAT/live, merchant reference unique, provider ID, verified status |
| `access_grants` | user FK, entitlement, source free/promo/payment, expiry, associated verified order optional |
| `promo_codes` and `redemptions` | code hash, max uses, expiry, creator, user redemption unique, audit trail |
| `audit_logs` | actor, action, resource ID, timestamp, before/after safe metadata |

**Indexes:** events/outcomes on `(study_id,status)`, `(study_id,started_at)`, uniqueness on event UUID and token hashes, approvals on `(report_id,status)`, outbox on `(delivery_status,next_retry_at)`. Foreign keys and ownership checks on all project descendants. No raw passwords or API secrets in these tables.

## 8.2 Authentication, tenancy and privacy

Use established password hashing or hosted auth, secure cookie or token sessions, CSRF protection where relevant, strict authorization at every owner/report endpoint. Never return a project by user-provided ID without verifying ownership. Do not store sensitive participant names by default. `participant_key` is study-scoped pseudonymous. PostHog/AgenticOrg may retain copied evidence: deletion requests and retention policy must cover each system. Allow withdrawal and removal of unnecessary test data; do not claim completed deletion before provider confirmation. Require HTTPS, CSP guidance, configured CORS allowlists, per-project ingest throttles and audit logs.

## 8.3 Hosting durability

Render free web instances can sleep after inactivity and have ephemeral local files. **Do not store project data in local SQLite, JSON files or server memory.** Render Postgres stores durable state. For live demonstration, warm/verify the actual deployment; free Postgres has lifecycle limitations and is not production archival. Use migrations, backups appropriate to plan, logs and health check `/healthz` (dependencies distinguished from app process health). A background worker/cron may require additional Render service configuration; do not silently rely on `setInterval` surviving free-instance sleep.

---

# 9. AgenticOrg UX Director: real agent and execution contract

## 9.1 Scope and reasoning boundary

**Agent persona:** “First Five UX Director.” Its job is to work as an AI research teammate, not simply return generic copy. **Inputs:** study objective, chosen start and goal, verified metric snapshot, bounded ordered session evidence, feedback and evidence references. **Outputs:** one contextual question when possible; individual session observations; combined research themes; prioritized, testable recommendations. **Hard constraint:** it must not invent participants, quotations, numerical counts, causes, agent tool executions or approvals.

## 9.2 Minimal actual AgenticOrg workflow (P0)

> **Amendment (2026-11-03, pending product-owner sign-off):** the UX Director no longer runs on AgenticOrg. It's an in-house, code-ordered pipeline in the First Five app (evidence → map per attempt → reduce → verify → rubric score → ready), using Claude models through the Anthropic API. The human-in-the-loop *approval* step is replaced by automated rubric scoring: findings and recommendations below the confidence bar are dropped. The owner's one-click **Publish** remains the human decision before anything is public. AgenticOrg-produced reports are read-only legacy. See `docs/integrations/UX_DIRECTOR.md`.

```text
REQUEST (Render creates job with scoped study/run ID)
   → VALIDATE evidence + permission
   → AGENT: examine facts, quotes, anomalies, counterexamples
   → STRUCTURED DRAFT report
   → HUMAN-IN-LOOP: authorized person approves/rejects sending/publishing
   → CONDITION: approved only?
      ├─ NO → draft remains private, log rejection
      └─ YES → configured authenticated tool calls Render publish endpoint
   → AUDIT: run ID, approval decision, tool response, final status
```

**Actual platform wiring is a deployment gate.** Configure one stored agent and one versioned workflow in the hackathon AgenticOrg workspace. Check what trigger/API/MCP/connector can invoke it; do not invent AgenticOrg HTTP routes. Use platform's official workflow run identifier, permissions and the platform's **actual** human-in-loop stage. A custom “Approve” frontend button without a corresponding enforceable AgenticOrg approval does **not** satisfy this requirement. If the reviewer is the builder, they must be authorized in the AgenticOrg approval system or be paired with an authorized platform reviewer; don't impersonate a human by server credentials.

## 9.3 Proposed First Five backend tools for AgenticOrg

| Tool interface to implement on Render | Allowed purpose / safeguard |
|---|---|
| `get_study_definition(studyId)` | Scoped read of task, goal, milestones, version |
| `get_study_metrics(studyId,snapshot)` | Verified counts and definitions only |
| `get_session_timeline(sessionId)` | Bounded sanitized events for authorized study |
| `get_session_feedback(sessionId)` | Actual submitted answers only |
| `save_individual_analysis(sessionId,draft)` | Validate evidence IDs before storing |
| `save_report_draft(studyId,draft)` | JSON schema validation, no publication |
| `request_review(reportId)` | Genuine platform HITL stage, reviewer assigned |
| `publish_approved_report(reportId,approvalRef)` | Check platform-authorized approval + matching report/version, then publish idempotently |

These names are **First Five's proposed tool interfaces**, not guaranteed built-in AgenticOrg connector names. Use least-privilege scoped credentials; no PostHog personal API key or payment secret in prompts. Verify an external tool call completed by inspecting its actual result and server audit log — approval alone does not prove publishing happened.

## 9.4 Contextual questions

Question generator receives a sanitized *single session summary*. It must choose one meaningful observed detail, ask neutrally, avoid leading “why did you do the wrong thing,” and emit one `question` with evidence reference. If observations are insufficient, use a general question. **Fast fallback:** fixed Q1 and Q3 are already displayed, and fallback Q2 is shown after brief timeout. Qualitative capture cannot depend on the entire long research workflow completing first.

## 9.5 Research output contract

```json
{
  "study_id": "ffs_456",
  "snapshot_id": "snap_20261024_001",
  "individual_findings": [
    {
      "session_id": "ffx_789",
      "observed": ["Visited pricing twice before signup"],
      "reported": ["I wanted to see the price first"],
      "hypotheses": ["Pricing clarity may need improvement"],
      "evidence_event_ids": ["evt_21", "evt_34"],
      "feedback_response_ids": ["resp_18"],
      "limitations": ["Exploratory single-session evidence"]
    }
  ],
  "aggregate_findings": [
    {
      "issue": "Price information before registration",
      "affected_session_ids": ["ffx_789"],
      "affected_count_from_backend": 1,
      "evidence_strength": "limited",
      "counterexamples": [],
      "recommendation": "Test clear plan terms by the signup CTA",
      "success_measure": "Verified task completion and pricing detours"
    }
  ],
  "approval_status": "pending"
}
```

Render schema-validates generated data, checks that every evidence ID belongs to the scoped study and correct version, rejects unsupported counts and fabricated refs, records invalid runs for revision. Labels: **observed** / **reported** / **hypothesized**. Evidence strengths: `inconclusive`, `limited`, `supported`, with written rationale; not pseudo-statistical confidence percentages on a five-person sample. Include contradictions and time/data coverage limitations.

## 9.6 Job, approval and report states

`queued → running → draft_ready → approval_pending → approved → publishing → published`; alternate `revision_requested`, `rejected`, `failed`, `retrying`. Builder can view private draft; public/shareable final report must remain blocked until a real approval and successful publishing action. Store workflow version, run ID, report version, human reviewer, approval decision, tool execution result and timestamps.

---

# 10. Pine Labs hosted checkout and entitlements

**Use Pine Labs hosted checkout rather than collecting card details.** Render requests provider auth/server checkout using test or live configured endpoints; client ID/secret remain server-only. General flow: choose plan → create internal pending order with **unique idempotent merchant reference** → create provider checkout link → redirect → handle return or webhook → server fetches authoritative order status → record verified state → grant entitlement if qualified. Include signature/authenticity verification per chosen webhook integration and prevent replay.

**Internal payment states:** `created`, `checkout_ready`, `pending_verification`, `paid_verified`, `failed`, `cancelled`, `refunded`, `verification_error`; provider status mapping must follow live docs and preauthorization settings. Store explicit `environment = UAT|live`. Sandbox `processed` is **not** evidence of real revenue or one of five paying customers. A promo code gives a `source=promo` access grant and has its own audit count; it never creates paid payment records. Repeat callback must not duplicate access grants.

**Competition demonstration:** complete genuine UAT hosted checkout, show server-side verification and transaction log. Free route remains available. Do not withhold product access from free pilots behind a fake payment.

---

# 11. UX screens, interaction details and copy

| Screen | Main content / behavior | Empty/failure behavior |
|---|---|---|
| Landing | value, 5-step explainer, clear free/paid/promo CTAs | Genuine waitlist only for later features |
| Signup/login | secure account and plan access | validation and retry |
| Projects | list, project status, create project | “Connect your first website” |
| SDK install | project-specific snippet, copy, AI-code-assistant install prompt | setup troubleshooting |
| Verify & discovery | live last-seen event, detected pages/elements, SDK version | no events / wrong origin / CSP / expired setup |
| Study builder | select page, goal type, target, time limit, optional milestones | no fabricated choices |
| Study invitation | task, time, consent, start | expired / closed / full |
| Test widget | task reminder, “I'm stuck,” “Finish test,” current state | safe recovery to First Five |
| Interview | fixed question + contextual or fallback + open-ended | missing feedback clearly noted |
| Dashboard | counts, finalized conversion, timing, routes/funnel, agent status | processing / insufficient sample |
| Completed sessions | sortable list, timeline, repeated steps, feedback | “No completions yet” |
| Dropped sessions | paths, last reliable step, errors, feedback availability | “Reason unknown” |
| Insight detail | evidence refs, quotes, contradictions, recommendations | inconclusive badge rather than invented cause |
| Report review | full private draft, approve/reject/revise, actual AgenticOrg status | unauthorized approval denied |
| Checkout/status | hosted provider redirect, verified status | do not award benefits before verification |
| Admin proof | real builder/tester activity, real workflow and payment timestamps | never seed fake traction |

**Accessibility:** widget keyboard/assistive tech navigable, visible focus, responsive and not obscuring host CTAs; no conflicting CSS or intrusive interview during task. **Copy:** avoid “AI knows why users churn”; use “Understand where participants struggled and what they reported.”

---

# 12. API contracts: Render endpoints

All routes are **First Five application routes to create**, not provider endpoints. External provider requests originate in Render services with server-side credentials.

| Method + route | Request → response / controls |
|---|---|
| `POST /api/auth/signup` | secure registration; rate limited; creates user |
| `POST /api/auth/login`, `GET /api/auth/me` | authenticated identity and entitlements |
| `POST /api/projects`, `GET /api/projects/:id` | owned project and domain; 403 if wrong owner |
| `GET /sdk/v1/firstfive.js` | public immutable/versioned SDK build |
| `GET /api/sdk/config?project_id=` | limited public configuration; no secrets |
| `POST /api/sdk/setup/start` | auth owner → signed short-lived setup token |
| `POST /api/sdk/exchange` | one-time setup/live handoff → scoped session authorization |
| `POST /api/sdk/events` | signed batch → accepted/rejected IDs + delivery receipt |
| `GET /api/projects/:id/discovery` | authorized catalog: page, key, safe label, first/last seen |
| `POST /api/studies` | save study definition; validate ownership, goal and scope |
| `POST /api/studies/:id/launch` | set active and return invitation link |
| `POST /api/studies/:id/start` | consent and valid invite → participant attempt + launch token |
| `POST /api/sessions/:id/end` | session-signed request; atomic outcome + feedback handoff |
| `GET /api/sessions/:id/questions` | feedback-signed; fixed + contextual/fallback question |
| `POST /api/sessions/:id/feedback` | store answer(s) idempotently; consent/ownership checks |
| `GET /api/studies/:id/dashboard` | owner-only authoritative metrics, data freshness, report state |
| `GET /api/studies/:id/sessions` | owner-only filtered/paginated attempt list |
| `GET /api/sessions/:id/details` | owner-only timeline and feedback for study |
| `POST /api/studies/:id/analyze` | owner-only snapshot + dedup job + AgenticOrg trigger |
| `GET /api/reports/:id` | owner-only draft or authorized shared published report |
| `POST /api/reports/:id/review` | actual authorized review request/result; no fake approval |
| `POST /api/reports/:id/publish` | agent tool only, proof of authorized HITL + idempotency |
| `POST /api/payments/checkout`, `POST /api/payments/webhook` | order, provider verification, entitlement update |
| `POST /api/access/redeem` | authorized promo code redemption, audited |
| `GET /healthz` | uptime; `GET /readyz` optionally checks critical dependencies |

**HTTP errors:** 400 malformed, 401 no identity, 403 cross-project/role mismatch, 404 genuinely missing, 409 state conflict/duplicate in progress, 410 expired study/token, 413 oversized batch, 422 unsupported goal/event, 429 rate limit, 502 provider failure. No secrets or raw provider errors returned to participants.

### 12.1 Cross-domain launch contract (implementation detail)

First Five creates one-time `launch_ticket` with hash stored server-side, expires quickly and binds study/project/attempt/allowed origin. The customer site SDK extracts from the approved launch URL, makes `POST /api/sdk/exchange` with its `project_id` and launch ticket, receives an expiring **per-attempt credential**. After exchange, remove the ticket from browser URL. Never treat the public `project_id` as proof of a live session. On third-party navigation where SDK not installed, report instrumentation gap. If link fragment conflicts with SPA routing, switch to a tested query-based handoff with immediate removal and conservative referrer policy; do not promise universal compatibility.

### 12.2 Source-of-truth rule for goal evaluation

For page and click goals, Render checks accepted sanitized matching event against configured study version, authorized attempt and deadline; mark completed via atomic Postgres conditional update. Custom business goal signals require explicitly instrumented website logic and a documented trust level; a compromised customer frontend can forge events, so describe results as telemetry, not audited financial transactions. The demo uses controlled test websites with server-verifiable completion where possible.

---

# 13. End-to-end workflow contracts

## W1 — Acquisition and entitlement

Landing → real account → free pilot / Pine Labs paid checkout / legitimate promo → verified `access_grant` → project creation. Store acquisition source and meaningful core usage separately. A lead-only waitlist ends truthfully with no access claim.

## W2 — Setup and event discovery

Owned project → generate common script + project ID → installed on website → signed setup walkthrough → SDK detects pages and interactive elements → Render validates event batch → Postgres discovery updates + PostHog events → status `verified`. No setup record contributes to research or traction as a participant.

## W3 — Configure study and invite

Builder chooses intended task, goal, optional milestones and time limit → Render validates project/access → study active → invitation token(s) issued, participant count cap configured. Study goal version fixed once participants start (substantive changes require new study version).

## W4 — Consent and perform task

Participant opens invite → consents → Render creates attempt → cross-domain launch/exchange → SDK live tracking + test control → finish, validated goal or deadline → backend atomic status. Only consented/authorized task telemetry counts. If tracking health fails, flag outcome/data quality appropriately.

## W5 — Interview

Finalized task → safe summary → fixed Q1 immediately → UX Director optional personalized Q2 within bounded latency or fallback → Q3 → Postgres feedback rows linked to attempt. No claims about absent participants' reasons.

## W6 — Quantitative metrics

Render Postgres supplies outcome counts, timestamps and denominators → PostHog supplies paths, click/filter results and configured funnel details → analytics snapshot signed/versioned with event cutoff/data quality → dashboard shows last refresh, counts and study goal explicitly.

## W7 — UX Director research + approval

Owner requests report → Render gathers sanitized metric snapshot, bounded timelines and actual quotes → AgenticOrg real run → structured individual and combined findings → backend validates evidence refs → private draft → actual HITL approval/rejection → approved AgenticOrg tool calls publish action in Render → success logged and report available.

## W8 — Payment

Plus CTA → server creates pending order → Pine Labs hosted checkout → callback/webhook → server verifies latest provider state → entitlements update exactly once → test/live separated.

## W9 — Test websites and demo

Website A onboarding and Website B commerce use identical SDK bundle, different public IDs/study goals, isolated analytics. Recruit real testers; show at least one complete study, one real builder, connected agent/HITL, actual payment UAT, correct dashboard counts and time-stamped proof. If time runs out, **one fully connected real study is preferable to three polished fake demos**.

---

# 14. Test sites and acceptance scenarios

## 14.1 Demo app A — SaaS onboarding (P0)

Polished but compact application: landing → signup (use test/dummy details) → onboarding options → dashboard. Must have `data-firstfive-id` on primary actions, valid route navigation, form submit, and actual dashboard-reached success. Include a plausible friction hypothesis, **not** a deliberate broken button or deceptive participant prompt. First Five goal `page_reached:/dashboard` or trusted signup-complete custom event. Verify setup and live modes independently.

## 14.2 Demo app B — Small storefront (P1)

Product listing → product detail → add to cart → simulated checkout → order confirmation. Storefront has a different project ID/domain; the same SDK works unchanged. Goal `page_reached:/order/confirmed` or `order_completed` mock event; **no real card collection or real order billing**. Verifies multi-project isolation and different goal types.

## 14.3 P0 acceptance tests (objective pass/fail)

| ID | Scenario | Expected result |
|---|---|---|
| A01 | Two builders create projects | Unique public project IDs; owner isolation |
| A02 | Install script with valid ID | Connected status; setup walk events present |
| A03 | Wrong domain/public ID only | No authorized live event capture |
| A04 | Setup walk includes unclicked button | Button appears as *available*, not falsely marked clicked |
| A05 | SPA route change | New page view recorded without full reload |
| A06 | No participant consent | No behavioral study events and no counted attempt |
| A07 | Valid invite and token handoff | Events tied to exact study/attempt across domains |
| A08 | Reload while test active | Same attempt restored if credential valid |
| A09 | Click/page success goal reached | Exactly one completed terminal record and goal timestamp |
| A10 | “I'm stuck” before goal | Dropped with explicit-stop reason; interview offered |
| A11 | Tab closes and deadline passes | Dropped via server, feedback marked unavailable |
| A12 | Duplicate/out-of-order events | Idempotent event count; accurate final status |
| A13 | PostHog temporarily unavailable | Critical task counts survive in Postgres, details show delay |
| A14 | End-of-task interview | Fixed questions and contextual/fallback appear; response linked |
| A15 | No feedback submitted | Dashboard says “Reason unknown” |
| A16 | Five participants, two goals reached | Finalized count and rates match source sessions |
| A17 | Cross-project ID request | 403; no leaked events/reports |
| A18 | UX Director report | Findings cite actual allowed events/quotes; counts verified |
| A19 | HITL reject | Report not published; agent log records rejection |
| A20 | HITL approve | Actual authorized publication action occurs once |
| A21 | Pine Labs UAT checkout | Transaction verified; flagged UAT, not paid traction |
| A22 | Complimentary promo | Limited entitlement granted, no payment record fabricated |
| A23 | Real external builder uses flow | Timestamps show project, test and report action |
| A24 | Second website SDK | Same bundle, separate event/analytics scope |

## 14.4 Data reconciliation test

For each study, assert:

`valid_started = completed + dropped + pending`  
`finalized = completed + dropped`  
`eligible primary attempts <= total recorded attempts`  
`goal_verified implies completed unless auditable correction`  
`published report implies actual approved action and matching version`  
`paid access implies verified qualifying payment or explicit nonpayment grant`

Add quality flags for missing event coverage and don't label incomplete telemetry “zero friction.”

---

# 15. Operational constraints, rollout and ownership

## 15.1 Minimum functional build order

1. **Credentials gate in parallel:** create/check Render app, Postgres, PostHog project/token/region, AgenticOrg stored agent/workflow/HITL/connector and Pine Labs UAT credentials. Record blockers immediately.
2. **Core data contract:** migrations; account/project/study/session IDs; event JSON; ingestion auth; setup/live state rules.
3. **SDK + Demo A:** install snippet, setup discovery, real event visible in PostHog, correct goal classification in Postgres.
4. **Participant journey:** invite, consent, cross-domain handshake, task control, finish, interview with fixed fallback.
5. **Metrics and dashboard:** counts from Postgres, session drill-down from PostHog, no AI required for arithmetic.
6. **Real AgenticOrg:** structured report from real evidence; human approval gating an actual publish tool.
7. **Pine Labs hosted checkout:** UAT verified, free and promo access remain distinct.
8. **Traction and submission:** real builders/testers, truthful logs, two-minute video, required posts, judge demonstration. Demo B only after P0 works.

## 15.2 Team responsibility proposal (3–5 people)

- **SDK/data engineer:** SDK, setup/live, event transport, Demo A, PostHog integration.
- **Backend engineer:** Postgres schema, auth, study/session state, analytics, payments.
- **Frontend/product designer:** landing, customer flow, participant widget/interview, dashboard.
- **AI/integration owner:** actual AgenticOrg agent, structured tools, HITL, report validation.
- **GTM/demo lead:** real user recruitment, study task quality, proof/logs, submission/pitch; where only 3 people, combine roles.

## 15.3 Major risks and mitigation

| Risk | Why serious | Mitigation / evidence |
|---|---|---|
| AgenticOrg integrations not enabled | Agent may not actually execute | Test one real tool + HITL run before polish; log IDs |
| Cross-domain ticket not attached | Events cannot join participant | Early end-to-end test on live Render and Demo A |
| PostHog query lag/rate | Dashboard details missing | Postgres source-of-truth counts; cache and loading state |
| Render free sleep | Live demo delayed | Test actual service and understand plan/uptime limits |
| Participant never returns for interview | “Why” unavailable | SDK task control and safe feedback redirect; disclose missing |
| SDK captures PII | High safety/privacy risk | Allowlist only; no form values; consent and data deletion |
| Metric confusion | Misleading “conversion” claims | Fixed formulas, goal labels, denominators, reconciliation |
| Too many demo websites | No time to finish core | One excellent website P0; second P1 |
| Sandbox transaction counted as money | False traction claim | Explicit UAT/live flag and separate counts |
| Agent reports plausible but unsupported causes | Low research credibility | Evidence IDs, quote fidelity, counterexamples, validation |

## 15.4 Deployment and environment checklist

- Render public HTTPS frontend/API URL and non-sleep assumptions documented.
- `DATABASE_URL`, PostHog ingest token and regional hosts, PostHog private query credential, AgenticOrg auth/workflow identifiers, Pine Labs credentials/UAT host, session-signing secrets stored as Render environment secrets.
- Migration script is repeatable, with unique constraints and safe seed data in **development-only** mode.
- Allowed origins, CSP and CORS verified on both sample websites.
- No hardcoded credentials or sensitive contents committed to GitHub.
- Server logs retain request ID, project/study/attempt IDs, agent run ID and provider reference but redact private data.
- Failure state and recovery link visible, especially in interview and payment flows.
- Metrics include data freshness, excludes setup and test accounts, and preserve evidence provenance.

## 15.5 Definition of Done — hackathon MVP

First Five is demonstrated when **one external builder** can register, create a project, install a reusable SDK on Demo A or their own compatible website, verify the installation, select a real task goal, invite actual consenting participants, receive behavioral events and at least one real post-task response, view reconciled completed/dropped/pending results and session details, and receive an evidence-linked UX Director report that is **actually approved and published through AgenticOrg's authorized HITL flow**. Pine Labs hosted checkout must separately work in allowed test mode. Real user, agent and payment evidence must be timestamped and honest. 

**Non-goals for today's sign-off:** cross-platform native apps, universal third-party-site tracking, unconsented session recording, voice calls, heatmaps, automatic code fixes, advanced statistical confidence, user recruitment marketplace and full subscription billing.

---

# 16. Implementation assumptions and decisions requiring live verification

**Locked product decisions:** web-only; one shared SDK; project-specific snippet; integration walkthrough; builder-defined specific goal; participant consent; cross-domain handoff; task control; deterministic status; mandatory opportunity for post-task questions; PostHog behavior; Postgres operations; AgenticOrg UX Director plus actual human approval; Pine Labs hosted checkout; pilot access for judges; Demo A P0 / Demo B P1.

**Integration checks not established by this document:** exact AgenticOrg trigger/tool connector in assigned workspace; who is authorized to approve; Pine Labs merchant UAT credentials and configured callbacks; Render plan/worker availability; PostHog cloud region/project query access; actual customer-site SPA/router compatibility. These are configuration prerequisites, not reasons to replace integrations with fake UI. If a P0 external service cannot execute, report the real limitation and demonstrate only what truly works.

**Research ethics/validity:** do not promise that a sample of five proves population-level churn, that one late click caused abandonment, or that a recorded quote from one user explains all users. Every finding should lead to a **testable hypothesis**, with evidence links and a way to retest after a builder changes the design.

---

# Appendix A — Suggested implementation folder layout

```text
first-five/
  apps/web/                       # Render-hosted UI pages
  apps/api/                       # Render API / service layer
    auth/ projects/ studies/ sessions/ events/
    discovery/ feedback/ analytics/ reports/
    agenticorg/ payments/ access/
  packages/sdk/                   # One browser script, versioned
  packages/contracts/             # shared JSON Schema / types
  db/migrations/                  # Postgres tables, indexes, constraints
  demo/saas-onboarding/           # P0 instrumented app
  demo/storefront/                # P1 instrumented app
  tests/e2e/                      # acceptance cases
  docs/                           # setup instructions, diagrams
```

# Appendix B — Key reference documentation (verification basis)

1. **PostHog API overview:** https://posthog.com/docs/api — event capture versus private query access and region-aware hosts.
2. **PostHog SQL / Query API:** https://posthog.com/docs/sql — HogQL endpoint and query contract.
3. **PostHog Node.js library:** https://posthog.com/docs/libraries/node — `distinctId`, event and properties mapping.
4. **Render free plan:** https://render.com/docs/free — sleep and ephemeral filesystem limitations.
5. **Render background workers:** https://render.com/docs/background-workers — durable off-request work and queues.
6. **Render Postgres/web services:** https://render.com/docs/web-services and https://render.com/docs/postgresql.
7. **AgenticOrg workflows:** https://agenticorg.ai/docs/workflows — actual workflow types and configuration cautions.
8. **AgenticOrg approvals:** https://agenticorg.ai/docs/approvals — human review and proof of completed actions.
9. **Pine Labs hosted checkout:** https://www.pinelabs.com/docs/online-payments/hosted-checkout/integration-steps — server-side checkout and verification.
10. **Pine Labs API reference:** https://www.pinelabs.com/docs/online-payments/api — UAT/live APIs and order statuses.
11. **Competition brief:** the five photographed AI Builders Day handout pages shared in this conversation; where booklet instructions conflict with speculative web descriptions, the booklet governs.

