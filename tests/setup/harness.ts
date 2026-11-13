/**
 * Integration-test harness: builds the real Fastify app against the real
 * test PostgreSQL database and drives it with HTTP requests (app.inject).
 *
 * The `sdk` helpers below send requests the way the separately developed SDK
 * is specified to. They are CONTRACT FIXTURES — they prove the Render API
 * honours the contract, not that the real SDK works.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { inject } from "vitest";
import { buildApp } from "../../apps/server/src/app";
import { loadConfig, type AppConfig } from "../../apps/server/src/config";
import type { AppContext } from "../../apps/server/src/context";
import { createDb, type Db } from "../../apps/server/src/db";

export const APP_URL = "http://localhost:3000";
export const SITE = "https://acme-test.example.com";

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  db: Db;
  config: AppConfig;
  close: () => Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const url = inject("databaseUrl");
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url,
    APP_URL,
    SESSION_SECRET: "test-secret-test-secret-test-secret-0123",
    DISABLE_SCHEDULER: "true",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const db = createDb(url);
  const { app, ctx } = await buildApp({ config, db, logger: false, webDistDir: null });
  await app.ready();
  return {
    app,
    ctx,
    db,
    config,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

export async function resetDb(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

// ───────────────────────────── Builder client ─────────────────────────────

export class Client {
  cookies: Record<string, string> = {};
  constructor(private readonly app: FastifyInstance) {}

  private cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async req(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { origin: APP_URL, ...(Object.keys(this.cookies).length ? { cookie: this.cookieHeader() } : {}), ...headers },
    });
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (c.value === "" || (c.expires && c.expires.getTime() < Date.now())) delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  get = (url: string, headers?: Record<string, string>) => this.req("GET", url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req("POST", url, body, headers);
  patch = (url: string, body: unknown) => this.req("PATCH", url, body);
  put = (url: string, body: unknown) => this.req("PUT", url, body);
  del = (url: string, body?: unknown) => this.req("DELETE", url, body);
}

export function json<T = any>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

let counter = 0;
export async function signup(app: FastifyInstance, extra: Record<string, unknown> = {}) {
  const c = new Client(app);
  const email = `builder${++counter}-${Date.now()}@example.com`;
  const res = await c.post("/api/auth/signup", { email, password: "correct-horse-battery", ...extra });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return { client: c, email, me: json(res) };
}

/** Signs up and redeems a real complimentary code through the API (the same path judges use). */
export async function signupWithAccess(h: Harness, opts: { studyCredits?: number; participantCap?: number; extra?: Record<string, unknown> } = {}) {
  const { generateCodes } = await import("../../apps/server/src/services/access-codes");
  const { codes } = await generateCodes(h.ctx, {
    label: "test access",
    audience: "internal",
    planKey: "complimentary",
    studyCredits: opts.studyCredits ?? 1,
    participantCap: opts.participantCap ?? 5,
    count: 1,
    maxRedemptions: 1,
  });
  const s = await signup(h.app, opts.extra);
  const res = await s.client.post("/api/access/redeem", { code: codes[0] });
  if (res.statusCode !== 200) throw new Error(`redeem failed: ${res.body}`);
  return { ...s, me: json(res) };
}

/** Superadmins are granted only by the CLI; tests set the role directly the same way. */
export async function makeSuperadmin(db: Db, email: string) {
  await db.user.update({ where: { email }, data: { role: "superadmin" } });
}

// ───────────────────────────── SDK contract fixtures ─────────────────────────────

export function sdkEvent(base: { project_id: string; mode: "setup" | "live"; study_id?: string; session_id?: string }, seq: number, fields: Record<string, unknown>) {
  return {
    schema_version: 1,
    event_id: randomUUID(),
    client_sequence: seq,
    timestamp: new Date().toISOString(),
    ...base,
    ...fields,
  };
}

export async function sdkExchange(app: FastifyInstance, projectId: string, launchUrl: string, origin = SITE) {
  const ticket = new URL(launchUrl).hash.replace(/^#(ff_setup|ff_launch)=/, "");
  const res = await app.inject({ method: "POST", url: "/api/sdk/exchange", headers: { origin }, payload: { project_id: projectId, ticket } });
  return res;
}

export async function sdkEvents(app: FastifyInstance, credential: string, events: unknown[], origin = SITE) {
  return app.inject({
    method: "POST",
    url: "/api/sdk/events",
    headers: { origin, authorization: `Bearer ${credential}` },
    payload: { schema_version: 1, sdk_version: "contract-fixture", events },
  });
}

/** Builder creates a website and completes a setup walkthrough via contract fixtures. */
export async function connectedProject(app: FastifyInstance, client: Client, opts: { pages?: string[]; elements?: { page: string; id: string; label: string }[]; customEvents?: string[] } = {}) {
  const created = json(await client.post("/api/projects", { name: "Acme", websiteUrl: SITE }));
  const setup = json(await client.post(`/api/projects/${created.id}/setup-sessions`));
  const ex = json(await sdkExchange(app, created.publicId, setup.launchUrl));
  const base = { project_id: created.publicId, mode: "setup" as const };
  let seq = 0;
  const events: unknown[] = [];
  for (const p of opts.pages ?? ["/", "/signup", "/dashboard"]) events.push(sdkEvent(base, seq++, { event_name: "ff_page_viewed", page_path: p }));
  for (const e of opts.elements ?? [{ page: "/signup", id: "create-account", label: "Create account" }]) {
    events.push(sdkEvent(base, seq++, { event_name: "ff_element_discovered", page_path: e.page, element_id: e.id, element_type: "button", element_label: e.label }));
  }
  for (const name of opts.customEvents ?? []) events.push(sdkEvent(base, seq++, { event_name: "ff_custom_event", page_path: "/", custom_event_name: name }));
  const res = await sdkEvents(app, ex.credential, events);
  if (res.statusCode !== 200) throw new Error(`setup events failed: ${res.body}`);
  return { project: created, setupCredential: ex.credential as string };
}

export async function launchedStudy(app: FastifyInstance, client: Client, projectId: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post("/api/studies", {
    projectId,
    name: "Onboarding test",
    task: "Create an account and reach the dashboard.",
    startPath: "/signup",
    goalType: "page_reached",
    goalTarget: "/dashboard",
    timeLimitSeconds: 300,
    participantLimit: 5,
    ...overrides,
  });
  if (res.statusCode !== 201) throw new Error(`study create failed: ${res.body}`);
  const study = json(res);
  const launched = await client.post(`/api/studies/${study.id}/launch`);
  if (launched.statusCode !== 200) throw new Error(`launch failed: ${launched.body}`);
  return json(launched);
}

/** A participant in their own browser (own cookie jar) consents and starts. */
export async function startParticipant(app: FastifyInstance, studyPublicId: string) {
  const p = new Client(app);
  const res = await p.post(`/api/public/studies/${studyPublicId}/attempts`, { consent: true });
  return { participant: p, res, attempt: res.statusCode === 201 ? json(res) : null };
}

/** A participant starts, the SDK records two page views, and the attempt ends (finished or gave up). Returns the session's database id. */
export async function finishAttempt(h: Harness, project: { publicId: string }, study: { publicId: string }, reachGoal = true) {
  const p = await startParticipant(h.app, study.publicId);
  const ex = json(await sdkExchange(h.app, project.publicId, p.attempt.launchUrl));
  const base = { project_id: project.publicId, mode: "live" as const, study_id: study.publicId, session_id: p.attempt.sessionId };
  await sdkEvents(h.app, ex.credential, [
    sdkEvent(base, 0, { event_name: "ff_page_viewed", page_path: "/signup" }),
    sdkEvent(base, 1, { event_name: "ff_page_viewed", page_path: reachGoal ? "/dashboard" : "/pricing" }),
  ]);
  await h.app.inject({
    method: "POST",
    url: "/api/sdk/session/end",
    headers: { origin: SITE, authorization: `Bearer ${ex.credential}` },
    payload: { reason: reachGoal ? "finished" : "gave_up" },
  });
  const session = await h.db.studySession.findFirstOrThrow({ where: { publicId: p.attempt.sessionId } });
  return session.id;
}
