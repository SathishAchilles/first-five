/**
 * Thin wrapper over the Anthropic SDK for UX Director steps: schema-constrained
 * output (zod v4 → JSON Schema), explicit effort, server-side refusal
 * fallbacks, SDK retries on 429/5xx, and usage/duration capture.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod/v4";

export type Effort = "low" | "medium" | "high";

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  duration_ms: number;
  calls: number;
}

export const emptyUsage = (): CallUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  duration_ms: 0,
  calls: 0,
});

export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    duration_ms: a.duration_ms + b.duration_ms,
    calls: a.calls + b.calls,
  };
}

/** A failed model call. `retryable` marks failures worth another step attempt. */
export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly usage: CallUsage,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

export interface ModelRequest<S extends z.ZodType> {
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Stable instructions; always cached. */
  system: string;
  /** Stable per-study context placed before the cache breakpoint (e.g. study definition). */
  prefix?: string;
  /** Per-call data after the cache breakpoint. */
  input: string;
  schema: S;
  timeoutMs: number;
  /** SDK retries for 429/5xx/connection errors (default 2). */
  maxRetries?: number;
}

export interface ModelResult<T> {
  output: T;
  usage: CallUsage;
  model: string;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Haiku has no server-side refusal fallback; sending `fallbacks` to it is a 400. */
const supportsFallbacks = (model: string) => !model.startsWith("claude-haiku");

export class ModelClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async call<S extends z.ZodType>(req: ModelRequest<S>): Promise<ModelResult<z.infer<S>>> {
    const started = Date.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.prefix) content.push({ type: "text", text: req.prefix, cache_control: { type: "ephemeral" } });
    content.push({ type: "text", text: req.input });

    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          ...(supportsFallbacks(req.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content }],
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
        },
        { timeout: req.timeoutMs, maxRetries: req.maxRetries ?? 2 },
      );
    } catch (err) {
      const usage = { ...emptyUsage(), duration_ms: Date.now() - started, calls: 1 };
      if (err instanceof Anthropic.APIError) {
        const retryable = err.status === undefined || err.status === 429 || err.status >= 500;
        throw new ModelCallError(`Model API error ${err.status ?? "connection"}: ${err.message}`, retryable, usage);
      }
      const message = (err as Error).message ?? String(err);
      // Output that doesn't match the schema surfaces as a parse error; another attempt can succeed.
      throw new ModelCallError(`Model output couldn't be parsed: ${message}`, true, usage);
    }

    const u = response.usage;
    const usage: CallUsage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      duration_ms: Date.now() - started,
      calls: 1,
    };

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "unspecified";
      throw new ModelCallError(`The model declined this request (category: ${category}).`, false, usage);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelCallError(`The model ran out of output tokens (max_tokens ${req.maxTokens}).`, true, usage);
    }
    if (response.parsed_output == null) {
      throw new ModelCallError("The model returned no structured output.", true, usage);
    }
    return { output: response.parsed_output as z.infer<S>, usage, model: response.model };
  }
}
