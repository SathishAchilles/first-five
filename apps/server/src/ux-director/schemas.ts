/**
 * Output schemas for each model step (zod v4, converted to JSON Schema for
 * structured outputs). Only grammar-enforceable constraints live here; length
 * and count bounds are applied in code after parsing.
 */
import { z } from "zod/v4";

export const Q2OutputSchema = z.object({
  question: z.string(),
  evidence_event_id: z.string().nullable(),
});
export type Q2Output = z.infer<typeof Q2OutputSchema>;

export const MapOutputSchema = z.object({
  observed: z.array(z.string()),
  reported: z.array(z.string()),
  hypotheses: z.array(z.string()),
  evidence_event_ids: z.array(z.string()),
  feedback_response_ids: z.array(z.string()),
  limitations: z.array(z.string()),
  deviation_tags: z.array(z.string()),
});
export type MapOutput = z.infer<typeof MapOutputSchema>;

export const ReduceOutputSchema = z.object({
  aggregate_findings: z.array(
    z.object({
      issue: z.string(),
      affected_session_ids: z.array(z.string()),
      counterexamples: z.array(z.string()),
      expectation_gap: z.object({ intended: z.string(), observed: z.string(), reported: z.string() }),
      evidence_strength: z.enum(["inconclusive", "limited", "supported"]),
      strength_rationale: z.string(),
      evidence_event_ids: z.array(z.string()),
      feedback_response_ids: z.array(z.string()),
      recommendation: z.string(),
      success_measure: z.string(),
      improvement_prompt: z.string(),
    }),
  ),
  overall_limitations: z.array(z.string()),
});
export type ReduceOutput = z.infer<typeof ReduceOutputSchema>;

/** A rubric judgment on the 1–5 scale; mapped to 0/25/50/75/100 in code. */
const Judgment = z.object({
  score: z.enum(["1", "2", "3", "4", "5"]),
  rationale: z.string(),
});

export const FindingJudgmentSchema = z.object({
  evidence_support: Judgment,
  statement_alignment: Judgment,
  counterexamples_handled: Judgment,
  specificity: Judgment,
});
export type FindingJudgment = z.infer<typeof FindingJudgmentSchema>;

export const RecommendationJudgmentSchema = z.object({
  grounded: Judgment,
  actionable: Judgment,
  testable: Judgment,
  stays_in_evidence: Judgment,
});
export type RecommendationJudgment = z.infer<typeof RecommendationJudgmentSchema>;
