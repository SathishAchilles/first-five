/**
 * In-house UX Director analysis as a durable, code-ordered pipeline:
 *
 *   evidence → map (one per attempt) → reduce → verify → score → finalize
 *
 * Every step is a row in analysis_steps. A step is claimed atomically with a
 * lease, runs, stores its output, model and token usage, and is marked done.
 * The in-process runner drives a run to the end; the maintenance sweep (and
 * opening the report) resumes runs whose lease expired after a restart or sleep,
 * and fails runs past UX_DIRECTOR_RUN_BUDGET_MS. Models only reason inside a
 * step; the order, validation, counts and the drop rule are code.
 */
import type { AnalysisStep, Prisma } from "@prisma/client";
import type { AppContext } from "../context";
import type { ModelCaller } from "../integrations/ux-director";
import { audit } from "../lib/audit";
import { sha256 } from "../lib/crypto";
import { addUsage, emptyUsage, ModelCallError, type CallUsage } from "../ux-director/model";
import {
  FINDING_SCORER_SYSTEM,
  MAP_SYSTEM,
  RECOMMENDATION_SCORER_SYSTEM,
  REDUCE_SYSTEM,
  mapInput,
  reduceInput,
  studyPrefix,
} from "../ux-director/prompts";
import {
  FindingJudgmentSchema,
  MapOutputSchema,
  RecommendationJudgmentSchema,
  ReduceOutputSchema,
  type FindingJudgment,
  type RecommendationJudgment,
  type ReduceOutput,
} from "../ux-director/schemas";
import type { EvidencePackage, EvidenceSession } from "../ux-director/types";
import { scopeFromPackage, type BuiltEvidence } from "./evidence";
import { validateResearchOutput, type ResearchOutput } from "./research-output";

const LEASE_MS = 5 * 60_000;
const MAX_STEP_ATTEMPTS = 3;
const CONCURRENCY = 3;
const TAIL_STEPS = ["reduce", "verify", "score", "finalize"] as const;

/** Runs this process is currently driving (a second kick is a no-op). */
const driving = new Set<string>();

export class StepError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly usage: CallUsage = emptyUsage(),
  ) {
    super(message);
    this.name = "StepError";
  }
}

interface EvidenceOutput {
  pkg: EvidencePackage;
  sessionIdByPublicId: Record<string, string>;
}

type IndividualFinding = ResearchOutput["individual_findings"][number];
type MapStepOutput = IndividualFinding & { deviation_tags: string[] };

interface VerifyOutput {
  validated?: ResearchOutput;
  inventedNumbers?: number[];
  /** Set while a corrective reduce is pending. */
  retry?: number;
  errors?: string[];
}

interface Criterion {
  score: number;
  weight: number;
  source: "model" | "system";
  rationale: string;
}

export interface ScoredItem {
  index: number;
  issue: string;
  score: number;
  kept: boolean;
  criteria: Record<string, Criterion>;
  recommendation: { score: number; kept: boolean; criteria: Record<string, Criterion> } | null;
}

interface ScoreOutput {
  thresholds: { finding: number; recommendation: number };
  includedAttempts: number;
  findings: ScoredItem[];
}

interface StepResult {
  output: unknown;
  model?: string;
  usage?: CallUsage;
  /** Leave the step pending instead of done (verify asking for a corrective reduce). */
  pending?: boolean;
}

// ─── Run lifecycle ──────────────────────────────────────────────────────────

/** Inserts the run's steps; the evidence step is stored done with its digest. */
export async function createAnalysisRun(ctx: AppContext, args: { reportId: string; runId: string; built: BuiltEvidence }) {
  const { reportId, runId, built } = args;
  const now = new Date();
  const evidence: EvidenceOutput = { pkg: built.pkg, sessionIdByPublicId: Object.fromEntries(built.sessionIdByPublicId) };
  await ctx.db.analysisStep.createMany({
    data: [
      {
        runId,
        reportId,
        kind: "evidence",
        position: 0,
        status: "done",
        inputDigest: sha256(JSON.stringify(built.pkg)),
        output: evidence as unknown as Prisma.InputJsonValue,
        attempts: 1,
        startedAt: now,
        finishedAt: now,
      },
      ...built.pkg.sessions.map((s, i) => ({ runId, reportId, kind: "map", attemptKey: s.session_id, position: i + 1 })),
      ...TAIL_STEPS.map((kind, i) => ({ runId, reportId, kind, position: 1000 + i })),
    ],
  });
}

/** Starts driving a run in the background unless this process already is. */
export function kickRun(ctx: AppContext, runId: string) {
  if (driving.has(runId)) return;
  driving.add(runId);
  void driveRun(ctx, runId)
    .catch((err) => ctx.log.error({ err: (err as Error).message, runId }, "analysis run crashed"))
    .finally(() => driving.delete(runId));
}

export async function failRun(ctx: AppContext, runId: string, error: string) {
  const message = error.slice(0, 2000);
  const run = await ctx.db.agentRun.findUnique({ where: { id: runId }, include: { reports: { select: { id: true } } } });
  if (!run) return;
  const usage = await runUsage(ctx, runId);
  await ctx.db.agentRun.updateMany({
    where: { id: runId, status: "running" },
    data: { status: "failed", error: message, finishedAt: new Date(), details: { usage } as unknown as Prisma.InputJsonValue },
  });
  for (const r of run.reports) {
    await ctx.db.report.updateMany({ where: { id: r.id, status: "processing" }, data: { status: "failed", failureReason: message.slice(0, 500) } });
  }
}

async function runUsage(ctx: AppContext, runId: string): Promise<CallUsage> {
  const steps = await ctx.db.analysisStep.findMany({ where: { runId }, select: { usage: true } });
  return steps.reduce((sum, s) => (s.usage ? addUsage(sum, s.usage as unknown as CallUsage) : sum), emptyUsage());
}

async function driveRun(ctx: AppContext, runId: string) {
  // Each iteration completes at least one step; the bound only guards against a logic error.
  for (let i = 0; i < 200; i++) {
    const run = await ctx.db.agentRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "running") return;
    if (Date.now() - run.startedAt.getTime() > ctx.config.UX_DIRECTOR_RUN_BUDGET_MS) {
      await failRun(ctx, runId, budgetMessage(ctx));
      return;
    }
    const steps = await ctx.db.analysisStep.findMany({ where: { runId }, orderBy: { position: "asc" } });
    const failed = steps.find((s) => s.status === "failed");
    if (failed) {
      await failRun(ctx, runId, `The ${failed.kind} step failed: ${failed.error ?? "unknown error"}`);
      return;
    }
    const open = steps.filter((s) => s.status !== "done");
    if (open.length === 0) return;

    const maps = open.filter((s) => s.kind === "map");
    let batch: AnalysisStep[];
    if (maps.length) {
      // The first map call writes the prompt cache for the study prefix; the rest read it.
      const anyMapDone = steps.some((s) => s.kind === "map" && s.status === "done");
      batch = anyMapDone ? maps.slice(0, CONCURRENCY) : maps.slice(0, 1);
    } else {
      batch = [open[0]!];
    }
    const claimed = await Promise.all(batch.map((s) => runStep(ctx, s)));
    // Everything runnable is leased by another worker; the sweep picks it up if that worker dies.
    if (!claimed.some(Boolean)) return;
  }
}

function budgetMessage(ctx: AppContext) {
  const minutes = Math.round(ctx.config.UX_DIRECTOR_RUN_BUDGET_MS / 60_000);
  return `The analysis didn't finish within ${minutes} minutes. Run the analysis again.`;
}

/** Claims, runs and records one step. Returns false if another worker holds it. */
async function runStep(ctx: AppContext, step: AnalysisStep): Promise<boolean> {
  const now = new Date();
  const claim = await ctx.db.analysisStep.updateMany({
    where: { id: step.id, OR: [{ status: "pending" }, { status: "running", leaseUntil: { lt: now } }] },
    data: { status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, startedAt: now },
  });
  if (claim.count !== 1) return false;
  const current = await ctx.db.analysisStep.findUniqueOrThrow({ where: { id: step.id } });
  const priorUsage = (current.usage as unknown as CallUsage | null) ?? emptyUsage();

  try {
    const result = await EXECUTORS[current.kind as keyof typeof EXECUTORS](ctx, current);
    await ctx.db.analysisStep.updateMany({
      where: { id: current.id, status: "running" },
      data: {
        status: result.pending ? "pending" : "done",
        output: result.output as Prisma.InputJsonValue,
        model: result.model ?? current.model,
        usage: addUsage(priorUsage, result.usage ?? emptyUsage()) as unknown as Prisma.InputJsonValue,
        error: null,
        leaseUntil: null,
        finishedAt: result.pending ? null : new Date(),
      },
    });
  } catch (err) {
    const retryable = err instanceof ModelCallError || err instanceof StepError ? err.retryable : false;
    const usage = err instanceof ModelCallError || err instanceof StepError ? err.usage : emptyUsage();
    const exhausted = current.attempts >= MAX_STEP_ATTEMPTS;
    const message = (err as Error).message.slice(0, 2000);
    ctx.log.warn({ runId: current.runId, step: current.kind, attempt: current.attempts, retryable, err: message }, "analysis step failed");
    await ctx.db.analysisStep.update({
      where: { id: current.id },
      data: {
        status: retryable && !exhausted ? "pending" : "failed",
        error: message,
        usage: addUsage(priorUsage, usage) as unknown as Prisma.InputJsonValue,
        leaseUntil: null,
      },
    });
  }
  return true;
}

/**
 * Sweep hook: resumes runs no live worker is driving (expired leases after a
 * restart or sleep) and fails runs past the budget.
 */
export async function resumeAnalysisRuns(ctx: AppContext) {
  const runs = await ctx.db.agentRun.findMany({ where: { provider: "ux_director", kind: "study_analysis", status: "running" }, select: { id: true, startedAt: true } });
  let resumed = 0;
  let failed = 0;
  for (const run of runs) {
    if (Date.now() - run.startedAt.getTime() > ctx.config.UX_DIRECTOR_RUN_BUDGET_MS) {
      await failRun(ctx, run.id, budgetMessage(ctx));
      failed++;
      continue;
    }
    if (driving.has(run.id)) continue;
    const live = await ctx.db.analysisStep.count({ where: { runId: run.id, status: "running", leaseUntil: { gt: new Date() } } });
    if (live === 0) {
      kickRun(ctx, run.id);
      resumed++;
    }
  }
  // Reports left processing by the retired AgenticOrg integration can never finish.
  const legacy = await ctx.db.report.updateMany({
    where: { source: "agenticorg", status: "processing" },
    data: { status: "failed", failureReason: "This analysis used the retired AgenticOrg integration. Run the analysis again." },
  });
  return { running: runs.length, resumed, failed, legacyFailed: legacy.count };
}

// ─── Step executors ─────────────────────────────────────────────────────────

async function loadEvidence(ctx: AppContext, runId: string): Promise<EvidenceOutput> {
  const step = await ctx.db.analysisStep.findUniqueOrThrow({ where: { runId_kind_attemptKey: { runId, kind: "evidence", attemptKey: "" } } });
  return step.output as unknown as EvidenceOutput;
}

async function stepOutput<T>(ctx: AppContext, runId: string, kind: string): Promise<T | null> {
  const step = await ctx.db.analysisStep.findUnique({ where: { runId_kind_attemptKey: { runId, kind, attemptKey: "" } } });
  return (step?.output as T | null) ?? null;
}

function requireModel(ctx: AppContext): ModelCaller {
  const model = ctx.providers.uxDirector.model;
  if (!model) throw new StepError("The UX Director isn't configured (ANTHROPIC_API_KEY is missing).", false);
  return model;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clipList = (list: string[], n: number, len: number) => list.slice(0, n).map((s) => clip(s, len));

async function mapStep(ctx: AppContext, step: AnalysisStep): Promise<StepResult> {
  const model = requireModel(ctx);
  const { pkg } = await loadEvidence(ctx, step.runId);
  const session = pkg.sessions.find((s) => s.session_id === step.attemptKey);
  if (!session) throw new StepError(`Attempt ${step.attemptKey} isn't in the evidence package.`, false);
  const res = await model.call({
    model: ctx.config.UX_DIRECTOR_MODEL_MAP,
    effort: "medium",
    maxTokens: 8000,
    system: MAP_SYSTEM,
    prefix: studyPrefix(pkg),
    input: mapInput(session),
    schema: MapOutputSchema,
    timeoutMs: 180_000,
  });
  const o = res.output;
  const individual: IndividualFinding = {
    session_id: session.session_id,
    observed: clipList(o.observed, 20, 500),
    reported: clipList(o.reported, 20, 1000),
    hypotheses: clipList(o.hypotheses, 10, 500),
    evidence_event_ids: o.evidence_event_ids.slice(0, 50),
    feedback_response_ids: o.feedback_response_ids.slice(0, 10),
    limitations: clipList(o.limitations, 10, 300),
  };
  // Validate against this attempt's own scope before the step is done.
  const check = validateResearchOutput(
    { study_id: pkg.study.study_id, snapshot_id: pkg.snapshot.snapshot_id, individual_findings: [individual], aggregate_findings: [] },
    scopeFromPackage(pkg),
  );
  if (!check.ok) throw new StepError(`Attempt analysis rejected: ${check.errors.slice(0, 8).join("; ")}`, true, res.usage);
  const output: MapStepOutput = { ...check.output.individual_findings[0]!, deviation_tags: clipList(o.deviation_tags, 5, 60) };
  return { output, model: res.model, usage: res.usage };
}

async function mapOutputs(ctx: AppContext, runId: string): Promise<MapStepOutput[]> {
  const maps = await ctx.db.analysisStep.findMany({ where: { runId, kind: "map" }, orderBy: { position: "asc" } });
  return maps.map((m) => m.output as unknown as MapStepOutput);
}

async function reduceStep(ctx: AppContext, step: AnalysisStep): Promise<StepResult> {
  const model = requireModel(ctx);
  const { pkg } = await loadEvidence(ctx, step.runId);
  const individual = await mapOutputs(ctx, step.runId);
  const verify = await stepOutput<VerifyOutput>(ctx, step.runId, "verify");
  const correction = verify?.retry ? verify.errors : undefined;
  const res = await model.call({
    model: ctx.config.UX_DIRECTOR_MODEL_REDUCE,
    effort: "high",
    maxTokens: 32000,
    system: REDUCE_SYSTEM,
    prefix: studyPrefix(pkg),
    input: reduceInput(pkg, individual, correction),
    schema: ReduceOutputSchema,
    timeoutMs: 300_000,
  });
  return { output: clipReduce(res.output), model: res.model, usage: res.usage };
}

function clipReduce(o: ReduceOutput): ReduceOutput {
  return {
    aggregate_findings: o.aggregate_findings.slice(0, 30).map((f) => ({
      issue: clip(f.issue, 200),
      affected_session_ids: f.affected_session_ids.slice(0, 200),
      counterexamples: f.counterexamples.slice(0, 200),
      expectation_gap: { intended: clip(f.expectation_gap.intended, 500), observed: clip(f.expectation_gap.observed, 1000), reported: clip(f.expectation_gap.reported, 1000) },
      evidence_strength: f.evidence_strength,
      strength_rationale: clip(f.strength_rationale, 500),
      evidence_event_ids: f.evidence_event_ids.slice(0, 100),
      feedback_response_ids: f.feedback_response_ids.slice(0, 50),
      recommendation: clip(f.recommendation, 2000),
      success_measure: clip(f.success_measure, 500),
      improvement_prompt: clip(f.improvement_prompt, 1200),
    })),
    overall_limitations: clipList(o.overall_limitations, 20, 500),
  };
}

async function verifyStep(ctx: AppContext, step: AnalysisStep): Promise<StepResult> {
  const { pkg } = await loadEvidence(ctx, step.runId);
  const individual = (await mapOutputs(ctx, step.runId)).map(({ deviation_tags: _tags, ...f }) => f);
  const reduce = await stepOutput<ReduceOutput>(ctx, step.runId, "reduce");
  if (!reduce) throw new StepError("The synthesis step has no output.", false);
  const combined = {
    study_id: pkg.study.study_id,
    snapshot_id: pkg.snapshot.snapshot_id,
    individual_findings: individual,
    aggregate_findings: reduce.aggregate_findings,
    overall_limitations: reduce.overall_limitations,
  };
  const result = validateResearchOutput(combined, scopeFromPackage(pkg));
  if (result.ok) return { output: { validated: result.output, inventedNumbers: result.inventedNumbers } satisfies VerifyOutput };

  const previous = step.output as VerifyOutput | null;
  if (!previous?.retry) {
    // One corrective synthesis with the reasons appended, then verify again.
    await ctx.db.analysisStep.update({
      where: { runId_kind_attemptKey: { runId: step.runId, kind: "reduce", attemptKey: "" } },
      data: { status: "pending", attempts: 0, error: `Rejected by verify: ${result.errors.slice(0, 5).join("; ")}`.slice(0, 2000) },
    });
    return { output: { retry: 1, errors: result.errors.slice(0, 20) } satisfies VerifyOutput, pending: true };
  }
  throw new StepError(`Output rejected by validation after a corrective retry: ${result.errors.slice(0, 10).join("; ")}`, false);
}

// ─── Rubric scoring (design D9) ─────────────────────────────────────────────

const LEVEL: Record<string, number> = { "1": 0, "2": 25, "3": 50, "4": 75, "5": 100 };
const FINDING_WEIGHTS = { evidence_support: 0.35, coverage: 0.2, statement_alignment: 0.2, counterexamples_handled: 0.1, specificity: 0.15 };
const RECOMMENDATION_WEIGHTS = { grounded: 0.35, actionable: 0.25, testable: 0.25, stays_in_evidence: 0.15 };

const weighted = (criteria: Record<string, Criterion>) => Math.round(Object.values(criteria).reduce((sum, c) => sum + c.score * c.weight, 0));

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** The evidence a scorer may see for one finding: the claim and what it cites, nothing else. */
function citedEvidence(pkg: EvidencePackage, f: ResearchOutput["aggregate_findings"][number]) {
  const eventIds = new Set(f.evidence_event_ids ?? []);
  const responseIds = new Set(f.feedback_response_ids ?? []);
  const events: (EvidenceSession["events"][number] & { session_id: string })[] = [];
  const answers: { session_id: string; response_id: string; question: string; answer: string }[] = [];
  for (const s of pkg.sessions) {
    for (const e of s.events) if (eventIds.has(e.event_id)) events.push({ session_id: s.session_id, ...e });
    for (const r of s.feedback) {
      if (responseIds.has(r.response_id) && r.answer_text) answers.push({ session_id: s.session_id, response_id: r.response_id, question: r.displayed_question, answer: r.answer_text });
    }
  }
  const affected = new Set(f.affected_session_ids);
  const otherAttempts = pkg.sessions
    .filter((s) => !affected.has(s.session_id))
    .map((s) => ({
      session_id: s.session_id,
      outcome: s.outcome,
      routes: s.events.map((e) => e.route).filter((r, i, all): r is string => Boolean(r) && r !== all[i - 1]),
      named_as_counterexample: f.counterexamples.includes(s.session_id),
    }));
  return { events, answers, otherAttempts };
}

async function scoreStep(ctx: AppContext, step: AnalysisStep): Promise<StepResult> {
  const model = requireModel(ctx);
  const { pkg } = await loadEvidence(ctx, step.runId);
  const verify = await stepOutput<VerifyOutput>(ctx, step.runId, "verify");
  if (!verify?.validated) throw new StepError("The verify step has no validated output.", false);
  const findings = verify.validated.aggregate_findings;
  const invented = new Set(verify.inventedNumbers ?? []);
  const included = pkg.sessions.length;
  const thresholds = { finding: ctx.config.UX_DIRECTOR_FINDING_THRESHOLD, recommendation: ctx.config.UX_DIRECTOR_RECOMMENDATION_THRESHOLD };
  let usage = emptyUsage();
  let modelName: string | undefined;

  const judgeFinding = async (f: (typeof findings)[number]) => {
    const cited = citedEvidence(pkg, f);
    const res = await model.call({
      model: ctx.config.UX_DIRECTOR_MODEL_SCORE,
      effort: "medium",
      maxTokens: 4000,
      system: FINDING_SCORER_SYSTEM,
      input: `Rate this finding.\n<evidence>\n${JSON.stringify({
        claim: { issue: f.issue, intended: f.expectation_gap?.intended, observed: f.expectation_gap?.observed, reported: f.expectation_gap?.reported },
        affected_session_ids: f.affected_session_ids,
        counterexamples: f.counterexamples,
        cited_events: cited.events,
        cited_answers: cited.answers,
        other_attempts: cited.otherAttempts,
      })}\n</evidence>`,
      schema: FindingJudgmentSchema,
      timeoutMs: 120_000,
    });
    usage = addUsage(usage, res.usage);
    modelName = res.model;
    return { judgment: res.output as FindingJudgment, cited };
  };

  const findingScores = await pool(findings, CONCURRENCY, judgeFinding);
  const scored: ScoredItem[] = findingScores.map(({ judgment: j, cited }, index) => {
    const f = findings[index]!;
    const supporting = new Set(f.affected_session_ids).size;
    const criteria: Record<string, Criterion> = {
      evidence_support: { score: LEVEL[j.evidence_support.score]!, weight: FINDING_WEIGHTS.evidence_support, source: "model", rationale: j.evidence_support.rationale },
      coverage: {
        score: included ? Math.round((100 * supporting) / included) : 0,
        weight: FINDING_WEIGHTS.coverage,
        source: "system",
        rationale: `${supporting} of ${included} included attempts support this finding.`,
      },
      statement_alignment: cited.answers.length
        ? { score: LEVEL[j.statement_alignment.score]!, weight: FINDING_WEIGHTS.statement_alignment, source: "model", rationale: j.statement_alignment.rationale }
        : { score: 0, weight: FINDING_WEIGHTS.statement_alignment, source: "system", rationale: "No participant answer is cited." },
      counterexamples_handled: cited.otherAttempts.length
        ? { score: LEVEL[j.counterexamples_handled.score]!, weight: FINDING_WEIGHTS.counterexamples_handled, source: "model", rationale: j.counterexamples_handled.rationale }
        : { score: 100, weight: FINDING_WEIGHTS.counterexamples_handled, source: "system", rationale: "Every included attempt supports this finding; no counterexamples exist." },
      specificity: { score: LEVEL[j.specificity.score]!, weight: FINDING_WEIGHTS.specificity, source: "model", rationale: j.specificity.rationale },
    };
    const score = weighted(criteria);
    return { index, issue: f.issue, score, kept: score >= thresholds.finding, criteria, recommendation: null };
  });

  // Recommendations are judged on their own, only for findings that were kept.
  const keptWithAdvice = scored.filter((s) => s.kept && findings[s.index]!.recommendation.trim());
  await pool(keptWithAdvice, CONCURRENCY, async (item) => {
    const f = findings[item.index]!;
    const cited = citedEvidence(pkg, f);
    const res = await model.call({
      model: ctx.config.UX_DIRECTOR_MODEL_SCORE,
      effort: "medium",
      maxTokens: 4000,
      system: RECOMMENDATION_SCORER_SYSTEM,
      input: `Rate this recommendation.\n<evidence>\n${JSON.stringify({
        finding: { issue: f.issue, observed: f.expectation_gap?.observed, reported: f.expectation_gap?.reported },
        cited_events: cited.events,
        cited_answers: cited.answers,
        recommendation: f.recommendation,
        retest_measure: f.success_measure,
        coding_assistant_prompt: f.improvement_prompt ?? "",
      })}\n</evidence>`,
      schema: RecommendationJudgmentSchema,
      timeoutMs: 120_000,
    });
    usage = addUsage(usage, res.usage);
    modelName = res.model;
    const j = res.output as RecommendationJudgment;
    const criteria: Record<string, Criterion> = {
      grounded: { score: LEVEL[j.grounded.score]!, weight: RECOMMENDATION_WEIGHTS.grounded, source: "model", rationale: j.grounded.rationale },
      actionable: { score: LEVEL[j.actionable.score]!, weight: RECOMMENDATION_WEIGHTS.actionable, source: "model", rationale: j.actionable.rationale },
      testable: f.success_measure.trim()
        ? { score: LEVEL[j.testable.score]!, weight: RECOMMENDATION_WEIGHTS.testable, source: "model", rationale: j.testable.rationale }
        : { score: 0, weight: RECOMMENDATION_WEIGHTS.testable, source: "system", rationale: "No retest measure was given." },
      stays_in_evidence: invented.has(item.index)
        ? { score: 0, weight: RECOMMENDATION_WEIGHTS.stays_in_evidence, source: "system", rationale: "The advice states counts or percentages the evidence can't support." }
        : { score: LEVEL[j.stays_in_evidence.score]!, weight: RECOMMENDATION_WEIGHTS.stays_in_evidence, source: "model", rationale: j.stays_in_evidence.rationale },
    };
    const score = weighted(criteria);
    item.recommendation = { score, kept: score >= thresholds.recommendation, criteria };
  });

  const output: ScoreOutput = { thresholds, includedAttempts: included, findings: scored };
  return { output, model: modelName, usage };
}

async function finalizeStep(ctx: AppContext, step: AnalysisStep): Promise<StepResult> {
  const { pkg, sessionIdByPublicId } = await loadEvidence(ctx, step.runId);
  const verify = await stepOutput<VerifyOutput>(ctx, step.runId, "verify");
  const scoring = await stepOutput<ScoreOutput>(ctx, step.runId, "score");
  if (!verify?.validated || !scoring) throw new StepError("Earlier steps have no output to finalize.", false);
  const output = verify.validated;
  const internal = (ids: string[]) => ids.map((id) => sessionIdByPublicId[id]).filter((x): x is string => Boolean(x));
  const answerText = new Map<string, { sessionId: string; text: string }>();
  for (const s of pkg.sessions) for (const r of s.feedback) if (r.answer_text) answerText.set(r.response_id, { sessionId: sessionIdByPublicId[s.session_id]!, text: r.answer_text });

  const kept = scoring.findings.filter((s) => s.kept);
  const droppedFindings = scoring.findings.length - kept.length;
  const droppedRecommendations = kept.filter((s) => s.recommendation && !s.recommendation.kept).length;
  const usage = await runUsage(ctx, step.runId);

  await ctx.db.$transaction(async (tx) => {
    const report = await tx.report.findUniqueOrThrow({ where: { id: step.reportId } });
    if (report.status !== "processing") return;
    await tx.reportFinding.createMany({
      data: kept.map((s, position) => {
        const f = output.aggregate_findings[s.index]!;
        const advice = s.recommendation?.kept ?? false;
        const quotes = (f.feedback_response_ids ?? [])
          .map((id) => ({ id, a: answerText.get(id) }))
          .filter((q): q is { id: string; a: { sessionId: string; text: string } } => Boolean(q.a))
          .map((q) => ({ sessionId: q.a.sessionId, responseId: q.id, text: q.a.text }));
        const gap = f.expectation_gap;
        const interpretation = [gap ? `Intended: ${gap.intended}` : null, gap ? `Reported: ${gap.reported}` : null, f.strength_rationale ?? null].filter(Boolean).join("\n");
        return {
          reportId: step.reportId,
          position,
          title: f.issue,
          observed: gap?.observed ?? f.issue,
          quotes: quotes as Prisma.InputJsonValue,
          interpretation: interpretation || null,
          evidenceStrength: f.evidence_strength,
          suggestion: advice ? f.recommendation || null : null,
          retestMetric: advice ? f.success_measure || null : null,
          improvementPrompt: advice ? f.improvement_prompt || null : null,
          confidenceScore: s.score,
          recommendationScore: advice ? (s.recommendation?.score ?? null) : null,
          scoreBreakdown: { finding: s.criteria, recommendation: s.recommendation } as unknown as Prisma.InputJsonValue,
          supportingSessionIds: internal(f.affected_session_ids),
          counterSessionIds: internal(f.counterexamples),
          source: "ux_director",
        };
      }),
    });
    await tx.report.update({
      where: { id: step.reportId },
      data: {
        status: "ready",
        agentOutput: { output, scoring } as unknown as Prisma.InputJsonValue,
        summary: output.overall_limitations?.length ? `Limitations: ${output.overall_limitations.join(" ")}`.slice(0, 2000) : null,
        sessionsIncluded: pkg.sessions.length,
        droppedFindings,
        droppedRecommendations,
      },
    });
    await tx.agentRun.update({
      where: { id: step.runId },
      data: { status: "completed", finishedAt: new Date(), details: { usage, findings: scoring.findings.length, kept: kept.length } as unknown as Prisma.InputJsonValue },
    });
    await audit(tx, {
      actorType: "system",
      action: "report.ready",
      resourceType: "report",
      resourceId: step.reportId,
      metadata: { agentRunId: step.runId, findings: kept.length, droppedFindings, droppedRecommendations },
    });
  });
  return { output: { kept: kept.length, droppedFindings, droppedRecommendations } };
}

const EXECUTORS = {
  map: mapStep,
  reduce: reduceStep,
  verify: verifyStep,
  score: scoreStep,
  finalize: finalizeStep,
} satisfies Record<string, (ctx: AppContext, step: AnalysisStep) => Promise<StepResult>>;
