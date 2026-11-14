import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { safeEqualHex, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { kickRun } from "../services/analysis-pipeline";
import { runMaintenance } from "../services/maintenance";

const RunParam = z.object({ runId: z.string().uuid() });

/**
 * Endpoints for the hosting platform, not for people: the daily maintenance cron
 * and analysis-run continuation. Both need `Authorization: Bearer <CRON_SECRET>`.
 */
export async function internalRoutes(app: FastifyInstance, ctx: AppContext) {
  const requireCronSecret = async (req: FastifyRequest) => {
    const secret = ctx.config.CRON_SECRET;
    if (!secret) throw new AppError(503, "not_configured", "Internal endpoints are not configured.");
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !safeEqualHex(sha256(given), sha256(secret))) throw new AppError(401, "unauthorized", "Unauthorized.");
  };

  app.get("/api/internal/maintenance", { preHandler: requireCronSecret }, async () => runMaintenance(ctx));

  app.post("/api/internal/analysis/:runId/continue", { preHandler: requireCronSecret }, async (req, reply) => {
    const { runId } = RunParam.parse(req.params);
    kickRun(ctx, runId);
    return reply.status(202).send({ accepted: true });
  });
}
