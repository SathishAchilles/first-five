import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import type { AppContext } from "./context";
import type { Db } from "./db";
import { errorHandler } from "./http";
import { createProviders, type Providers } from "./integrations/registry";
import { AppError } from "./lib/errors";
import { adminRoutes } from "./routes/admin";
import { adminClientRoutes } from "./routes/admin-clients";
import { adminImpersonationRoutes } from "./routes/admin-impersonation";
import { authRoutes } from "./routes/auth";
import { growthRoutes } from "./routes/growth";
import { projectRoutes } from "./routes/projects";
import { publicRoutes } from "./routes/public";
import { sdkRoutes } from "./routes/sdk";
import { studyRoutes } from "./routes/studies";
import { audit } from "./lib/audit";
import { ADMIN_RETURN_COOKIE, resolveAuthSession, SESSION_COOKIE } from "./services/auth";
import { handleWebhook } from "./services/payments";

export interface BuildOptions {
  config: AppConfig;
  db: Db;
  providers?: Providers;
  webDistDir?: string | null;
  logger?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config, db } = opts;
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 256 * 1024,
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-ff-feedback"]', 'res.headers["set-cookie"]'],
              censor: "[redacted]",
            },
          },
    genReqId: () => crypto.randomUUID(),
  });

  const ctx: AppContext = { config, db, providers: opts.providers ?? createProviders(config), log: app.log };

  app.setErrorHandler(errorHandler);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: config.secureCookies ? { maxAge: 15552000, includeSubDomains: false } : false,
  });

  app.decorateRequest("user", null);
  app.decorateRequest("authToken", undefined);
  app.decorateRequest("impersonation", null);

  // Identify the builder from the session cookie.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/sdk/")) return;
    const token = req.cookies[SESSION_COOKIE];
    req.authToken = token;
    let expired: { userId: string; impersonatorUserId: string | null } | null = null;
    const session = await resolveAuthSession(ctx, token, { onExpired: (s) => (expired = s) });
    req.user = session?.user ?? null;
    req.impersonation = session?.impersonatorUserId ? { adminId: session.impersonatorUserId, expiresAt: session.expiresAt } : null;

    // A "view as client" session ran out: put the admin's own session back without a new login.
    const returnToken = req.cookies[ADMIN_RETURN_COOKIE];
    if (session || !returnToken) return;
    const own = await resolveAuthSession(ctx, returnToken);
    reply.clearCookie(ADMIN_RETURN_COOKIE, { path: "/" });
    if (!own || own.readOnly || own.user.role !== "superadmin") return;
    req.user = own.user;
    req.authToken = returnToken;
    reply.setCookie(SESSION_COOKIE, returnToken, { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", expires: own.expiresAt });
    const ended = expired as { userId: string; impersonatorUserId: string | null } | null;
    if (ended?.impersonatorUserId) {
      await audit(db, {
        actorUserId: ended.impersonatorUserId,
        actorType: "admin",
        action: "admin.impersonation_stopped",
        resourceType: "user",
        resourceId: ended.userId,
        metadata: { clientId: ended.userId, reason: "expired" },
      });
    }
  });

  // "View as client" is read-only: every write is refused on the server, except stopping the view.
  // Tester pages and payment webhooks are not part of the builder app and are left alone.
  app.addHook("onRequest", async (req) => {
    if (!req.impersonation || SAFE_METHODS.has(req.method) || !req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/public/") || req.url.startsWith("/api/payments/webhook/")) return;
    if (req.method === "DELETE" && req.url.split("?")[0] === "/api/admin/impersonation") return;
    throw new AppError(403, "read_only_view", "You're viewing this account as an admin. This view is read-only.");
  });

  // CSRF defence: state-changing requests that carry First Five cookies must come from our own origin.
  app.addHook("onRequest", async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/sdk/") || req.url.startsWith("/api/payments/webhook/")) return;
    const hasCookie = Object.keys(req.cookies ?? {}).some((k) => k === SESSION_COOKIE || k === "ff_vid" || k.startsWith("ff_p_"));
    if (!hasCookie) return;
    const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
    if (!origin || !config.trustedWebOrigins.includes(origin)) {
      throw new AppError(403, "csrf_rejected", "This request didn't come from First Five.");
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ready", database: "ok" };
    } catch {
      return reply.status(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  await app.register(async (scoped) => authRoutes(scoped, ctx));
  await app.register(async (scoped) => growthRoutes(scoped, ctx));
  await app.register(async (scoped) => projectRoutes(scoped, ctx));
  await app.register(async (scoped) => studyRoutes(scoped, ctx));
  await app.register(async (scoped) => publicRoutes(scoped, ctx));
  await app.register(async (scoped) => sdkRoutes(scoped, ctx));
  await app.register(async (scoped) => adminRoutes(scoped, ctx));
  await app.register(async (scoped) => adminClientRoutes(scoped, ctx));
  await app.register(async (scoped) => adminImpersonationRoutes(scoped, ctx));
  await app.register(async (scoped) => {
    // Raw body is required for signature verification.
    scoped.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scoped.post("/api/payments/webhook/pinelabs", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
      handleWebhook(ctx, String(req.body ?? ""), req.headers),
    );
  });

  app.all("/api/*", async () => {
    throw new AppError(404, "not_found", "Not found.");
  });

  const webDist = opts.webDistDir === undefined ? defaultWebDist() : opts.webDistDir;
  if (webDist && existsSync(resolve(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, serve: false });
    // Vite emits content-hashed file names under /assets, so they can be cached forever.
    app.get("/assets/*", (req, reply) => reply.sendFile(req.url.replace(/^\//, "").split("?")[0]!, { maxAge: 31536000000, immutable: true }));
    // SPA fallback: every non-API route renders the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.url.startsWith("/api/")) {
        return reply.status(404).send({ error: { code: "not_found", message: "Not found." } });
      }
      const file = req.url.split("?")[0]!.replace(/^\//, "");
      if (file && /\.[a-z0-9]{2,5}$/i.test(file) && existsSync(resolve(webDist, file))) return reply.sendFile(file);
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }

  return { app, ctx };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function defaultWebDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../../web/dist ; src/app.ts → ../../web/dist
  return resolve(here, "../../web/dist");
}
