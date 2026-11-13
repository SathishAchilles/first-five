import type { FastifyInstance } from "fastify";
import { GenerateCodesSchema } from "@firstfive/shared";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireSuperadmin, userId } from "../http";
import { listProviderStatuses, PROVIDER_KEYS, verifyProvider } from "../integrations/registry";
import { disableCode, generateCodes, toCodeDto } from "../services/access-codes";
import { audit } from "../lib/audit";
import { runMaintenance } from "../services/maintenance";
import { confirmUpiPayment, listPaymentsForAdmin, rejectUpiPayment } from "../services/upi";

/** Superadmin API. Everyone else receives 404 so the surface isn't advertised. */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", requireSuperadmin);

  app.get("/api/admin/integrations", async () => ({ providers: await listProviderStatuses(ctx.config, ctx.db) }));

  app.post("/api/admin/integrations/:provider/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { provider } = z.object({ provider: z.enum(PROVIDER_KEYS as [string, ...string[]]) }).parse(req.params);
    const result = await verifyProvider(ctx.config, ctx.db, ctx.providers, provider as (typeof PROVIDER_KEYS)[number]);
    await audit(ctx.db, { actorUserId: userId(req), actorType: "admin", action: "integration.verified", resourceType: "provider", resourceId: provider, metadata: { status: result.status } });
    return { result, providers: await listProviderStatuses(ctx.config, ctx.db) };
  });

  app.get("/api/admin/codes", async () => {
    const codes = await ctx.db.invitationCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return { codes: codes.map(toCodeDto) };
  });

  app.post("/api/admin/codes", async (req, reply) => {
    const input = GenerateCodesSchema.parse(req.body);
    const result = await generateCodes(ctx, { ...input, createdById: userId(req) });
    return reply.status(201).send(result);
  });

  app.post("/api/admin/codes/:id/disable", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return disableCode(ctx, userId(req), id);
  });

  app.get("/api/admin/payments", async () => ({ payments: await listPaymentsForAdmin(ctx) }));

  app.post("/api/admin/payments/:id/confirm", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await confirmUpiPayment(ctx, userId(req), id);
    return { payments: await listPaymentsForAdmin(ctx) };
  });

  app.post("/api/admin/payments/:id/reject", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await rejectUpiPayment(ctx, userId(req), id);
    return { payments: await listPaymentsForAdmin(ctx) };
  });

  app.post("/api/admin/maintenance", async () => runMaintenance(ctx));

  app.get("/api/admin/overview", async () => {
    // Real counts, reported separately by population. Waitlist leads are never counted as product users,
    // and sandbox (UAT) payments are never counted as revenue.
    const [leads, accounts, entitledAccounts, redeemedCodes, uatPaid, livePaid, projects, connected, launchedStudies, attempts, finalized, feedback, published] = await Promise.all([
      ctx.db.waitlistLead.count(),
      ctx.db.user.count({ where: { role: "account_admin" } }),
      ctx.db.user.count({ where: { role: "account_admin", accessGrants: { some: { revokedAt: null } } } }),
      ctx.db.invitationCodeRedemption.count(),
      ctx.db.order.count({ where: { environment: "uat", status: "paid_verified" } }),
      ctx.db.order.count({ where: { environment: "live", status: "paid_verified" } }),
      ctx.db.project.count(),
      ctx.db.project.count({ where: { integrationStatus: "connected" } }),
      ctx.db.study.count({ where: { launchedAt: { not: null } } }),
      ctx.db.studySession.count({ where: { isRepeat: false, status: { not: "invalid" } } }),
      ctx.db.studySession.count({ where: { isRepeat: false, status: { in: ["completed", "dropped"] } } }),
      ctx.db.studySession.count({ where: { feedbackStatus: "submitted" } }),
      ctx.db.report.count({ where: { status: "published" } }),
    ]);
    const funnelRows = await ctx.db.conversionEvent.groupBy({ by: ["name", "environment"], _count: { _all: true } });
    const funnel: Record<string, { production: number; other: number }> = {};
    for (const r of funnelRows) {
      const f = (funnel[r.name] ??= { production: 0, other: 0 });
      if (r.environment === "production") f.production += r._count._all;
      else f.other += r._count._all;
    }
    return {
      acquisition: { waitlistLeads: leads, registeredAccounts: accounts, accountsWithAccess: entitledAccounts, redeemedCodes },
      payments: { uatVerifiedOrders: uatPaid, liveVerifiedOrders: livePaid },
      activation: { projects, connectedWebsites: connected, launchedStudies },
      participants: { validAttempts: attempts, finalizedAttempts: finalized, attemptsWithFeedback: feedback },
      reports: { published },
      funnel,
    };
  });
}
