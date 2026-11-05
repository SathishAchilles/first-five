/**
 * Gemini alternative to ModelClient for UX Director steps, behind
 * UX_DIRECTOR_PROVIDER=gemini. Same contract: schema-constrained JSON
 * (zod v4 → JSON Schema, re-validated locally), effort as thinking level,
 * bounded retries on 429/5xx/network errors, and usage/duration capture.
 * Gemini caches repeated prefixes implicitly, so the prefix simply goes first.
 */
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import { z } from "zod/v4";
import { emptyUsage, ModelCallError, type CallUsage, type Effort, type ModelRequest, type ModelResult } from "./model";

const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** Finish reasons that another attempt won't change. */
const BLOCKED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

const schemaCache = new WeakMap<z.ZodType, unknown>();

function jsonSchema(schema: z.ZodType): unknown {
  let cached = schemaCache.get(schema);
  if (!cached) {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
    cached = rest;
    schemaCache.set(schema, cached);
  }
  return cached;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiModelClient {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async call<S extends z.ZodType>(req: ModelRequest<S>): Promise<ModelResult<z.infer<S>>> {
    const started = Date.now();
    const maxRetries = req.maxRetries ?? 2;
    const parts = [...(req.prefix ? [{ text: req.prefix }] : []), { text: req.input }];

    let response: GenerateContentResponse | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.client.models.generateContent({
          model: req.model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxTokens,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema(req.schema),
            thinkingConfig: { thinkingLevel: THINKING[req.effort] },
            httpOptions: { timeout: req.timeoutMs },
          },
        });
        break;
      } catch (err) {
        const status = err instanceof ApiError ? err.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (retryable && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const usage = { ...emptyUsage(), duration_ms: Date.now() - started, calls: 1 };
        throw new ModelCallError(`Model API error ${status ?? "connection"}: ${(err as Error).message}`, retryable, usage);
      }
    }

    const u = response.usageMetadata;
    const cached = u?.cachedContentTokenCount ?? 0;
    // Match the Anthropic meaning: input excludes cache reads, output includes thinking.
    const usage: CallUsage = {
      input_tokens: (u?.promptTokenCount ?? 0) - cached,
      output_tokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
      duration_ms: Date.now() - started,
      calls: 1,
    };

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) throw new ModelCallError(`The model declined this request (category: ${blockReason}).`, false, usage);
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && BLOCKED.has(finish)) throw new ModelCallError(`The model declined this request (category: ${finish}).`, false, usage);
    if (finish === FinishReason.MAX_TOKENS) {
      throw new ModelCallError(`The model ran out of output tokens (max_tokens ${req.maxTokens}).`, true, usage);
    }

    const text = response.text;
    if (!text) throw new ModelCallError("The model returned no structured output.", true, usage);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new ModelCallError(`Model output couldn't be parsed: ${(err as Error).message}`, true, usage);
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelCallError(`Model output couldn't be parsed: ${parsed.error.message}`, true, usage);
    }
    return { output: parsed.data as z.infer<S>, usage, model: response.modelVersion ?? req.model };
  }
}
