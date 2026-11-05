import type { ProviderStatusDto } from "@firstfive/shared";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { InHouseUxDirector, uxDirectorKeyName, type UxDirectorProvider } from "./ux-director";
import { PineLabsAdapter, type PaymentProvider } from "./pinelabs";
import { PostHogAdapter, type AnalyticsProvider, type HealthResult } from "./posthog";

export interface Providers {
  analytics: AnalyticsProvider;
  uxDirector: UxDirectorProvider;
  payments: PaymentProvider;
}

export function createProviders(config: AppConfig): Providers {
  return {
    analytics: new PostHogAdapter(config),
    uxDirector: new InHouseUxDirector(config),
    payments: new PineLabsAdapter(config),
  };
}

export type ProviderKey = ProviderStatusDto["provider"];
export const PROVIDER_KEYS: ProviderKey[] = ["postgres", "sdk", "posthog", "ux_director", "pinelabs"];

const META: Record<ProviderKey, { name: string; description: string; keys: (keyof AppConfig)[] }> = {
  postgres: {
    name: "Render PostgreSQL",
    description: "Authoritative store for accounts, studies, task outcomes, feedback and reports.",
    keys: ["DATABASE_URL"],
  },
  sdk: {
    name: "First Five SDK (separate project)",
    description: "Externally hosted browser script. This app only generates snippets and exposes the SDK API contract.",
    keys: ["SDK_SCRIPT_URL"],
  },
  posthog: {
    name: "PostHog Cloud",
    description: "Detailed behavioral analytics: paths, funnels and event timelines.",
    keys: ["POSTHOG_HOST", "POSTHOG_PROJECT_API_KEY", "POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID"],
  },
  ux_director: {
    name: "UX Director (First Five)",
    description: "Contextual interview questions and rubric-scored research findings, using Claude Sonnet 5.5 by default (or Gemini).",
    keys: ["ANTHROPIC_API_KEY"],
  },
  pinelabs: {
    name: "Pine Labs",
    description: "Hosted checkout for paid access.",
    keys: ["PINELABS_BASE_URL", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_MERCHANT_ID", "PINELABS_WEBHOOK_SECRET"],
  },
};

/** The UX Director's key follows UX_DIRECTOR_PROVIDER. */
function providerKeys(config: AppConfig, key: ProviderKey): (keyof AppConfig)[] {
  return key === "ux_director" ? [uxDirectorKeyName(config)] : META[key].keys;
}

function envConfigured(config: AppConfig, key: ProviderKey): boolean {
  return providerKeys(config, key).every((k) => Boolean(config[k]));
}

/**
 * Status = configuration presence + the result of the last *real* verification.
 * Entering settings alone never yields "verified".
 */
export async function listProviderStatuses(config: AppConfig, db: Db): Promise<ProviderStatusDto[]> {
  const rows = await db.providerConnection.findMany();
  const byKey = new Map(rows.map((r) => [r.provider, r]));
  const uxUsage = await recentUxDirectorUsage(db);
  return PROVIDER_KEYS.map((key) => {
    const row = byKey.get(key);
    const configured = envConfigured(config, key);
    let status: ProviderStatusDto["status"] = configured ? "configured" : "not_configured";
    if (configured && row && row.status !== "not_configured") status = row.status;
    return {
      provider: key,
      name: META[key].name,
      description: META[key].description,
      status,
      configuredKeys: providerKeys(config, key).map((k) => ({ key: String(k), present: Boolean(config[k]) })),
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastError: configured ? (row?.lastError ?? null) : null,
      details: key === "ux_director" ? { ...((row?.details as Record<string, unknown> | null) ?? {}), recentUsage: uxUsage } : ((row?.details as Record<string, unknown> | null) ?? null),
    };
  });
}

/** Token usage of UX Director runs in the last 7 days, for the admin cost view. */
async function recentUxDirectorUsage(db: Db) {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const runs = await db.agentRun.findMany({ where: { provider: "ux_director", startedAt: { gte: since } }, select: { kind: true, status: true, details: true } });
  const total = { analyses: 0, questions: 0, failed: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  for (const r of runs) {
    if (r.kind === "study_analysis") total.analyses++;
    else if (r.kind === "contextual_question") total.questions++;
    if (r.status === "failed") total.failed++;
    const u = (r.details as { usage?: Record<string, number> } | null)?.usage;
    if (u) {
      total.input_tokens += u.input_tokens ?? 0;
      total.output_tokens += u.output_tokens ?? 0;
      total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    }
  }
  return total;
}

export async function providerStatus(config: AppConfig, db: Db, key: ProviderKey): Promise<ProviderStatusDto["status"]> {
  const all = await listProviderStatuses(config, db);
  return all.find((p) => p.provider === key)!.status;
}

/** Runs an actual provider test and records the outcome. */
export async function verifyProvider(
  config: AppConfig,
  db: Db,
  providers: Providers,
  key: ProviderKey,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  let result: HealthResult;
  switch (key) {
    case "postgres":
      try {
        await db.$queryRaw`SELECT 1`;
        result = { ok: true, status: "verified", message: "Database query succeeded." };
      } catch (err) {
        result = { ok: false, status: "error", message: `Database query failed: ${(err as Error).message}` };
      }
      break;
    case "sdk":
      result = await verifySdkScript(config, db, fetchImpl);
      break;
    case "posthog":
      result = await providers.analytics.verifyRoundTrip();
      break;
    case "ux_director": {
      const run = await db.agentRun.create({ data: { provider: "ux_director", kind: "verification", status: "running" } });
      result = await providers.uxDirector.healthCheck();
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: result.ok ? "completed" : "failed", error: result.ok ? null : result.message.slice(0, 2000), details: (result.details ?? {}) as object, finishedAt: new Date() },
      });
      result = { ...result, message: `${result.message} Run ${run.id}.`, details: { ...result.details, runId: run.id } };
      break;
    }
    case "pinelabs":
      result = await providers.payments.healthCheck();
      break;
  }
  const now = new Date();
  await db.providerConnection.upsert({
    where: { provider: key },
    create: {
      provider: key,
      status: result.status,
      lastCheckedAt: now,
      lastSuccessAt: result.ok ? now : null,
      lastError: result.ok ? null : result.message,
      details: (result.details ?? { message: result.message }) as object,
    },
    update: {
      status: result.status,
      lastCheckedAt: now,
      ...(result.ok ? { lastSuccessAt: now, lastError: null } : { lastError: result.message }),
      details: (result.details ?? { message: result.message }) as object,
    },
  });
  return result;
}

async function verifySdkScript(config: AppConfig, db: Db, fetchImpl: typeof fetch): Promise<HealthResult> {
  if (!config.SDK_SCRIPT_URL) {
    return { ok: false, status: "not_configured", message: "SDK_SCRIPT_URL isn't set; snippets are shown as a setup preview." };
  }
  let scriptOk = false;
  let detail = "";
  try {
    const res = await fetchImpl(config.SDK_SCRIPT_URL, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    scriptOk = res.ok && /javascript|ecmascript/.test(type);
    detail = `HTTP ${res.status}, content-type ${type || "unknown"}`;
  } catch (err) {
    detail = (err as Error).message;
  }
  if (!scriptOk) return { ok: false, status: "error", message: `SDK script not reachable as JavaScript (${detail}).` };
  const connected = await db.project.count({ where: { integrationStatus: "connected" } });
  if (connected === 0) {
    return {
      ok: false,
      status: "verification_pending",
      message: "SDK script is reachable. No website has completed a verified setup walk yet.",
      details: { script: detail },
    };
  }
  return { ok: true, status: "verified", message: `SDK script reachable; ${connected} website(s) verified.`, details: { script: detail } };
}
