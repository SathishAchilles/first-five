import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireSuperadmin, userId } from "../http";
import { audit } from "../lib/audit";
import { assertClient, getClientDetail, listClients } from "../services/admin-clients";
import * as support from "../services/admin-support";
import * as dashboard from "../services/dashboard";
import * as reports from "../services/reports";
import * as studies from "../services/studies";

const FLAGS = ["no_website", "not_connected", "no_attempts", "report_failed", "payment_pending", "no_access"] as const;

const ListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  flags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(FLAGS))),
  access: z.enum(["any", "active", "none"]).optional(),
  sort: z.enum(["signed_up", "last_seen", "attempts"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
const ClientParam = z.object({ id: z.string().uuid() });
const StudyParam = ClientParam.extend({ studyId: z.string().uuid() });
const SessionParam = ClientParam.extend({ sessionId: z.string().uuid() });
const ReportParam = ClientParam.extend({ reportId: z.string().uuid() });
const GrantParam = ClientParam.extend({ grantId: z.string().uuid() });

/**
 * Admin client review. Reads go through the builder's own owner-scoped services,
 * called with the client's id, so the admin sees exactly what the builder sees.
 */
export async function adminClientRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", requireSuperadmin);

  app.get("/api/admin/clients", async (req) => listClients(ctx, ListQuery.parse(req.query)));

  app.get("/api/admin/clients/:id", async (req) => getClientDetail(ctx, ClientParam.parse(req.params).id));

  app.get("/api/admin/clients/:id/studies/:studyId", async (req) => {
    const p = StudyParam.parse(req.params);
    await assertClient(ctx, p.id);
    return studies.getStudyDetail(ctx, p.id, p.studyId);
  });

  app.get("/api/admin/clients/:id/studies/:studyId/sessions", async (req) => {
    const p = StudyParam.parse(req.params);
    await assertClient(ctx, p.id);
    return { sessions: await dashboard.listSessions(ctx, p.id, p.studyId, {}) };
  });

  app.get("/api/admin/clients/:id/sessions/:sessionId", async (req) => {
    const p = SessionParam.parse(req.params);
    await assertClient(ctx, p.id);
    const detail = await dashboard.getSessionDetail(ctx, p.id, p.sessionId);
    // Testers are the client's users, not ours: every admin read of their session is recorded.
    await audit(ctx.db, {
      actorUserId: userId(req),
      actorType: "admin",
      action: "admin.session_viewed",
      resourceType: "study_session",
      resourceId: p.sessionId,
      metadata: { clientId: p.id },
    });
    return detail;
  });

  app.get("/api/admin/clients/:id/reports/:reportId", async (req) => {
    const p = ReportParam.parse(req.params);
    await assertClient(ctx, p.id);
    return reports.getReportDetail(ctx, p.id, p.reportId);
  });

  // ── Support actions: each needs a reason and is audited with before/after values. ──

  app.post("/api/admin/clients/:id/grants", async (req, reply) => {
    const p = ClientParam.parse(req.params);
    return reply.status(201).send(await support.grantAccess(ctx, userId(req), p.id, req.body));
  });

  app.post("/api/admin/clients/:id/websites", async (req, reply) => {
    const p = ClientParam.parse(req.params);
    return reply.status(201).send(await support.addWebsite(ctx, userId(req), p.id, req.body));
  });

  app.post("/api/admin/clients/:id/grants/:grantId/revoke", async (req) => {
    const p = GrantParam.parse(req.params);
    return support.revokeGrant(ctx, userId(req), p.id, p.grantId, req.body);
  });

  app.post("/api/admin/clients/:id/grants/:grantId/credits", async (req) => {
    const p = GrantParam.parse(req.params);
    return support.addCredits(ctx, userId(req), p.id, p.grantId, req.body);
  });

  app.post("/api/admin/clients/:id/studies/:studyId/extend", async (req) => {
    const p = StudyParam.parse(req.params);
    return support.extendStudy(ctx, userId(req), p.id, p.studyId, req.body);
  });

  app.post("/api/admin/clients/:id/studies/:studyId/rerun-report", async (req) => {
    const p = StudyParam.parse(req.params);
    return support.rerunReport(ctx, userId(req), p.id, p.studyId, req.body);
  });
}
