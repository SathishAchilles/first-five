/**
 * Validation of structured UX Director output (PRD §9.5) before anything is
 * stored. Rejects unknown evidence references, counts that disagree with the
 * backend, non-verbatim quotes and pseudo-statistical percentages — the agent
 * never decides numbers.
 */
import { z } from "zod";

export const ResearchOutputSchema = z.object({
  study_id: z.string(),
  snapshot_id: z.string(),
  individual_findings: z
    .array(
      z.object({
        session_id: z.string(),
        observed: z.array(z.string().max(500)).max(20),
        reported: z.array(z.string().max(1000)).max(20),
        hypotheses: z.array(z.string().max(500)).max(10),
        evidence_event_ids: z.array(z.string()).max(50),
        feedback_response_ids: z.array(z.string()).max(10),
        limitations: z.array(z.string().max(300)).max(10),
      }),
    )
    .max(200),
  aggregate_findings: z
    .array(
      z.object({
        issue: z.string().min(3).max(200),
        affected_session_ids: z.array(z.string()).max(200),
        // The agent must leave this null; the backend fills it in. A non-null value must match.
        affected_count_from_backend: z.number().int().nonnegative().nullable().optional(),
        expectation_gap: z
          .object({ intended: z.string().max(500), observed: z.string().max(1000), reported: z.string().max(1000) })
          .optional(),
        evidence_strength: z.enum(["inconclusive", "limited", "supported"]),
        strength_rationale: z.string().max(500).optional(),
        counterexamples: z.array(z.string()).max(200),
        evidence_event_ids: z.array(z.string()).max(100).optional(),
        feedback_response_ids: z.array(z.string()).max(50).optional(),
        recommendation: z.string().max(2000),
        success_measure: z.string().max(500),
        improvement_prompt: z.string().max(1200).optional(),
      }),
    )
    .max(30),
  overall_limitations: z.array(z.string().max(500)).max(20).optional(),
  approval_status: z.string().optional(),
});
type ParsedOutput = z.infer<typeof ResearchOutputSchema>;
export type ResearchOutput = Omit<ParsedOutput, "aggregate_findings"> & {
  aggregate_findings: (ParsedOutput["aggregate_findings"][number] & { affected_count_from_backend: number })[];
};

export interface EvidenceScope {
  studyPublicId: string;
  sessionPublicIds: Set<string>;
  eventIdsBySession: Map<string, Set<string>>;
  responseIdsBySession: Map<string, Set<string>>;
  /** Stored answer text by response ID; when present, reported quotes must be verbatim. */
  answerTextByResponse?: Map<string, string>;
}

const PERCENT = /\d+(?:\.\d+)?\s?%/;
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, "")
    .trim();

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/**
 * Agents sometimes annotate an ID ("ffx_1 reached /dashboard without …"). When a
 * string contains exactly one known ID it is reduced to that ID; anything else is
 * left untouched and fails validation. Deterministic: no ID is ever guessed.
 */
function normalizeIds(raw: unknown, scope: EvidenceScope): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const known = new Set<string>([
    ...scope.sessionPublicIds,
    ...[...scope.eventIdsBySession.values()].flatMap((s) => [...s]),
    ...[...scope.responseIdsBySession.values()].flatMap((s) => [...s]),
  ]);
  const fix = (v: unknown) => {
    if (typeof v !== "string" || known.has(v)) return v;
    const hits = [...new Set(v.match(/[A-Za-z0-9_-]{6,}/g) ?? [])].filter((t) => known.has(t));
    return hits.length === 1 ? hits[0] : v;
  };
  const fixList = (v: unknown) => (Array.isArray(v) ? v.map(fix) : v);
  const o = { ...(raw as Record<string, unknown>) };
  const ID_LISTS = ["affected_session_ids", "counterexamples", "evidence_event_ids", "feedback_response_ids"];
  const mapFinding = (f: unknown) => {
    if (!f || typeof f !== "object") return f;
    const c = { ...(f as Record<string, unknown>) };
    if ("session_id" in c) c.session_id = fix(c.session_id);
    for (const k of ID_LISTS) if (k in c) c[k] = fixList(c[k]);
    return c;
  };
  if (Array.isArray(o.individual_findings)) o.individual_findings = o.individual_findings.map(mapFinding);
  if (Array.isArray(o.aggregate_findings)) o.aggregate_findings = o.aggregate_findings.map(mapFinding);
  return o;
}

/** Counts or rates the model has no basis for: "40%", "3 of 5", "4 participants". */
const INVENTED_NUMBER = /\d+(?:\.\d+)?\s?%|\b\d+\s*(?:of|out of)\s*\d+\b|\b\d+\s+(?:participants?|users?|people|testers?|attempts?|sessions?)\b/i;
const ADVICE_FIELDS = ["recommendation", "success_measure", "improvement_prompt"] as const;

export type ValidationResult =
  | {
      ok: true;
      output: ResearchOutput;
      /** Indexes of aggregate findings whose recommendation, retest measure or prompt states numbers (soft signal for scoring). */
      inventedNumbers: number[];
    }
  | { ok: false; errors: string[] };

export function validateResearchOutput(raw: unknown, scope: EvidenceScope): ValidationResult {
  const parsed = ResearchOutputSchema.safeParse(normalizeIds(raw, scope));
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const out = parsed.data;
  const errors: string[] = [];
  if (out.study_id !== scope.studyPublicId) errors.push("study_id does not match the requested study");

  const allEvents = new Set([...scope.eventIdsBySession.values()].flatMap((s) => [...s]));
  const allResponses = new Set([...scope.responseIdsBySession.values()].flatMap((s) => [...s]));

  out.individual_findings.forEach((f, i) => {
    if (!scope.sessionPublicIds.has(f.session_id)) errors.push(`individual_findings[${i}]: unknown session ${f.session_id}`);
    const events = scope.eventIdsBySession.get(f.session_id) ?? new Set();
    f.evidence_event_ids.filter((id) => !events.has(id)).forEach((id) => errors.push(`individual_findings[${i}]: event ${id} is not in that session`));
    const responses = scope.responseIdsBySession.get(f.session_id) ?? new Set();
    f.feedback_response_ids.filter((id) => !responses.has(id)).forEach((id) => errors.push(`individual_findings[${i}]: response ${id} is not in that session`));
    if (scope.answerTextByResponse) {
      const answers = [...responses].map((id) => scope.answerTextByResponse!.get(id)).filter((t): t is string => Boolean(t)).map(normalize);
      f.reported.forEach((quote, q) => {
        const n = normalize(quote);
        if (n && !answers.some((a) => a.includes(n) || n.includes(a))) {
          errors.push(`individual_findings[${i}].reported[${q}]: not a verbatim participant answer`);
        }
      });
    }
  });

  const aggregate = out.aggregate_findings.map((f, i) => {
    const unknown = [...f.affected_session_ids, ...f.counterexamples].filter((id) => !scope.sessionPublicIds.has(id));
    unknown.forEach((id) => errors.push(`aggregate_findings[${i}]: unknown session ${id}`));
    (f.evidence_event_ids ?? []).filter((id) => !allEvents.has(id)).forEach((id) => errors.push(`aggregate_findings[${i}]: unknown event ${id}`));
    (f.feedback_response_ids ?? []).filter((id) => !allResponses.has(id)).forEach((id) => errors.push(`aggregate_findings[${i}]: unknown response ${id}`));
    const overlap = f.affected_session_ids.filter((id) => f.counterexamples.includes(id));
    if (overlap.length) errors.push(`aggregate_findings[${i}]: session(s) ${overlap.join(", ")} both support and contradict the finding`);
    const distinct = new Set(f.affected_session_ids).size;
    if (f.affected_count_from_backend != null && f.affected_count_from_backend !== distinct) {
      errors.push(`aggregate_findings[${i}]: affected count ${f.affected_count_from_backend} doesn't match ${distinct} cited sessions`);
    }
    return { ...f, affected_count_from_backend: distinct };
  });

  // Percentages in the findings themselves are hard errors; in advice text they're a scoring signal.
  const findingText = out.aggregate_findings.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !(ADVICE_FIELDS as readonly string[]).includes(k))));
  if (strings({ i: out.individual_findings, a: findingText, l: out.overall_limitations }).some((s) => PERCENT.test(s))) {
    errors.push("output contains percentage claims; five-person studies report counts only");
  }
  const inventedNumbers = out.aggregate_findings
    .map((f, i) => (ADVICE_FIELDS.some((k) => INVENTED_NUMBER.test(f[k] ?? "")) ? i : -1))
    .filter((i) => i >= 0);

  return errors.length ? { ok: false, errors } : { ok: true, output: { ...out, aggregate_findings: aggregate }, inventedNumbers };
}
