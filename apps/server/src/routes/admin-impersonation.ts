import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { requireSuperadmin, userId } from "../http";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { ADMIN_RETURN_COOKIE, createImpersonationSession, destroyAuthSession, resolveAuthSession, SESSION_COOKIE, SESSION_TTL_MS } from "../services/auth";

const StartBody = z.object({ userId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(500) });

/** Admin "view as client": a read-only, 30-minute session that swaps in for the admin's own and back. */
export async function adminImpersonationRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookie = (reply: FastifyReply, name: string, value: string, expires: Date) =>
    reply.setCookie(name, value, { httpOnly: true, secure: ctx.config.secureCookies, sameSite: "lax", path: "/", expires });

  app.post("/api/admin/impersonation", { preHandler: requireSuperadmin }, async (req, reply) => {
    const input = StartBody.parse(req.body);
    const target = await ctx.db.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new AppError(404, "not_found", "Client not found.");
    if (target.role !== "account_admin") throw new AppError(403, "cannot_impersonate_superadmin", "Superadmin accounts can't be viewed as a client.");
    const adminId = userId(req);
    const session = await createImpersonationSession(ctx, adminId, target.id);
    await audit(ctx.db, {
      actorUserId: adminId,
      actorType: "admin",
      action: "admin.impersonation_started",
      resourceType: "user",
      resourceId: target.id,
      metadata: { clientId: target.id, reason: input.reason },
    });
    // The admin's own token waits in a separate cookie. The view-as cookie outlives the session on purpose,
    // so an expired view is still recognised (and audited) on the next request.
    cookie(reply, ADMIN_RETURN_COOKIE, req.authToken!, new Date(Date.now() + SESSION_TTL_MS));
    cookie(reply, SESSION_COOKIE, session.token, new Date(Date.now() + SESSION_TTL_MS));
    return { clientId: target.id, expiresAt: session.expiresAt.toISOString() };
  });

  app.delete("/api/admin/impersonation", async (req, reply) => {
    if (!req.impersonation || !req.user) throw new AppError(404, "not_found", "Not found.");
    const clientId = req.user.id;
    const adminId = req.impersonation.adminId;
    await destroyAuthSession(ctx, req.authToken);
    await audit(ctx.db, {
      actorUserId: adminId,
      actorType: "admin",
      action: "admin.impersonation_stopped",
      resourceType: "user",
      resourceId: clientId,
      metadata: { clientId, reason: "stopped" },
    });
    const returnToken = req.cookies[ADMIN_RETURN_COOKIE];
    reply.clearCookie(ADMIN_RETURN_COOKIE, { path: "/" });
    const own = await resolveAuthSession(ctx, returnToken);
    if (own && !own.readOnly && own.user.id === adminId) {
      cookie(reply, SESSION_COOKIE, returnToken!, own.expiresAt);
      return { clientId, restored: true };
    }
    // The admin's own session is gone: they sign in again as usual.
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { clientId, restored: false };
  });
}
