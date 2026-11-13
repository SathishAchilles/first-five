import type { FastifyInstance } from "fastify";
import { LoginSchema, RedeemCodeSchema, SignupSchema } from "@firstfive/shared";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireUser, userId } from "../http";
import { AppError } from "../lib/errors";
import { audit } from "../lib/audit";
import { safeEqualHex, sha256 } from "../lib/crypto";
import { checkCode, redeemCode } from "../services/access-codes";
import { createAuthSession, destroyAuthSession, login, SESSION_COOKIE, signup } from "../services/auth";
import { getEntitlement } from "../services/entitlements";
import { createCheckout, getOrderStatus, paidOffer } from "../services/payments";
import { submitUtr } from "../services/upi";

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const setSessionCookie = (reply: import("fastify").FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: ctx.config.secureCookies,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

  const me = async (id: string, impersonation: { expiresAt: Date } | null = null) => {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id } });
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
      entitlement: await getEntitlement(ctx.db, ctx.config, user.id),
      impersonation: impersonation ? { clientEmail: user.email, expiresAt: impersonation.expiresAt.toISOString() } : null,
    };
  };

  app.post(
    "/api/auth/signup",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const input = SignupSchema.parse(req.body);
      if (input.invitationCode) await checkCode(ctx, input.invitationCode);
      const user = await signup(ctx, input);
      let redemption: { planName: string } | null = null;
      let redemptionError: string | null = null;
      if (input.invitationCode) {
        try {
          redemption = await redeemCode(ctx, user.id, input.invitationCode);
        } catch (err) {
          redemptionError = err instanceof AppError ? err.message : "We couldn't apply your invitation code.";
        }
      }
      const { token, expiresAt } = await createAuthSession(ctx, user.id, req.headers["user-agent"]);
      setSessionCookie(reply, token, expiresAt);
      return reply.status(201).send({ ...(await me(user.id)), redemption, redemptionError });
    },
  );

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
          keyGenerator: (req) => `${req.ip}:${String((req.body as { email?: string })?.email ?? "").toLowerCase().slice(0, 254)}`,
        },
      },
    },
    async (req, reply) => {
      const input = LoginSchema.parse(req.body);
      const user = await login(ctx, input);
      const { token, expiresAt } = await createAuthSession(ctx, user.id, req.headers["user-agent"]);
      setSessionCookie(reply, token, expiresAt);
      return me(user.id);
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    await destroyAuthSession(ctx, req.authToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => me(userId(req), req.impersonation));

  app.patch("/api/account", { preHandler: requireUser }, async (req) => {
    const input = z.object({ name: z.string().trim().max(80) }).parse(req.body);
    await ctx.db.user.update({ where: { id: userId(req) }, data: { name: input.name || null } });
    return me(userId(req));
  });

  app.post(
    "/api/access/redeem",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes", keyGenerator: (req) => `redeem:${req.user?.id ?? req.ip}` } },
    },
    async (req) => {
      const { code } = RedeemCodeSchema.parse(req.body);
      const result = await redeemCode(ctx, userId(req), code);
      return { redemption: result, ...(await me(userId(req))) };
    },
  );

  /**
   * One-time operator bootstrap: a signed-in user who knows ADMIN_BOOTSTRAP_TOKEN becomes the first admin.
   * Disabled when the token isn't configured or any admin already exists.
   */
  app.post(
    "/api/admin-bootstrap",
    { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req) => {
      const { token } = z.object({ token: z.string().min(1).max(200) }).parse(req.body);
      const expected = ctx.config.ADMIN_BOOTSTRAP_TOKEN;
      if (!expected) throw new AppError(404, "not_found", "Admin setup isn't enabled on this server.");
      if ((await ctx.db.user.count({ where: { role: "admin" } })) > 0) {
        throw new AppError(409, "already_configured", "An admin already exists. This setup link is no longer active.");
      }
      if (!safeEqualHex(sha256(token), sha256(expected))) throw new AppError(403, "invalid_token", "That setup token isn't correct.");
      await ctx.db.user.update({ where: { id: userId(req) }, data: { role: "admin" } });
      await audit(ctx.db, { actorUserId: userId(req), actorType: "user", action: "user.admin_bootstrapped", resourceType: "user", resourceId: userId(req) });
      return me(userId(req));
    },
  );

  app.get("/api/billing/offer", async () => ({ offer: paidOffer(ctx) }));

  app.post("/api/payments/checkout", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const { planKey } = z.object({ planKey: z.string().default("single_study") }).parse(req.body ?? {});
    return createCheckout(ctx, userId(req), planKey);
  });

  app.post(
    "/api/payments/orders/:id/upi-reference",
    { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      await submitUtr(ctx, userId(req), id, req.body);
      return getOrderStatus(ctx, userId(req), id);
    },
  );

  app.get("/api/payments/orders/:id", { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return getOrderStatus(ctx, userId(req), id);
  });
}
