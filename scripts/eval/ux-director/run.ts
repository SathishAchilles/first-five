/**
 * UX Director analysis eval runner: plays every case through the real app and
 * pipeline for one model setup and records the report per case and rep.
 *
 *   npx tsx --env-file=.env scripts/eval/ux-director/run.ts --setup gemini --reps 2
 *   npx tsx scripts/eval/ux-director/run.ts --setup stub --cases c01,c02
 *
 * Output: .claude/hillclimb/ux-director-analysis/<setup>/{results.jsonl,errors.jsonl,traces/,_state.json}.
 * Re-running resumes: (case, rep) pairs already in results.jsonl are skipped.
 * Grading is separate (grade.ts); this script never calls a model to judge.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateCodes } from "../../../apps/server/src/services/access-codes";
import { buildLocalApp, Client, startPostgres, stubModel } from "../../ux-director-local";
import { CASES, type EvalCase, type Participant, type ParticipantKey, type Step } from "./cases";

export const OUT_ROOT = resolve(".claude/hillclimb/ux-director-analysis");

export interface Setup {
  /** Index into the port range, so setups can run side by side. */
  slot: number;
  env: Record<string, string>;
  stub?: boolean;
}

export const SETUPS: Record<string, Setup> = {
  stub: { slot: 0, env: { ANTHROPIC_API_KEY: "stub-not-a-real-key" }, stub: true },
  haiku: {
    slot: 1,
    env: { UX_DIRECTOR_PROVIDER: "anthropic", UX_DIRECTOR_MODEL_Q2: "claude-haiku-5-5", UX_DIRECTOR_MODEL_MAP: "claude-haiku-5-5", UX_DIRECTOR_MODEL_REDUCE: "claude-haiku-5-5", UX_DIRECTOR_MODEL_SCORE: "claude-haiku-5-5" },
  },
  sonnet: {
    slot: 2,
    env: { UX_DIRECTOR_PROVIDER: "anthropic", UX_DIRECTOR_MODEL_Q2: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_MAP: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_REDUCE: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_SCORE: "claude-sonnet-5-5" },
  },
  gemini: {
    slot: 3,
    env: { UX_DIRECTOR_PROVIDER: "gemini", UX_DIRECTOR_MODEL_Q2: "gemini-3.8-flash", UX_DIRECTOR_MODEL_MAP: "gemini-3.8-flash", UX_DIRECTOR_MODEL_REDUCE: "gemini-3.8-flash", UX_DIRECTOR_MODEL_SCORE: "gemini-3.1-pro-preview" },
  },
  "sonnet-opus-score": {
    slot: 5,
    env: { UX_DIRECTOR_PROVIDER: "anthropic", UX_DIRECTOR_MODEL_Q2: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_MAP: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_REDUCE: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_SCORE: "claude-opus-5-5" },
  },
  split: {
    slot: 4,
    env: { UX_DIRECTOR_PROVIDER: "anthropic", UX_DIRECTOR_MODEL_Q2: "claude-haiku-5-5", UX_DIRECTOR_MODEL_MAP: "claude-haiku-5-5", UX_DIRECTOR_MODEL_REDUCE: "claude-sonnet-5-5", UX_DIRECTOR_MODEL_SCORE: "claude-sonnet-5-5" },
  },
};

/** USD per million tokens. Cache reads/writes as multiples of input. Gemini 3.1 Pro preview price is assumed; check before quoting. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.1, cacheWrite: 1.25 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.1, cacheWrite: 0 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.1, cacheWrite: 0 },
};

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  duration_ms?: number;
  calls?: number;
}

export function costUsd(model: string | null | undefined, u: Usage | null | undefined): number | null {
  if (!u || u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens === 0) return 0;
  const key = Object.keys(PRICES).find((k) => model?.startsWith(k));
  if (!key) return null;
  const p = PRICES[key]!;
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.input * p.cacheRead + u.cache_creation_input_tokens * p.input * p.cacheWrite) / 1e6;
}

/** Same order for every setup at a given (case, rep); different between reps. */
export function participantOrder(caseId: string, rep: number): ParticipantKey[] {
  const seed = createHash("sha256").update(`${caseId}:${rep}`).digest().readUInt32BE(0);
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const keys: ParticipantKey[] = ["A", "B", "C", "D", "E"];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  return keys;
}

// ─── Driving the app ────────────────────────────────────────────────────────

type App = Awaited<ReturnType<typeof buildLocalApp>>;
const DEFAULT_GAP_MS = 4000;

let ipCounter = 0;
/** A distinct client address per simulated person (per-IP rate limits apply as in production). */
const nextIp = () => {
  const n = ++ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};

const siteFor = (c: EvalCase) => `https://${c.id.split("-")[0]}.eval.example.com`;

/** Events with timestamps spaced by each step's waitMs (default 4 s); records event_id → route. */
function buildEvents(base: object, steps: Step[], routes: Map<string, string>) {
  let at = Date.now();
  return steps.map((s, seq) => {
    at += s.waitMs ?? DEFAULT_GAP_MS;
    const event_id = randomUUID();
    routes.set(event_id, s.page);
    const common = { schema_version: 1, event_id, client_sequence: seq, timestamp: new Date(at).toISOString(), ...base };
    if ("custom" in s) return { ...common, event_name: "ff_custom_event", page_path: s.page, custom_event_name: s.custom, ...(s.props ? { properties: s.props } : {}) };
    if ("click" in s) return { ...common, event_name: "ff_element_clicked", page_path: s.page, element_id: s.click, element_type: "button", element_label: s.label };
    return { ...common, event_name: "ff_page_viewed", page_path: s.page };
  });
}

async function sdkPost(app: App["app"], ip: string, site: string, url: string, cred: string, payload: object) {
  const res = await app.inject({ method: "POST", url, remoteAddress: ip, headers: { origin: site, authorization: `Bearer ${cred}` }, payload });
  if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode} ${res.body.slice(0, 300)}`);
  return res.json();
}

/** Builder, access code, project, setup walk (pages and every clicked element) and a launched study. */
async function createStudy({ app, ctx }: App, c: EvalCase) {
  const site = siteFor(c);
  const builder = new Client(app, nextIp());
  await builder.ok("POST", "/api/auth/signup", { email: `eval-${c.id.split("-")[0]}-${randomUUID().slice(0, 8)}@example.com`, password: "correct-horse-battery" });
  const { codes } = await generateCodes(ctx, { label: "eval", audience: "internal", planKey: "complimentary", studyCredits: 1, participantCap: 10, count: 1, maxRedemptions: 1 });
  await builder.ok("POST", "/api/access/redeem", { code: codes[0] });
  const project = await builder.ok("POST", "/api/projects", { name: c.study.name, websiteUrl: site });
  const setup = await builder.ok("POST", `/api/projects/${project.id}/setup-sessions`);
  const sx = await app.inject({ method: "POST", url: "/api/sdk/exchange", remoteAddress: builder.ip, headers: { origin: site }, payload: { project_id: project.publicId, ticket: new URL(setup.launchUrl).hash.replace(/^#ff_setup=/, "") } });
  if (sx.statusCode !== 200) throw new Error(`setup exchange → ${sx.statusCode} ${sx.body.slice(0, 200)}`);
  const cred = sx.json().credential as string;

  const base = { project_id: project.publicId, mode: "setup" };
  const pages = [...new Set([...c.study.pages, ...c.participants.flatMap((p) => p.steps.map((s) => s.page))])];
  const clicks = new Map<string, { page: string; label: string }>();
  for (const p of c.participants) for (const s of p.steps) if ("click" in s) clicks.set(s.click, { page: s.page, label: s.label });
  let seq = 0;
  const at = (i: number) => new Date(Date.now() + i * 1000).toISOString();
  const events: object[] = pages.map((page) => ({ schema_version: 1, event_id: randomUUID(), client_sequence: seq, timestamp: at(seq++), ...base, event_name: "ff_page_viewed", page_path: page }));
  for (const [id, el] of clicks) {
    events.push({ schema_version: 1, event_id: randomUUID(), client_sequence: seq, timestamp: at(seq++), ...base, event_name: "ff_element_discovered", page_path: el.page, element_id: id, element_type: "button", element_label: el.label });
  }
  await sdkPost(app, builder.ip!, site, "/api/sdk/events", cred, { schema_version: 1, sdk_version: "eval", events });

  const draft = await builder.ok("POST", "/api/studies", {
    projectId: project.id,
    name: c.study.name,
    task: c.study.task,
    startPath: c.study.startPath,
    goalType: c.study.goalType,
    goalTarget: c.study.goalTarget,
    timeLimitSeconds: 300,
    participantLimit: 10,
  });
  const launched = await builder.ok("POST", `/api/studies/${draft.id}/launch`);
  return { site, builder, project: { id: project.id as string, publicId: project.publicId as string }, study: { id: draft.id as string, publicId: launched.publicId as string } };
}

type Study = Awaited<ReturnType<typeof createStudy>>;

/** Consent → events → end → interview (answers or all skipped). Returns the session public id and the Q2 shown. */
async function playParticipant({ app, db }: App, s: Study, p: Participant, routes: Map<string, string>) {
  const client = new Client(app, nextIp());
  const ip = client.ip!;
  const attempt = await client.ok("POST", `/api/public/studies/${s.study.publicId}/attempts`, { consent: true });
  const ex = await app.inject({ method: "POST", url: "/api/sdk/exchange", remoteAddress: ip, headers: { origin: s.site }, payload: { project_id: s.project.publicId, ticket: new URL(attempt.launchUrl).hash.replace(/^#ff_launch=/, "") } });
  if (ex.statusCode !== 200) throw new Error(`participant ${p.key}: exchange → ${ex.statusCode} ${ex.body.slice(0, 200)}`);
  const cred = ex.json().credential as string;
  const base = { project_id: s.project.publicId, mode: "live", study_id: s.study.publicId, session_id: attempt.sessionId };
  const events = buildEvents(base, p.steps, routes);
  const ing = await sdkPost(app, ip, s.site, "/api/sdk/events", cred, { schema_version: 1, sdk_version: "eval", events });
  if (ing.rejected?.length) throw new Error(`participant ${p.key}: events rejected ${JSON.stringify(ing.rejected).slice(0, 300)}`);
  const end = await sdkPost(app, ip, s.site, "/api/sdk/session/end", cred, { reason: p.reachGoal ? "finished" : "gave_up" });

  const headers = { "x-ff-feedback": new URL(end.feedback_url).hash.replace("#h=", "") };
  const form = await client.ok("GET", `/api/public/studies/${s.study.publicId}/feedback`, undefined, headers);
  const a = p.answers;
  const text = (questionKey: string, t: string | undefined) => (t ? { questionKey, status: "answered", text: t } : { questionKey, status: "skipped" });
  const answers = a
    ? [{ questionKey: "q1_ease", status: "answered", choice: a.ease }, text("q2_context", a.q2), text("q3_improve", a.q3)]
    : ["q1_ease", "q2_context", "q3_improve"].map((questionKey) => ({ questionKey, status: "skipped" }));
  await client.ok("POST", `/api/public/studies/${s.study.publicId}/feedback`, { answers }, headers);

  // The harness plays an attempt in milliseconds; give the session the duration its event timeline spans.
  const first = new Date(events[0]!.timestamp).getTime();
  const last = new Date(events.at(-1)!.timestamp).getTime();
  const row = await db.studySession.findUniqueOrThrow({ where: { publicId: attempt.sessionId } });
  await db.studySession.update({
    where: { id: row.id },
    data: { startedAt: new Date(first - 2000), ...(row.goalVerifiedAt ? { goalVerifiedAt: new Date(last) } : {}), ...(row.finalizedAt ? { finalizedAt: new Date(last + 1000) } : {}) },
  });
  const q2 = form.questions.find((q: { key: string }) => q.key === "q2_context");
  return { sessionId: attempt.sessionId as string, q2: { source: q2?.source as string, text: q2?.text as string } };
}

async function waitReady(s: Study, reportId: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const detail = await s.builder.ok("GET", `/api/reports/${reportId}`);
    if (detail.status !== "processing") return detail;
    if (Date.now() > end) throw new Error(`report still processing after ${Math.round(timeoutMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ─── One (case, rep) ────────────────────────────────────────────────────────

export interface FindingRecord {
  index: number;
  kept: boolean;
  score: number;
  recommendationKept: boolean;
  recommendationScore: number | null;
  issue: string;
  observed: string;
  reported: string;
  recommendation: string;
  successMeasure: string;
  improvementPrompt: string;
  evidenceStrength: string;
  affected: ParticipantKey[];
  counterexamples: ParticipantKey[];
  /** Routes of the cited events. */
  citedRoutes: string[];
  quoted: string[];
}

export interface RunRecord {
  id: string;
  case: string;
  rep: number;
  setup: string;
  models: Record<string, string>;
  order: ParticipantKey[];
  status: "ready" | "failed";
  failureReason: string | null;
  wallMs: number;
  analysisMs: number;
  q2: { key: ParticipantKey; source: string; text: string }[];
  /** Q2 generation time per attempt in this study. */
  q2LatencyMs: number[];
  steps: { kind: string; key: ParticipantKey | null; status: string; attempts: number; model: string | null; usage: Usage | null; costUsd: number | null }[];
  correctiveReduces: number;
  usage: Usage;
  costUsd: number | null;
  findings: FindingRecord[];
  overallLimitations: string[];
}

async function runCase(app: App, setupName: string, c: EvalCase, rep: number, timeoutMs: number) {
  const started = Date.now();
  const s = await createStudy(app, c);
  const order = participantOrder(c.id, rep);
  const routes = new Map<string, string>();
  const keyBySession = new Map<string, ParticipantKey>();
  const q2: RunRecord["q2"] = [];
  for (const key of order) {
    const p = c.participants.find((x) => x.key === key)!;
    const r = await playParticipant(app, s, p, routes);
    keyBySession.set(r.sessionId, key);
    q2.push({ key, ...r.q2 });
  }

  const analysisStarted = Date.now();
  const first = await s.builder.ok("POST", `/api/studies/${s.study.id}/analyze`);
  const report = await waitReady(s, first.id, timeoutMs);
  const analysisMs = Date.now() - analysisStarted;
  const row = await app.db.report.findUniqueOrThrow({ where: { id: report.id } });
  const q2Runs = await app.db.agentRun.findMany({ where: { kind: "contextual_question", studyId: s.study.id }, select: { details: true } });
  const q2LatencyMs = q2Runs.map((r) => (r.details as { latencyMs?: number } | null)?.latencyMs).filter((x): x is number => typeof x === "number");
  const sessions = await app.db.studySession.findMany({ where: { studyId: s.study.id }, select: { id: true, publicId: true } });
  const byInternal = new Map(sessions.map((x) => [x.id, keyBySession.get(x.publicId)]));
  const toKey = (id: string) => keyBySession.get(id) ?? byInternal.get(id) ?? null;
  const keys = (ids: string[] = []) => ids.map(toKey).filter((k): k is ParticipantKey => Boolean(k));

  const stepRows = row.agentRunId ? await app.db.analysisStep.findMany({ where: { runId: row.agentRunId }, orderBy: { position: "asc" } }) : [];
  const steps = stepRows.map((st) => {
    const usage = (st.usage as Usage | null) ?? null;
    return { kind: st.kind, key: st.attemptKey ? toKey(st.attemptKey) : null, status: st.status, attempts: st.attempts, model: st.model ?? null, usage, costUsd: costUsd(st.model, usage) };
  });
  const total = steps.reduce<Usage>(
    (t, st) => ({
      input_tokens: t.input_tokens + (st.usage?.input_tokens ?? 0),
      output_tokens: t.output_tokens + (st.usage?.output_tokens ?? 0),
      cache_read_input_tokens: t.cache_read_input_tokens + (st.usage?.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens: t.cache_creation_input_tokens + (st.usage?.cache_creation_input_tokens ?? 0),
      calls: (t.calls ?? 0) + (st.usage?.calls ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 },
  );
  const costs = steps.map((st) => st.costUsd);

  const agent = (row.agentOutput ?? {}) as { output?: any; scoring?: any };
  const scored: any[] = agent.scoring?.findings ?? [];
  const findings: FindingRecord[] = (agent.output?.aggregate_findings ?? []).map((f: any, index: number) => {
    const sc = scored.find((x) => x.index === index);
    return {
      index,
      kept: Boolean(sc?.kept),
      score: sc?.score ?? 0,
      recommendationKept: Boolean(sc?.recommendation?.kept),
      recommendationScore: sc?.recommendation?.score ?? null,
      issue: f.issue ?? "",
      observed: f.expectation_gap?.observed ?? "",
      reported: f.expectation_gap?.reported ?? "",
      recommendation: f.recommendation ?? "",
      successMeasure: f.success_measure ?? "",
      improvementPrompt: f.improvement_prompt ?? "",
      evidenceStrength: f.evidence_strength ?? "",
      affected: keys(f.affected_session_ids),
      counterexamples: keys(f.counterexamples),
      citedRoutes: [...new Set((f.evidence_event_ids ?? []).map((id: string) => routes.get(id)).filter(Boolean))] as string[],
      quoted: f.feedback_response_ids ?? [],
    };
  });

  const record: RunRecord = {
    id: `${c.id}#${rep}`,
    case: c.id,
    rep,
    setup: setupName,
    models: {
      q2: app.ctx.config.UX_DIRECTOR_MODEL_Q2,
      map: app.ctx.config.UX_DIRECTOR_MODEL_MAP,
      reduce: app.ctx.config.UX_DIRECTOR_MODEL_REDUCE,
      score: app.ctx.config.UX_DIRECTOR_MODEL_SCORE,
    },
    order,
    status: report.status === "ready" ? "ready" : "failed",
    failureReason: report.failureReason ?? null,
    wallMs: Date.now() - started,
    analysisMs,
    q2,
    q2LatencyMs,
    steps,
    correctiveReduces: Math.max(0, stepRows.filter((st) => st.kind === "reduce").reduce((n, st) => n + st.attempts, 0) - 1),
    usage: total,
    costUsd: costs.some((x) => x === null) ? null : costs.reduce<number>((a, b) => a + (b ?? 0), 0),
    findings,
    overallLimitations: agent.output?.overall_limitations ?? [],
  };
  const trace = { record, participants: c.participants, sessions: Object.fromEntries(keyBySession), report: { status: report.status, failureReason: report.failureReason, agentOutput: row.agentOutput }, stepRows };
  return { record, trace };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const readJsonl = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      setup: { type: "string" },
      reps: { type: "string", default: "1" },
      cases: { type: "string" },
      concurrency: { type: "string", default: "3" },
      "timeout-s": { type: "string", default: "900" },
    },
  });
  const setupName = values.setup ?? "";
  const setup = SETUPS[setupName];
  if (!setup) throw new Error(`--setup must be one of ${Object.keys(SETUPS).join(", ")}`);
  const reps = Number(values.reps);
  const wanted = values.cases?.split(",").map((x) => x.trim());
  const cases = wanted ? CASES.filter((c) => wanted.some((w) => c.id === w || c.id.startsWith(`${w}-`))) : CASES;
  if (!cases.length) throw new Error(`no cases match ${values.cases}`);

  const dir = resolve(OUT_ROOT, setupName);
  mkdirSync(resolve(dir, "traces"), { recursive: true });
  const resultsPath = resolve(dir, "results.jsonl");
  const errorsPath = resolve(dir, "errors.jsonl");
  const done = new Set(readJsonl(resultsPath).map((r: RunRecord) => r.id));
  const todo = cases.flatMap((c) => Array.from({ length: reps }, (_, i) => ({ c, rep: i + 1 }))).filter((t) => !done.has(`${t.c.id}#${t.rep}`));
  console.log(`setup ${setupName}: ${todo.length} to run, ${done.size} already done`);
  if (!todo.length) return;

  const port = 54350 + setup.slot;
  const { pg, url } = await startPostgres(port, true);
  const app = await buildLocalApp(url, { ...setup.env, UX_DIRECTOR_Q2_TIMEOUT_MS: "30000" });
  try {
    if (setup.stub) app.ctx.providers.uxDirector.model = stubModel() as never;
    else if (!app.ctx.providers.uxDirector.configured) throw new Error(`setup ${setupName} needs its provider's API key (run with --env-file=.env)`);
    const runnerHash = createHash("sha256").update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL("./cases.ts", import.meta.url))).digest("hex").slice(0, 16);
    writeFileSync(resolve(dir, "_state.json"), JSON.stringify({ setup: setupName, env: setup.env, runnerHash, updatedAt: new Date().toISOString() }, null, 2) + "\n");

    await pool(todo, Number(values.concurrency), async ({ c, rep }) => {
      const t0 = Date.now();
      try {
        const { record, trace } = await runCase(app, setupName, c, rep, Number(values["timeout-s"]) * 1000);
        writeFileSync(resolve(dir, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(trace, null, 2) + "\n");
        appendFileSync(resultsPath, JSON.stringify(record) + "\n");
        const kept = record.findings.filter((f) => f.kept).length;
        console.log(`  ${record.status === "ready" ? "ok  " : "FAIL"} ${record.id}  kept ${kept}/${record.findings.length}  ${Math.round(record.wallMs / 1000)} s  $${record.costUsd?.toFixed(4) ?? "?"}${record.failureReason ? `  ${record.failureReason}` : ""}`);
      } catch (err) {
        appendFileSync(errorsPath, JSON.stringify({ id: `${c.id}#${rep}`, at: new Date().toISOString(), ms: Date.now() - t0, error: (err as Error).message }) + "\n");
        console.log(`  ERR  ${c.id}#${rep}  ${(err as Error).message}`);
      }
    });
  } finally {
    await app.app.close();
    await app.db.$disconnect();
    await pg.stop();
  }
}

const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
