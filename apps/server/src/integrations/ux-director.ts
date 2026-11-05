/**
 * UX Director (First Five): contextual interview questions and research
 * analysis using Claude models through the Anthropic API, or Gemini when
 * UX_DIRECTOR_PROVIDER=gemini. The analysis
 * pipeline itself lives in services/analysis-pipeline.ts; this provider owns
 * configuration, the model caller and the Q2 call.
 * No question, run or score is ever fabricated when the provider isn't configured.
 */
import type { AppConfig } from "../config";
import { GeminiModelClient } from "../ux-director/gemini-model";
import { ModelClient, ModelCallError, type CallUsage, type ModelRequest, type ModelResult } from "../ux-director/model";
import { Q2_SYSTEM } from "../ux-director/prompts";
import { Q2OutputSchema } from "../ux-director/schemas";
import type { HealthResult } from "./posthog";
import type { z } from "zod/v4";

export interface QuestionEvent {
  event_id: string;
  seq: number | null;
  name: string;
  route: string | null;
  element_key: string | null;
  element_type: string | null;
  element_label: string | null;
  t_ms_from_start: number;
}

export interface SessionSummaryForQuestion {
  sessionPublicId: string;
  task: string;
  goal: { type: string; target: string };
  outcome: "completed" | "dropped" | "pending" | "invalid";
  events: QuestionEvent[];
}

export interface ContextualQuestion {
  question: string;
  evidenceEventId: string | null;
  model: string;
  usage: CallUsage;
}

/** The one capability the pipeline needs from a model; swappable for a stub in local harness runs. */
export interface ModelCaller {
  call<S extends z.ZodType>(req: ModelRequest<S>): Promise<ModelResult<z.infer<S>>>;
}

export interface UxDirectorProvider {
  readonly name: "ux_director";
  readonly configured: boolean;
  readonly implemented: boolean;
  /** Null when not configured. */
  model: ModelCaller | null;
  missingKeys(): string[];
  generateContextualQuestion(summary: SessionSummaryForQuestion, opts: { timeoutMs: number }): Promise<ContextualQuestion | null>;
  healthCheck(): Promise<HealthResult>;
}

export const Q2_MAX_LENGTH = 300;

/** The API key the selected provider needs. */
export function uxDirectorKeyName(config: AppConfig): "ANTHROPIC_API_KEY" | "GEMINI_API_KEY" {
  return config.UX_DIRECTOR_PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

export class InHouseUxDirector implements UxDirectorProvider {
  readonly name = "ux_director" as const;
  readonly implemented = true;
  model: ModelCaller | null;

  constructor(private readonly config: AppConfig) {
    const apiKey = config[uxDirectorKeyName(config)];
    if (!apiKey) this.model = null;
    else this.model = config.UX_DIRECTOR_PROVIDER === "gemini" ? new GeminiModelClient(apiKey) : new ModelClient(apiKey);
  }

  get configured() {
    return this.model != null;
  }

  missingKeys() {
    const key = uxDirectorKeyName(this.config);
    return this.config[key] ? [] : [key];
  }

  async generateContextualQuestion(summary: SessionSummaryForQuestion, opts: { timeoutMs: number }): Promise<ContextualQuestion | null> {
    if (!this.model) return null;
    const result = await this.model.call({
      model: this.config.UX_DIRECTOR_MODEL_Q2,
      effort: "low",
      maxTokens: 4000,
      system: Q2_SYSTEM,
      input: `Write the contextual question for this attempt:\n<evidence>\n${JSON.stringify({
        task: summary.task,
        goal: summary.goal,
        outcome: summary.outcome,
        events: summary.events,
      })}\n</evidence>`,
      schema: Q2OutputSchema,
      timeoutMs: opts.timeoutMs,
      // Retries inside a bounded wait only push the question past the fallback.
      maxRetries: 0,
    });
    const question = result.output.question.trim();
    if (!question || question.length > Q2_MAX_LENGTH || /https?:\/\//i.test(question)) return null;
    const known = new Set(summary.events.map((e) => e.event_id));
    const evidenceEventId = result.output.evidence_event_id && known.has(result.output.evidence_event_id) ? result.output.evidence_event_id : null;
    return { question, evidenceEventId, model: result.model, usage: result.usage };
  }

  /** One Q2-shaped call on synthetic data. */
  async healthCheck(): Promise<HealthResult> {
    if (!this.model) return { ok: false, status: "not_configured", message: `${uxDirectorKeyName(this.config)} isn't set.` };
    const started = Date.now();
    try {
      const q = await this.generateContextualQuestion(
        {
          sessionPublicId: "ffx_verification",
          task: "Create an account and reach your dashboard.",
          goal: { type: "page_reached", target: "/dashboard" },
          outcome: "completed",
          events: [
            { event_id: "ev_1", seq: 1, name: "ff_page_viewed", route: "/", element_key: null, element_type: null, element_label: null, t_ms_from_start: 0 },
            { event_id: "ev_2", seq: 2, name: "ff_page_viewed", route: "/pricing", element_key: null, element_type: null, element_label: null, t_ms_from_start: 4000 },
            { event_id: "ev_3", seq: 3, name: "ff_page_viewed", route: "/pricing", element_key: null, element_type: null, element_label: null, t_ms_from_start: 21000 },
            { event_id: "ev_4", seq: 4, name: "ff_page_viewed", route: "/dashboard", element_key: null, element_type: null, element_label: null, t_ms_from_start: 40000 },
          ],
        },
        { timeoutMs: 30_000 },
      );
      if (!q) return { ok: false, status: "error", message: "The model answered but the question wasn't usable." };
      return {
        ok: true,
        status: "verified",
        message: `Generated a contextual question with ${q.model} in ${Date.now() - started} ms.`,
        details: { model: q.model, question: q.question, usage: q.usage },
      };
    } catch (err) {
      const message = err instanceof ModelCallError ? err.message : (err as Error).message;
      return { ok: false, status: "error", message: `Verification call failed: ${message}` };
    }
  }
}
