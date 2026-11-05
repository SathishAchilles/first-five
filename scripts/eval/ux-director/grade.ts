/**
 * UX Director eval grader. Implements .claude/hillclimb/ux-director-analysis/grading-rules.md.
 *
 *   npx tsx scripts/eval/ux-director/grade.ts queue --setups gemini,haiku --batch pilot
 *     → judge-<batch>/judge-queue.{json,md} (blinded) and judge-key.json (not for the judge)
 *   (the Claude Code session writes judge-<batch>/judge-grades.json)
 *   npx tsx scripts/eval/ux-director/grade.ts merge --batch pilot
 *     → judge-<batch>/graded.jsonl, summary.json, summary.md
 *   npx tsx scripts/eval/ux-director/grade.ts self-check
 *     → oracle and null runs through queue → grades → merge, with assertions
 *
 * No model is called here. Open-ended checks are answered in judge-grades.json.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CASES, type EvalCase, type ParticipantKey, type PlantedIssue } from "./cases";
import { OUT_ROOT, type FindingRecord, type RunRecord } from "./run";

const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

// ─── Step 1: candidate match (code) ─────────────────────────────────────────

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether text names a route. "/" alone needs a standalone slash or "home page". */
export function namesRoute(text: string, route: string): boolean {
  if (route === "/") return /(^|[\s"'(`])\/(?=[\s"'),.;:`]|$)/.test(text) || /\bhome ?page\b/i.test(text);
  return new RegExp(`${escape(route)}(?![a-z0-9_-])`, "i").test(text);
}

const findingText = (f: FindingRecord) => [f.issue, f.observed, f.recommendation, f.successMeasure, f.improvementPrompt].join("\n");

const jaccard = (a: ParticipantKey[], b: ParticipantKey[]) => {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
};

export function isCandidate(f: FindingRecord, p: PlantedIssue): boolean {
  const overlap = f.affected.filter((k) => p.attempts.includes(k)).length;
  if (overlap < 1 || overlap / p.attempts.length < 0.5) return false;
  const text = findingText(f);
  return p.routes.some((r) => namesRoute(text, r) || f.citedRoutes.includes(r));
}

export interface MatchResult {
  /** finding index → planted issue id it was assigned to (or null). */
  assigned: Map<number, string | null>;
  /** planted issue id → primary finding index. */
  primary: Map<string, number>;
  duplicates: Set<number>;
}

/** Kept findings only. Highest Jaccard wins; ties go to the lower issue id. */
export function matchFindings(record: RunRecord, c: EvalCase): MatchResult {
  const assigned = new Map<number, string | null>();
  const best = new Map<string, { index: number; j: number }[]>();
  for (const f of record.findings.filter((x) => x.kept)) {
    const ranked = c.answerKey.issues
      .filter((p) => isCandidate(f, p))
      .map((p) => ({ id: p.id, j: jaccard(f.affected, p.attempts) }))
      .sort((a, b) => b.j - a.j || a.id.localeCompare(b.id));
    const pick = ranked[0] ?? null;
    assigned.set(f.index, pick?.id ?? null);
    if (pick) best.set(pick.id, [...(best.get(pick.id) ?? []), { index: f.index, j: pick.j }]);
  }
  const primary = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const [id, list] of best) {
    list.sort((a, b) => b.j - a.j || a.index - b.index);
    primary.set(id, list[0]!.index);
    for (const x of list.slice(1)) duplicates.add(x.index);
  }
  return { assigned, primary, duplicates };
}

// ─── Step 2: blinded judge queue ────────────────────────────────────────────

interface FindingView {
  issue: string;
  observed: string;
  reported: string;
  evidence_strength: string;
  recommendation: string | null;
  success_measure: string | null;
  improvement_prompt: string | null;
  cited_routes: string[];
}

export type QueueItem =
  | { id: string; kind: "match"; task: string; planted: { summary: string; mechanism: string; fix: string }; finding: FindingView; answer: "mechanism: correct|partial|wrong; rec_fit: fixes|partial|no|absent" }
  | { id: string; kind: "unmatched"; task: string; planted: { id: string; summary: string; mechanism: string }[]; finding: FindingView; answer: "planted: <issue id>|not_planted" }
  | { id: string; kind: "mustnot"; task: string; rules: string[]; findings: FindingView[]; limitations: string[]; answer: "violations: one entry per rule, ok|violated (+quote)" };

export interface KeyEntry {
  setup: string;
  record: string;
  kind: QueueItem["kind"];
  findingIndex?: number;
  issueId?: string;
}

export type Grade =
  | { mechanism: "correct" | "partial" | "wrong"; rec_fit: "fixes" | "partial" | "no" | "absent"; rationale: string }
  | { planted: string; rationale: string }
  | { violations: { rule: number; status: "ok" | "violated"; quote?: string }[]; rationale?: string };

const view = (f: FindingRecord): FindingView => ({
  issue: f.issue,
  observed: f.observed,
  reported: f.reported,
  evidence_strength: f.evidenceStrength,
  recommendation: f.recommendationKept ? f.recommendation : null,
  success_measure: f.recommendationKept ? f.successMeasure : null,
  improvement_prompt: f.recommendationKept ? f.improvementPrompt : null,
  cited_routes: f.citedRoutes,
});

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function buildQueue(bySetup: Record<string, RunRecord[]>) {
  const salt = randomBytes(16).toString("hex");
  const items: QueueItem[] = [];
  const key: Record<string, KeyEntry> = {};
  const add = (entry: KeyEntry, make: (id: string) => QueueItem) => {
    const id = createHash("sha256").update(`${salt}|${entry.setup}|${entry.record}|${entry.kind}|${entry.findingIndex ?? ""}|${entry.issueId ?? ""}`).digest("hex").slice(0, 12);
    key[id] = entry;
    items.push(make(id));
  };
  for (const [setup, records] of Object.entries(bySetup)) {
    for (const r of records) {
      if (r.status !== "ready") continue;
      const c = CASE_BY_ID.get(r.case)!;
      const m = matchFindings(r, c);
      const task = c.study.task;
      for (const [issueId, index] of m.primary) {
        const p = c.answerKey.issues.find((x) => x.id === issueId)!;
        const f = r.findings[index]!;
        add({ setup, record: r.id, kind: "match", findingIndex: index, issueId }, (id) => ({
          id,
          kind: "match",
          task,
          planted: { summary: p.summary, mechanism: p.mechanism, fix: p.fix },
          finding: view(f),
          answer: "mechanism: correct|partial|wrong; rec_fit: fixes|partial|no|absent",
        }));
      }
      if (c.answerKey.issues.length) {
        for (const [index, issueId] of m.assigned) {
          if (issueId !== null) continue;
          add({ setup, record: r.id, kind: "unmatched", findingIndex: index }, (id) => ({
            id,
            kind: "unmatched",
            task,
            planted: c.answerKey.issues.map((p) => ({ id: p.id, summary: p.summary, mechanism: p.mechanism })),
            finding: view(r.findings[index]!),
            answer: "planted: <issue id>|not_planted",
          }));
        }
      }
      if (c.answerKey.mustNot.length) {
        add({ setup, record: r.id, kind: "mustnot" }, (id) => ({
          id,
          kind: "mustnot",
          task,
          rules: c.answerKey.mustNot,
          findings: r.findings.filter((f) => f.kept).map(view),
          limitations: r.overallLimitations,
          answer: "violations: one entry per rule, ok|violated (+quote)",
        }));
      }
    }
  }
  return { items: shuffle(items), key, salt };
}

function queueMarkdown(items: QueueItem[]) {
  const out = ["# Judge queue", "", `${items.length} items, shuffled and blinded. Grade each by the rules in grading-rules.md and write judge-grades.json keyed by item id.`, ""];
  const f = (x: FindingView) =>
    [
      `- **Issue:** ${x.issue}`,
      `- **Observed:** ${x.observed}`,
      `- **Reported:** ${x.reported}`,
      `- **Strength:** ${x.evidence_strength} · **Cited routes:** ${x.cited_routes.join(", ") || "none"}`,
      `- **Recommendation:** ${x.recommendation ?? "_(dropped or none)_"}`,
      ...(x.recommendation ? [`- **Retest:** ${x.success_measure}`, `- **Prompt:** ${x.improvement_prompt}`] : []),
    ].join("\n");
  for (const it of items) {
    out.push(`## ${it.id} · ${it.kind}`, "", `**Task:** ${it.task}`, "");
    if (it.kind === "match") out.push(`**Planted:** ${it.planted.summary}`, `**Mechanism:** ${it.planted.mechanism}`, `**Fix looks like:** ${it.planted.fix}`, "", "**Finding**", f(it.finding));
    if (it.kind === "unmatched") out.push("**Planted issues in this study:**", ...it.planted.map((p) => `- ${p.id}: ${p.summary} — ${p.mechanism}`), "", "**Finding (no code match)**", f(it.finding));
    if (it.kind === "mustnot") {
      out.push("**Rules:**", ...it.rules.map((r, i) => `${i}. ${r}`), "", "**Kept findings**");
      it.findings.forEach((x, i) => out.push("", `_Finding ${i + 1}_`, f(x)));
      if (it.limitations.length) out.push("", `**Limitations:** ${it.limitations.join(" ")}`);
    }
    out.push("", `**Answer:** ${it.answer}`, "");
  }
  return out.join("\n");
}

// ─── Merge and metrics ──────────────────────────────────────────────────────

const MECH = new Set(["correct", "partial", "wrong"]);
const FIT = new Set(["fixes", "partial", "no", "absent"]);

export function validateGrades(items: QueueItem[], grades: Record<string, Grade>): string[] {
  const errors: string[] = [];
  for (const it of items) {
    const g = grades[it.id] as any;
    if (!g) {
      errors.push(`${it.id}: no grade`);
      continue;
    }
    if (it.kind === "match" && !(MECH.has(g.mechanism) && FIT.has(g.rec_fit))) errors.push(`${it.id}: match needs mechanism and rec_fit`);
    if (it.kind === "match" && it.finding.recommendation === null && g.rec_fit !== "absent") errors.push(`${it.id}: recommendation was dropped, so rec_fit must be absent`);
    if (it.kind === "unmatched" && !(g.planted === "not_planted" || it.planted.some((p) => p.id === g.planted))) errors.push(`${it.id}: planted must be an issue id or not_planted`);
    if (it.kind === "mustnot") {
      const v = g.violations;
      if (!Array.isArray(v) || v.length !== it.rules.length || v.some((x: any) => !["ok", "violated"].includes(x.status))) errors.push(`${it.id}: one ok|violated entry per rule`);
    }
  }
  return errors;
}

interface IssueOutcome {
  case: string;
  issue: string;
  rep: number;
  strict: boolean;
  lenient: boolean;
  recFit: string | null;
  score: number | null;
}

interface GradedRecord {
  setup: string;
  id: string;
  case: string;
  rep: number;
  status: string;
  issues: IssueOutcome[];
  falseFindings: { index: number; issue: string; score: number }[];
  codeMisses: { index: number; issue: string }[];
  duplicates: number;
  mustnotViolations: { rule: string; quote?: string }[];
  cleanCitations: number;
  hitScores: number[];
  falseScores: number[];
  correctiveReduces: number;
  analysisMs: number;
  costUsd: number | null;
  usage: RunRecord["usage"];
}

export function gradeRecords(bySetup: Record<string, RunRecord[]>, key: Record<string, KeyEntry>, grades: Record<string, Grade>): GradedRecord[] {
  const lookup = new Map<string, Grade>();
  for (const [id, k] of Object.entries(key)) if (grades[id]) lookup.set(`${k.setup}|${k.record}|${k.kind}|${k.findingIndex ?? ""}|${k.issueId ?? ""}`, grades[id]!);
  const get = (setup: string, record: string, kind: string, idx?: number, issue?: string) => lookup.get(`${setup}|${record}|${kind}|${idx ?? ""}|${issue ?? ""}`);

  const out: GradedRecord[] = [];
  for (const [setup, records] of Object.entries(bySetup)) {
    for (const r of records) {
      const c = CASE_BY_ID.get(r.case)!;
      const ready = r.status === "ready";
      const m = ready ? matchFindings(r, c) : { assigned: new Map(), primary: new Map(), duplicates: new Set<number>() };
      const issues: IssueOutcome[] = c.answerKey.issues.map((p) => {
        const idx = m.primary.get(p.id);
        const g = idx === undefined ? undefined : (get(setup, r.id, "match", idx, p.id) as Extract<Grade, { mechanism: string }> | undefined);
        return {
          case: r.case,
          issue: p.id,
          rep: r.rep,
          strict: g?.mechanism === "correct",
          lenient: g?.mechanism === "correct" || g?.mechanism === "partial",
          recFit: g?.rec_fit ?? null,
          score: idx === undefined ? null : r.findings[idx]!.score,
        };
      });
      const falseFindings: GradedRecord["falseFindings"] = [];
      const codeMisses: GradedRecord["codeMisses"] = [];
      for (const [index, issueId] of m.assigned) {
        if (issueId !== null) continue;
        const f = r.findings[index]!;
        const g = c.answerKey.issues.length ? (get(setup, r.id, "unmatched", index) as Extract<Grade, { planted: string }> | undefined) : { planted: "not_planted" };
        if (g?.planted === "not_planted") falseFindings.push({ index, issue: f.issue, score: f.score });
        else if (g) codeMisses.push({ index, issue: `${g.planted}: ${f.issue}` });
      }
      const mn = c.answerKey.mustNot.length ? (get(setup, r.id, "mustnot") as Extract<Grade, { violations: unknown }> | undefined) : undefined;
      const clean = new Set(c.answerKey.clean);
      const kept = r.findings.filter((f) => f.kept);
      const hitIdx = new Set(issues.filter((i) => i.strict).map((i) => m.primary.get(i.issue)!));
      out.push({
        setup,
        id: r.id,
        case: r.case,
        rep: r.rep,
        status: r.status,
        issues,
        falseFindings,
        codeMisses,
        duplicates: m.duplicates.size,
        mustnotViolations: (mn?.violations ?? []).filter((v) => v.status === "violated").map((v) => ({ rule: c.answerKey.mustNot[v.rule] ?? `rule ${v.rule}`, quote: v.quote })),
        cleanCitations: kept.filter((f) => f.affected.some((k) => clean.has(k))).length,
        hitScores: kept.filter((f) => hitIdx.has(f.index)).map((f) => f.score),
        falseScores: falseFindings.map((f) => f.score),
        correctiveReduces: r.correctiveReduces,
        analysisMs: r.analysisMs,
        costUsd: r.costUsd,
        usage: r.usage,
      });
    }
  }
  return out;
}

/** Probability that a random hit outscores a random false finding (ties count half). */
function auroc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/** Exact two-sided McNemar: binomial(b + c, 0.5) on min(b, c). */
export function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  let term = Math.pow(0.5, n);
  for (let i = 0; i <= k; i++) {
    tail += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarise(graded: GradedRecord[]) {
  const setups = [...new Set(graded.map((g) => g.setup))];
  const perSetup = Object.fromEntries(
    setups.map((s) => {
      const g = graded.filter((x) => x.setup === s);
      const issues = g.flatMap((x) => x.issues);
      const matched = issues.filter((i) => i.recFit !== null);
      const hits = g.flatMap((x) => x.hitScores);
      const falses = g.flatMap((x) => x.falseScores);
      const costs = g.map((x) => x.costUsd);
      return [
        s,
        {
          runs: g.length,
          ready: g.filter((x) => x.status === "ready").length,
          planted: issues.length,
          recall_strict: issues.length ? issues.filter((i) => i.strict).length / issues.length : null,
          recall_lenient: issues.length ? issues.filter((i) => i.lenient).length / issues.length : null,
          false_findings: g.reduce((n, x) => n + x.falseFindings.length, 0),
          false_findings_per_run: g.length ? g.reduce((n, x) => n + x.falseFindings.length, 0) / g.length : null,
          code_misses: g.reduce((n, x) => n + x.codeMisses.length, 0),
          duplicates: g.reduce((n, x) => n + x.duplicates, 0),
          rec_fit: matched.length ? matched.filter((i) => i.recFit === "fixes").length / matched.length : null,
          mustnot_violations: g.reduce((n, x) => n + x.mustnotViolations.length, 0),
          clean_citations: g.reduce((n, x) => n + x.cleanCitations, 0),
          score_hit_mean: mean(hits),
          score_false_mean: mean(falses),
          score_separation: hits.length && falses.length ? mean(hits)! - mean(falses)! : null,
          score_auroc: auroc(hits, falses),
          corrective_reduces_mean: mean(g.map((x) => x.correctiveReduces)),
          analysis_s_mean: mean(g.map((x) => x.analysisMs / 1000)),
          cost_usd_per_case: costs.some((x) => x === null) ? null : mean(costs as number[]),
          tokens: {
            input: g.reduce((n, x) => n + x.usage.input_tokens, 0),
            output: g.reduce((n, x) => n + x.usage.output_tokens, 0),
            cache_read: g.reduce((n, x) => n + x.usage.cache_read_input_tokens, 0),
            cache_write: g.reduce((n, x) => n + x.usage.cache_creation_input_tokens, 0),
          },
        },
      ];
    }),
  );

  const outcome = (s: string) => new Map(graded.filter((x) => x.setup === s).flatMap((x) => x.issues.map((i) => [`${i.case}|${i.issue}|${i.rep}`, i.strict] as const)));
  const pairwise = [];
  for (let i = 0; i < setups.length; i++) {
    for (let j = i + 1; j < setups.length; j++) {
      const X = outcome(setups[i]!);
      const Y = outcome(setups[j]!);
      let b = 0;
      let c = 0;
      let n = 0;
      const rate = new Map<string, { x: number; y: number }>();
      for (const [k, x] of X) {
        if (!Y.has(k)) continue;
        const y = Y.get(k)!;
        n++;
        if (x && !y) b++;
        if (y && !x) c++;
        const issue = k.split("|").slice(0, 2).join("|");
        const r = rate.get(issue) ?? { x: 0, y: 0 };
        r.x += Number(x);
        r.y += Number(y);
        rate.set(issue, r);
      }
      const bm = [...rate.values()].filter((r) => r.x > r.y).length;
      const cm = [...rate.values()].filter((r) => r.y > r.x).length;
      const p = mcnemar(b, c);
      const pm = mcnemar(bm, cm);
      pairwise.push({
        x: setups[i],
        y: setups[j],
        pairs: n,
        x_only: b,
        y_only: c,
        p,
        majority: { x_better: bm, y_better: cm, p: pm },
        verdict: p < 0.05 && pm < 0.05 ? (b > c ? `${setups[i]} better` : `${setups[j]} better`) : "no detectable difference",
      });
    }
  }
  return { perSetup, pairwise };
}

function summaryMarkdown(s: ReturnType<typeof summarise>) {
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const num = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));
  const out = ["# UX Director eval summary", "", "| setup | runs ok | recall strict | recall lenient | false findings | rec fit | must-not | dup | clean cites | score hit/false | AUROC | corrective reduces | analysis s | $/case |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const [k, v] of Object.entries(s.perSetup)) {
    out.push(
      `| ${k} | ${v.ready}/${v.runs} | ${pct(v.recall_strict)} | ${pct(v.recall_lenient)} | ${v.false_findings} | ${pct(v.rec_fit)} | ${v.mustnot_violations} | ${v.duplicates} | ${v.clean_citations} | ${num(v.score_hit_mean, 0)}/${num(v.score_false_mean, 0)} | ${num(v.score_auroc, 2)} | ${num(v.corrective_reduces_mean, 2)} | ${num(v.analysis_s_mean, 0)} | ${v.cost_usd_per_case === null ? "—" : `$${v.cost_usd_per_case.toFixed(4)}`} |`,
    );
  }
  out.push("", "## Paired comparison (strict hits, exact McNemar)", "", "| X | Y | pairs | X only | Y only | p | majority X/Y | majority p | verdict |", "|---|---|---|---|---|---|---|---|---|");
  for (const p of s.pairwise) out.push(`| ${p.x} | ${p.y} | ${p.pairs} | ${p.x_only} | ${p.y_only} | ${p.p.toFixed(3)} | ${p.majority.x_better}/${p.majority.y_better} | ${p.majority.p.toFixed(3)} | ${p.verdict} |`);
  return out.join("\n") + "\n";
}

// ─── Self-check (oracle and null) ───────────────────────────────────────────

function syntheticRecord(setup: string, c: EvalCase, rep: number, findings: Omit<FindingRecord, "index">[]): RunRecord {
  return {
    id: `${c.id}#${rep}`,
    case: c.id,
    rep,
    setup,
    models: {},
    order: ["A", "B", "C", "D", "E"],
    status: "ready",
    failureReason: null,
    wallMs: 0,
    analysisMs: 0,
    q2: [],
    steps: [],
    correctiveReduces: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    costUsd: 0,
    findings: findings.map((f, index) => ({ ...f, index })),
    overallLimitations: [],
  };
}

const oracleFinding = (p: PlantedIssue): Omit<FindingRecord, "index"> => ({
  kept: true,
  score: 90,
  recommendationKept: true,
  recommendationScore: 85,
  issue: `${p.summary} on ${p.routes.join(", ")}`,
  observed: p.mechanism,
  reported: "",
  recommendation: p.fix,
  successMeasure: "Task completion",
  improvementPrompt: p.fix,
  evidenceStrength: "supported",
  affected: p.attempts,
  counterexamples: [],
  citedRoutes: p.routes,
  quoted: [],
});

const decoyFinding = (c: EvalCase): Omit<FindingRecord, "index"> => ({
  ...oracleFinding({ id: "X", summary: "Participants disliked the colours", mechanism: "colour", attempts: c.answerKey.clean.length ? c.answerKey.clean : ["A"], routes: ["/nowhere"], fix: "Recolour" }),
  score: 40,
});

function selfCheck() {
  const bySetup: Record<string, RunRecord[]> = { oracle: [], null: [], noisy: [] };
  for (const c of CASES) {
    for (const rep of [1, 2]) {
      bySetup.oracle!.push(syntheticRecord("oracle", c, rep, c.answerKey.issues.map(oracleFinding)));
      bySetup.null!.push(syntheticRecord("null", c, rep, []));
      bySetup.noisy!.push(syntheticRecord("noisy", c, rep, [...c.answerKey.issues.map(oracleFinding), decoyFinding(c)]));
    }
  }
  const { items, key } = buildQueue(bySetup);
  // Auto-judge: oracle text is the answer key, so matches are correct and fix; decoys are not planted; no rule is broken.
  const grades: Record<string, Grade> = {};
  for (const it of items) {
    if (it.kind === "match") grades[it.id] = { mechanism: "correct", rec_fit: "fixes", rationale: "oracle" };
    if (it.kind === "unmatched") grades[it.id] = { planted: "not_planted", rationale: "decoy" };
    if (it.kind === "mustnot") grades[it.id] = { violations: it.rules.map((_, rule) => ({ rule, status: "ok" as const })) };
  }
  const errors = validateGrades(items, grades);
  const s = summarise(gradeRecords(bySetup, key, grades));
  const planted = CASES.reduce((n, c) => n + c.answerKey.issues.length, 0) * 2;
  const decoys = CASES.length * 2;
  const pair = (x: string, y: string) => s.pairwise.find((p) => p.x === x && p.y === y)!;
  const leak = items.some((it) => /"(oracle|null|noisy)"/.test(JSON.stringify(it)));
  const checks: [string, boolean, unknown][] = [
    ["grades validate", errors.length === 0, errors.slice(0, 3)],
    ["queue items carry no setup name", !leak, null],
    ["oracle: full recall, no false findings, no duplicates, no clean citations", s.perSetup.oracle!.recall_strict === 1 && s.perSetup.oracle!.false_findings === 0 && s.perSetup.oracle!.duplicates === 0 && s.perSetup.oracle!.clean_citations === 0, s.perSetup.oracle],
    ["oracle: every planted issue counted", s.perSetup.oracle!.planted === planted, s.perSetup.oracle!.planted],
    ["null: zero recall, no false findings", s.perSetup.null!.recall_strict === 0 && s.perSetup.null!.false_findings === 0, s.perSetup.null],
    ["noisy: full recall, one false finding per run, AUROC 1", s.perSetup.noisy!.recall_strict === 1 && s.perSetup.noisy!.false_findings === decoys && s.perSetup.noisy!.score_auroc === 1, [s.perSetup.noisy!.false_findings, s.perSetup.noisy!.score_auroc]],
    ["McNemar oracle vs null: oracle better, p < 0.05", pair("oracle", "null").verdict === "oracle better", pair("oracle", "null")],
    ["McNemar oracle vs noisy: no difference (same hits)", pair("oracle", "noisy").x_only === 0 && pair("oracle", "noisy").y_only === 0, pair("oracle", "noisy")],
    ["mcnemar(10, 0) ≈ 0.002, mcnemar(3, 3) = 1", Math.abs(mcnemar(10, 0) - 0.001953) < 1e-5 && mcnemar(3, 3) === 1, [mcnemar(10, 0), mcnemar(3, 3)]],
  ];
  let failed = 0;
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → ${JSON.stringify(detail).slice(0, 400)}`}`);
    if (!ok) failed++;
  }
  console.log(`queue items: ${items.length} (${["match", "unmatched", "mustnot"].map((k) => `${k} ${items.filter((i) => i.kind === k).length}`).join(", ")})`);
  if (failed) process.exitCode = 1;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const readJsonl = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function loadRecords(setups: string[], cases?: string[]) {
  const bySetup: Record<string, RunRecord[]> = {};
  for (const s of setups) {
    const rows = readJsonl(resolve(OUT_ROOT, s, "results.jsonl")) as RunRecord[];
    bySetup[s] = cases ? rows.filter((r) => cases.some((c) => r.case === c || r.case.startsWith(`${c}-`))) : rows;
    if (!bySetup[s]!.length) throw new Error(`no results for setup ${s}`);
  }
  return bySetup;
}

function main() {
  const [cmd] = process.argv.slice(2);
  const { values } = parseArgs({ args: process.argv.slice(3), options: { setups: { type: "string" }, batch: { type: "string", default: "main" }, cases: { type: "string" }, force: { type: "boolean", default: false } } });
  if (cmd === "self-check") return selfCheck();
  const dir = resolve(OUT_ROOT, `judge-${values.batch}`);
  if (cmd === "queue") {
    if (!values.setups) throw new Error("--setups a,b,c is required");
    mkdirSync(dir, { recursive: true });
    if (existsSync(resolve(dir, "judge-grades.json")) && !values.force) throw new Error(`${dir} already has grades; use another --batch or --force`);
    const setups = values.setups.split(",");
    const cases = values.cases?.split(",");
    const { items, key, salt } = buildQueue(loadRecords(setups, cases));
    writeFileSync(resolve(dir, "judge-queue.json"), JSON.stringify(items, null, 2) + "\n");
    writeFileSync(resolve(dir, "judge-queue.md"), queueMarkdown(items));
    writeFileSync(resolve(dir, "judge-key.json"), JSON.stringify({ salt, setups, cases: cases ?? null, key }, null, 2) + "\n");
    console.log(`queue: ${items.length} items → ${dir}/judge-queue.md (key kept in judge-key.json; don't open it before grading)`);
    return;
  }
  if (cmd === "merge") {
    const items = JSON.parse(readFileSync(resolve(dir, "judge-queue.json"), "utf8")) as QueueItem[];
    const keyFile = JSON.parse(readFileSync(resolve(dir, "judge-key.json"), "utf8"));
    const grades = JSON.parse(readFileSync(resolve(dir, "judge-grades.json"), "utf8")) as Record<string, Grade>;
    const errors = validateGrades(items, grades);
    if (errors.length) throw new Error(`grades incomplete or invalid:\n${errors.join("\n")}`);
    const graded = gradeRecords(loadRecords(keyFile.setups, keyFile.cases ?? undefined), keyFile.key, grades);
    const summary = summarise(graded);
    writeFileSync(resolve(dir, "graded.jsonl"), graded.map((g) => JSON.stringify(g)).join("\n") + "\n");
    writeFileSync(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    writeFileSync(resolve(dir, "summary.md"), summaryMarkdown(summary));
    console.log(summaryMarkdown(summary));
    return;
  }
  throw new Error("usage: grade.ts queue|merge|self-check [--setups a,b] [--batch name] [--cases c01,c02]");
}

main();
