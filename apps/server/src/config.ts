import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");
const int = (def: number) => z.coerce.number().int().positive().default(def);
const score = (def: number) => z.coerce.number().int().min(0).max(100).default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Public base URL of this app. Falls back to Render's RENDER_EXTERNAL_URL. */
  APP_URL: optionalString,
  RENDER_EXTERNAL_URL: optionalString,
  /** Extra origins allowed to call the cookie-authenticated API (e.g. Vite dev server). */
  DEV_WEB_ORIGIN: optionalString,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  LOG_LEVEL: z.string().default("info"),

  // Externally hosted SDK (built in a separate project). Unset ⇒ snippet is a setup preview.
  SDK_SCRIPT_URL: optionalString,

  // Access & pricing (configurable). One paid purchase or code = study credits.
  PAID_STUDY_PRICE_MINOR: z.coerce.number().int().nonnegative().default(9900),
  PAID_STUDY_CURRENCY: z.string().default("INR"),
  PAID_STUDY_CREDITS: int(1),
  PAID_PARTICIPANT_CAP: int(5),
  /** Admin client review: when a builder is flagged as stuck. */
  ADMIN_FLAG_NO_WEBSITE_DAYS: int(3),
  ADMIN_FLAG_NOT_CONNECTED_DAYS: int(2),
  ADMIN_FLAG_NO_ATTEMPTS_HOURS: int(48),
  /** Live/sandbox checkout opens ONLY when this is true AND Pine Labs is implemented + configured. */
  PAYMENTS_ENABLED: bool,
  /**
   * Direct UPI payments to this ID (e.g. name@bank). Payments are confirmed MANUALLY by an admin
   * after checking the UPI app; no credit is granted before that.
   */
  UPI_PAYEE_VPA: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
    .refine((v) => v === undefined || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(v), "UPI_PAYEE_VPA must look like name@bank"),
  UPI_PAYEE_NAME: z.string().default("First Five"),
  DEFAULT_CODE_STUDY_CREDITS: int(1),
  DEFAULT_CODE_PARTICIPANT_CAP: int(5),
  /** Unlaunched draft studies an entitled account may hold at once. */
  MAX_DRAFT_STUDIES: int(10),

  // Retention and scheduling.
  EVENT_RETENTION_DAYS: int(30),
  OUTBOX_RETENTION_DAYS: int(14),
  SWEEP_INTERVAL_SECONDS: int(60),
  /** How long a cached PostHog dashboard snapshot is served before a background refresh. */
  ANALYTICS_SNAPSHOT_TTL_SECONDS: int(300),
  DISABLE_SCHEDULER: bool,

  // PostHog Cloud.
  /** Ingestion host, e.g. https://us.i.posthog.com or https://eu.i.posthog.com */
  POSTHOG_HOST: optionalString,
  /** Private API host for queries, e.g. https://us.posthog.com. Derived from POSTHOG_HOST when unset. */
  POSTHOG_API_HOST: optionalString,
  POSTHOG_PROJECT_API_KEY: optionalString,
  POSTHOG_PERSONAL_API_KEY: optionalString,
  POSTHOG_PROJECT_ID: optionalString,

  // UX Director (in house): Claude models via the Anthropic API, or Gemini as an alternative.
  UX_DIRECTOR_PROVIDER: z.enum(["anthropic", "gemini"]).default("anthropic"),
  ANTHROPIC_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  /** Per-step models; unset means the provider's default (see UX_DIRECTOR_DEFAULT_MODEL). */
  UX_DIRECTOR_MODEL_Q2: optionalString,
  UX_DIRECTOR_MODEL_MAP: optionalString,
  UX_DIRECTOR_MODEL_REDUCE: optionalString,
  UX_DIRECTOR_MODEL_SCORE: optionalString,
  /** How long the interview waits for a contextual question before showing the fallback. */
  UX_DIRECTOR_Q2_TIMEOUT_MS: int(8000),
  /** An analysis that hasn't finished within this budget fails with a re-run message. */
  UX_DIRECTOR_RUN_BUDGET_MS: int(600_000),
  /** Findings / recommendations scoring below these (0–100) are dropped. */
  UX_DIRECTOR_FINDING_THRESHOLD: score(60),
  UX_DIRECTOR_RECOMMENDATION_THRESHOLD: score(60),

  // Pine Labs (future integration).
  PINELABS_ENV: z.enum(["uat", "live"]).default("uat"),
  PINELABS_BASE_URL: optionalString,
  PINELABS_CLIENT_ID: optionalString,
  PINELABS_CLIENT_SECRET: optionalString,
  PINELABS_MERCHANT_ID: optionalString,
  PINELABS_WEBHOOK_SECRET: optionalString,
});

/** Claude defaults to Sonnet for every step (half Opus's price); set UX_DIRECTOR_MODEL_* to move a step to Opus or Haiku. */
export const UX_DIRECTOR_DEFAULT_MODEL = { anthropic: "claude-sonnet-5-5", gemini: "gemini-3.8-flash" } as const;
/** Gemini scoring defaults to Pro: the rubric judgments are the quality gate, and Pro is the stronger judge. */
export const UX_DIRECTOR_DEFAULT_SCORE_MODEL = { anthropic: "claude-sonnet-5-5", gemini: "gemini-3.1-pro-preview" } as const;

type UxDirectorModelKey = "UX_DIRECTOR_MODEL_Q2" | "UX_DIRECTOR_MODEL_MAP" | "UX_DIRECTOR_MODEL_REDUCE" | "UX_DIRECTOR_MODEL_SCORE";

export type Env = Omit<z.infer<typeof EnvSchema>, UxDirectorModelKey> & Record<UxDirectorModelKey, string>;

export interface AppConfig extends Env {
  appUrl: string;
  appOrigin: string;
  isProduction: boolean;
  secureCookies: boolean;
  /** Origins permitted to make cookie-authenticated, state-changing requests. */
  trustedWebOrigins: string[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const defaultModel = UX_DIRECTOR_DEFAULT_MODEL[parsed.data.UX_DIRECTOR_PROVIDER];
  const env: Env = {
    ...parsed.data,
    UX_DIRECTOR_MODEL_Q2: parsed.data.UX_DIRECTOR_MODEL_Q2 ?? defaultModel,
    UX_DIRECTOR_MODEL_MAP: parsed.data.UX_DIRECTOR_MODEL_MAP ?? defaultModel,
    UX_DIRECTOR_MODEL_REDUCE: parsed.data.UX_DIRECTOR_MODEL_REDUCE ?? defaultModel,
    UX_DIRECTOR_MODEL_SCORE: parsed.data.UX_DIRECTOR_MODEL_SCORE ?? UX_DIRECTOR_DEFAULT_SCORE_MODEL[parsed.data.UX_DIRECTOR_PROVIDER],
  };
  // the Render env group names the PostHog project token POSTHOG_PROJECT_TOKEN
  if (!env.POSTHOG_PROJECT_API_KEY && source.POSTHOG_PROJECT_TOKEN) env.POSTHOG_PROJECT_API_KEY = source.POSTHOG_PROJECT_TOKEN;
  const appUrl = (env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "");
  const appOrigin = new URL(appUrl).origin;
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL (or RENDER_EXTERNAL_URL) must use https in production");
  }
  const trustedWebOrigins = [appOrigin];
  if (env.DEV_WEB_ORIGIN && !isProduction) trustedWebOrigins.push(new URL(env.DEV_WEB_ORIGIN).origin);
  return {
    ...env,
    appUrl,
    appOrigin,
    isProduction,
    secureCookies: appUrl.startsWith("https://"),
    trustedWebOrigins,
  };
}
