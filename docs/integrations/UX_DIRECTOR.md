# UX Director (First Five)

The UX Director writes each participant's contextual interview question (Q2) and turns finished attempts into a research report. It runs inside the First Five app using Claude models through the Anthropic API, or Gemini models through the Gemini API as an alternative. There's no external agent platform and no human review step. Every finding and recommendation gets a rubric score; anything below the confidence bar is left out. The project owner publishes the report with one click.

It replaced the AgenticOrg integration. Reports produced by AgenticOrg are kept read-only and can't be published.

## 1. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `UX_DIRECTOR_PROVIDER` | `anthropic` | `anthropic` or `gemini` |
| `ANTHROPIC_API_KEY` | — (secret) | Enables the UX Director when the provider is `anthropic`. When the selected provider's key is unset, interviews use the standard Q2 and **Run analysis** returns 503. |
| `GEMINI_API_KEY` | — (secret) | The same, when the provider is `gemini` |
| `UX_DIRECTOR_MODEL_Q2` | provider default | Model for the contextual question. Defaults: `claude-sonnet-5-5` / `gemini-3.8-flash` |
| `UX_DIRECTOR_MODEL_MAP` | provider default | Model for per-attempt analysis |
| `UX_DIRECTOR_MODEL_REDUCE` | provider default | Model for the cross-attempt synthesis |
| `UX_DIRECTOR_MODEL_SCORE` | provider default | Model for the rubric judgments. Defaults: `claude-sonnet-5-5` / `gemini-3.1-pro-preview` |
| `UX_DIRECTOR_Q2_TIMEOUT_MS` | `8000` | How long the interview waits for Q2 before showing the fallback question |
| `UX_DIRECTOR_RUN_BUDGET_MS` | `600000` | An analysis that hasn't finished in this time fails with a "run it again" message |
| `UX_DIRECTOR_FINDING_THRESHOLD` | `60` | Findings scoring below this (0–100) are dropped, together with their recommendation |
| `UX_DIRECTOR_RECOMMENDATION_THRESHOLD` | `60` | Recommendations scoring below this are dropped; the finding stays |

To set it up on Render: add `ANTHROPIC_API_KEY` under **Environment**, deploy, then open **/app/admin → Integrations → UX Director (First Five) → Run verification**. Verification makes one Q2-shaped call on synthetic data. It shows **Verified** along with the model used and an `agent_runs` id.

**Gemini.** `ux-director/gemini-model.ts` implements the same model contract as the Claude client:
- JSON Schema output generated from the same zod schemas, then re-validated locally;
- effort mapped to the thinking level;
- retries on 429, 5xx and network errors;
- blocked or safety finish reasons treated as refusals.

Two differences matter:
- Gemini has no server-side refusal fallback.
- Its implicit prompt cache only engages above a larger minimum prefix, so the five-attempt studies show no cache reads. Claude Sonnet 5.5 does cache the same prefix (about 1.5k tokens) from the second map call on.

Usage is normalised to the Anthropic meaning: input excludes cache reads, and output includes thinking tokens.

**Other Claude models.** Sonnet 5.5 is the Claude default for every step. Any step can move to `claude-opus-5-5` (for example `UX_DIRECTOR_MODEL_SCORE`, for a stronger judge) or `claude-haiku-5-5` (map and Q2 are the usual candidates) through its env var, with no code change. Measure first: the Admin card shows the last 7 days of token usage, and `scripts/eval/ux-director/` compares setups on planted-issue studies.

## 2. How an analysis runs

```
Run analysis ──▶ evidence ──▶ map × N attempts ──▶ reduce ──▶ verify ──▶ score ──▶ finalize ──▶ ready ──▶ (owner) Publish
                 stored once   per attempt,         aggregate  deterministic rubric    one          scored,
                 with digest   concurrency 3        findings   checks      per item    transaction  no review
```

- **Durable steps.** Each step is a row in `analysis_steps` with a status, lease, output, model, token usage and attempt count. A restart or free-plan sleep loses no finished work. The maintenance sweep, or simply opening the report page, resumes the run from the first unfinished step.
- **evidence.** This is the sanitized package from `services/evidence.ts`: pseudonymous IDs, routes, safe element labels, named custom events with filtered properties (see §5) and the participants' answers.
- **map.** One call per attempt. Its output is validated against that attempt's own events and answers before the step is marked done. The first call runs alone so it writes the prompt cache for the study prefix; the rest read from it.
- **reduce.** Groups the per-attempt findings into aggregate findings. Each one carries an expectation gap, a recommendation, a retest measure and a coding-assistant prompt. Reduce never sees raw events.
- **verify.** Runs `validateResearchOutput` (`services/research-output.ts`), which hard-fails on:
  - unknown session, event or response IDs;
  - counts that disagree with the backend;
  - quotes that aren't verbatim;
  - percentages in findings;
  - a session listed as both supporting and contradicting a finding.

  On failure, reduce runs once more with the errors appended. A second failure fails the run, and the reasons are stored. Counts or percentages in the *advice* text (recommendation, retest measure, prompt) aren't a verify failure. They're passed to scoring, which zeroes "stays in evidence" for that recommendation.
- **score.** See §3.
- **finalize.** In one transaction, this step:
  - writes the kept findings with their scores;
  - stores the validated output and every score and drop in `reports.agentOutput`;
  - records `sessionsIncluded` and the drop counts;
  - sets the report to `ready`.

## 3. Rubric scoring

Each model-judged criterion is rated 1–5 with a one-line rationale and mapped to 0, 25, 50, 75 or 100. The overall score is the weighted mean, from 0 to 100.

**Finding**

| Criterion | Weight | Source |
|---|---|---|
| Evidence support: the cited events and answers directly show the claim | 35% | Model, which sees only the claim and its cited evidence |
| Coverage: share of included attempts supporting it | 20% | System: supporting attempts ÷ included attempts |
| Statement alignment: participants' own words point the same way | 20% | Model; 0 when no answer is cited |
| Counterexamples handled | 10% | Model; 100 when every included attempt supports the finding |
| Specificity: names the route, element or step | 15% | Model |

**Recommendation** (judged only for kept findings)

| Criterion | Weight | Source |
|---|---|---|
| Grounded in the finding's evidence | 35% | Model |
| Actionable: a concrete change to a named route or element | 25% | Model |
| Testable with what First Five measures | 25% | Model; 0 when there's no retest measure |
| Stays in evidence: no invented claims or numbers | 15% | Model; 0 when verify flagged numbers in the advice text |

The **drop rule**:
- A finding below `UX_DIRECTOR_FINDING_THRESHOLD` is dropped together with its recommendation.
- A recommendation below `UX_DIRECTOR_RECOMMENDATION_THRESHOLD` drops only the recommendation, retest measure and prompt.

The scorer judges each item in isolation. It never sees the other findings or the synthesis reasoning, and it can only drop items, never add or edit text. `evidence_strength` stays as a descriptive label and isn't used for gating.

## 4. Bounds and cost

- At most 25 attempts per analysis and 100 events per attempt. Studies with more than 25 finished attempts always show as out of date by the excess.
- Map and score calls run 3 at a time. The SDK retries 429, 5xx and connection errors twice with backoff, and a step is attempted at most 3 times.
- Per-step `max_tokens`: Q2 4k, map 8k, reduce 32k, each judgment 4k. Effort: Q2 `low`, map `medium`, reduce `high`, score `medium`. The request sets effort only; thinking follows each model's default. Sonnet 5.5 accepts all three effort levels.
- Server-side refusal fallbacks (`fallbacks: "default"`) are on for Sonnet and Opus. Sonnet 5.5 accepts the parameter (verified live 2026-11-04); no refusal has occurred in our runs, so the fallback path itself hasn't been exercised. Haiku has none and rejects the parameter. A refusal that survives them, or any refusal on Haiku, fails the step with its category.
- One running analysis per study. Repeating the request returns the same processing report.
- Token usage is stored per step, summed on the run (`agent_runs.details.usage`) and totalled on the Admin card.

## 5. Privacy

- Only pseudonymous attempt IDs (`ffx_…`) are sent. Invite labels, emails and form values never leave the app.
- Custom events send their name plus at most 10 properties. A property is sent only if it's a number, a boolean or a string of 40 characters or fewer, and its key doesn't match `text|label|email|name|phone|value|query|search`. Signals such as `cta`, `depth` and `dwell_ms` survive. Free text such as `text_select.text` and `rage_click.text` is dropped.
- Participants' typed answers are sent, because the analysis quotes them. This needs to be stated on the privacy page.
- Page and element labels and answers are passed as data inside `<evidence>` tags, and the prompts tell the model to treat them only as data. Output is schema-constrained, and verify rejects any ID that isn't in the evidence.

## 6. Publishing

- `ready` reports are visible only to the owner. They show each finding's confidence score, each recommendation's score and a summary of what was left out ("N findings and M recommendations didn't meet the confidence bar").
- **Publish** needs three things: the report is `ready`, it belongs to you, and at least one finding was kept. Publishing creates one share link and one audit entry. Publishing again returns the same link, and **Unpublish** returns the report to `ready`.
- The public page shows only kept findings and recommendations. It never shows score rationales, run data or internal IDs.
- When newer attempts finish, the report shows "Out of date by N attempts · Run analysis again".
- Review, request-review and reopen return `409 no_review_step` for UX Director reports. Owner-written reports keep their own review flow.

## 7. Troubleshooting

| Symptom | Where to look |
|---|---|
| Admin card says **Not configured** | `ANTHROPIC_API_KEY` is missing on the service |
| Verification fails with `401 invalid x-api-key` | The key is wrong or revoked; create a new one in the Claude Console |
| Report stuck on **Processing** | Open the report page, which resumes the run. Then check `analysis_steps` for the run (`reports.agentRunId`): the first non-`done` step shows its `error` and `attempts` |
| Report **Failed** | `reports.failureReason` holds the message. The failed step's `error` has the full text: validation reasons, refusal category or the budget message |
| Everything was dropped | Read the scores and rationales in `reports.agentOutput.scoring.findings[].criteria`, then tune the thresholds (env) and run the analysis again |
| Q2 always shows the fallback | Look at `agent_runs` rows with `kind = 'contextual_question'`: `error` and `details.latencyMs`. Raise `UX_DIRECTOR_Q2_TIMEOUT_MS` or move `UX_DIRECTOR_MODEL_Q2` to Haiku 5.5 |

```sql
-- Steps of the latest run for a report
SELECT kind, "attemptKey", status, attempts, model, usage, error, "finishedAt"
FROM analysis_steps WHERE "reportId" = '<report id>' ORDER BY position;
```

## 8. Local checks

`scripts/ux-director-local.ts` boots a throwaway PostgreSQL and the real app. It drives the real API with synthetic Wanderloom-style participants.

```bash
npx tsx scripts/ux-director-local.ts evidence          # evidence package and custom-event filtering; no model calls
npx tsx scripts/ux-director-local.ts stub              # full pipeline with a deterministic stub model: steps, scores, drops, publish, stale signal
npx tsx scripts/ux-director-local.ts stub-verify-fail  # invented event → one corrective reduce → failed run with reasons
npx tsx scripts/ux-director-local.ts stub-thresholds   # threshold 100 for recommendations, then for findings
npx tsx scripts/ux-director-local.ts stub-policies     # Q2 fallback and reopen, owner review flow, legacy report refusal
npx tsx scripts/ux-director-local.ts stub-resume-crash && npx tsx scripts/ux-director-local.ts stub-resume   # restart mid-run
```

Stub modes make no API calls. The live modes call the configured provider and cost a few cents:

```bash
npx tsx scripts/ux-director-local.ts live            # live Q2 ×5 → analysis → scores → publish/unpublish → sixth attempt (stale) → re-run → admin verification
npx tsx scripts/ux-director-local.ts live-injection  # an element label carrying instructions still yields a neutral Q2
```

Reference run (Gemini `gemini-3.8-flash`, 5 attempts, 2026-11-03):
- Q2 took 2.3–5.5 s.
- The analysis took 3–5 minutes, with about 21k input and 38k output tokens.
- Reduce dominates, at up to 15k output tokens; its cap was raised from 16k to 32k as a result.
- Verify sent reduce back once, and the correction passed.
- 2 findings were kept (79–92), and none were dropped.

Reference run (Claude `claude-sonnet-5-5` for every step, the default, 5 attempts, 2026-11-04):
- Q2 took 1.6–5.2 s (5 calls), inside the 8 s wait; Admin verification took 2.1 s.
- The analysis took 68 s with no corrective reduce: about 16k input, 8.6k output, 5.8k cache-read and 8.3k cache-write tokens, about $0.14 per report.
- Map calls 2–5 each read 1,462 cached tokens (system prompt plus study prefix), so the real prefix is above Sonnet's cache minimum.
- Reduce took 29 s and scoring 20 s (3 judgments at a time).
- 2 findings were kept (80 and 73) with recommendations at 90; none were dropped. The re-run after a sixth attempt also kept 2.

Q2 wait on Sonnet (2026-11-04): 12 Sonnet Q2-shaped calls (5 live Q2s, Admin verification, 6 probes) took p50 ≈ 1.9 s, p90 ≈ 3.6 s, max 5.2 s, all inside the 8 s `UX_DIRECTOR_Q2_TIMEOUT_MS`. The wait stays at 8 s and Q2 stays on Sonnet. The eval runner now records Q2 latency per attempt (`q2LatencyMs` in `results.jsonl`) for later re-checks.

MVP configuration (2026-11-05): all-Sonnet (`claude-sonnet-5-5` for every step, the code default), measured on `scripts/eval/ux-director` over 16 planted-issue studies × 2 reps:

| Metric | Result |
|---|---|
| Runs ready | 32/32 |
| Strict recall | 92% |
| Recommendation fit | 97% |
| False findings | 4 |
| Must-not violations | 1 |
| Cost | about $0.12 per report |

Known issue: on a clean study, or with a harmless decoy detour, the reduce step can still write a finding and the scorer keeps it (scores don't separate real from false findings; AUROC 0.52). Setting `UX_DIRECTOR_MODEL_SCORE=claude-opus-5-5` drops the clean-study false findings for about $0.03 more per report. The prompt and rubric fix is tracked separately.

Haiku comparison (2026-11-05, same eval): all-Haiku costs about $0.008 per report and ran 32/32. Strict recall was 86% against Sonnet's 92%, which is no detectable difference on 36 paired issue-runs (McNemar p = 0.5). Reports are noisier: 1.7 kept findings per report against 1.3, 11 single-attempt splits of one issue against 2, and 2 must-not violations against 1. Sonnet stays the default. `UX_DIRECTOR_MODEL_MAP=claude-haiku-5-5` and `UX_DIRECTOR_MODEL_Q2=claude-haiku-5-5` remain the cheap-mode option to benchmark next.
