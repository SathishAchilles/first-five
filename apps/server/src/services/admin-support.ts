/**
 * Admin support actions. Each one needs a written reason and commits its change
 * and its audit entry (with before/after values) in one transaction.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { publicId } from "../lib/crypto";
import { normalizeWebsiteUrl } from "../lib/url";
import { assertClient } from "./admin-clients";
import { assertCanCreateProject, getEntitlement } from "./entitlements";
import { getOwnedStudy } from "./studies";
import { requestAnalysis } from "./reports";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINISHED = ["completed", "dropped"] as const;

export const ReasonSchema = z.object({ reason: z.string().trim().min(1, "A reason is required.").max(500) });

const futureDate = z
  .string()
  .datetime()
  .transform((v) => new Date(v));

export const GrantAccessSchema = ReasonSchema.extend({
  studyCredits: z.coerce.number().int().min(1).max(50),
  maxParticipantsPerStudy: z.coerce.number().int().min(1).max(20),
  expiresAt: futureDate.optional(),
});
export const AddCreditsSchema = ReasonSchema.extend({ credits: z.coerce.number().int().min(1).max(50) });
export const ExtendStudySchema = ReasonSchema.extend({ expiresAt: futureDate });
export const AddWebsiteSchema = ReasonSchema.extend({
  name: z.string().trim().min(1, "Give the website a name.").max(80),
  websiteUrl: z.string().trim().min(1, "Enter the website address.").max(2048),
});

interface Change {
  action: string;
  resourceType: string;
  resourceId: string;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
}

/** Runs one support change and its audit entry together, or neither. */
async function withAudit<T>(
  ctx: AppContext,
  adminId: string,
  clientId: string,
  reason: string,
  fn: (tx: Prisma.TransactionClient) => Promise<{ change: Change; result: T }>,
): Promise<T> {
  return ctx.db.$transaction(async (tx) => {
    const { change, result } = await fn(tx);
    await audit(tx, {
      actorUserId: adminId,
      actorType: "admin",
      action: change.action,
      resourceType: change.resourceType,
      resourceId: change.resourceId,
      metadata: { clientId, reason, before: change.before, after: change.after },
    });
    return result;
  });
}

const grantView = (g: { studyCredits: number; creditsUsed: number; maxParticipantsPerStudy: number; expiresAt: Date | null; revokedAt: Date | null }) => ({
  studyCredits: g.studyCredits,
  creditsUsed: g.creditsUsed,
  maxParticipantsPerStudy: g.maxParticipantsPerStudy,
  expiresAt: g.expiresAt?.toISOString() ?? null,
  revokedAt: g.revokedAt?.toISOString() ?? null,
});

export async function grantAccess(ctx: AppContext, adminId: string, clientId: string, raw: unknown) {
  const input = GrantAccessSchema.parse(raw);
  if (input.expiresAt && input.expiresAt <= new Date()) throw new AppError(400, "invalid_expiry", "The expiry must be in the future.");
  await assertClient(ctx, clientId);
  return withAudit(ctx, adminId, clientId, input.reason, async (tx) => {
    const g = await tx.accessGrant.create({
      data: {
        userId: clientId,
        planKey: "complimentary",
        source: "admin",
        studyCredits: input.studyCredits,
        maxParticipantsPerStudy: input.maxParticipantsPerStudy,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return { change: { action: "admin.grant_created", resourceType: "access_grant", resourceId: g.id, before: null, after: grantView(g) }, result: { id: g.id } };
  });
}

async function clientGrant(tx: Prisma.TransactionClient, clientId: string, grantId: string) {
  const g = await tx.accessGrant.findFirst({ where: { id: grantId, userId: clientId } });
  if (!g) throw new AppError(404, "not_found", "Grant not found.");
  return g;
}

export async function revokeGrant(ctx: AppContext, adminId: string, clientId: string, grantId: string, raw: unknown) {
  const { reason } = ReasonSchema.parse(raw);
  await assertClient(ctx, clientId);
  return withAudit(ctx, adminId, clientId, reason, async (tx) => {
    const g = await clientGrant(tx, clientId, grantId);
    if (g.revokedAt) throw new AppError(409, "already_revoked", "This grant is already revoked.");
    // Studies already launched with this grant's credits keep running: only new launches are affected.
    const after = await tx.accessGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
    return { change: { action: "admin.grant_revoked", resourceType: "access_grant", resourceId: g.id, before: grantView(g), after: grantView(after) }, result: { id: g.id } };
  });
}

export async function addCredits(ctx: AppContext, adminId: string, clientId: string, grantId: string, raw: unknown) {
  const input = AddCreditsSchema.parse(raw);
  await assertClient(ctx, clientId);
  return withAudit(ctx, adminId, clientId, input.reason, async (tx) => {
    const g = await clientGrant(tx, clientId, grantId);
    if (g.revokedAt || (g.expiresAt && g.expiresAt <= new Date())) {
      throw new AppError(409, "grant_inactive", "This grant is revoked or expired. Grant new access instead.");
    }
    const after = await tx.accessGrant.update({ where: { id: g.id }, data: { studyCredits: { increment: input.credits } } });
    return { change: { action: "admin.credits_added", resourceType: "access_grant", resourceId: g.id, before: grantView(g), after: grantView(after) }, result: { id: g.id } };
  });
}

export async function extendStudy(ctx: AppContext, adminId: string, clientId: string, studyId: string, raw: unknown) {
  const input = ExtendStudySchema.parse(raw);
  const now = Date.now();
  if (input.expiresAt.getTime() <= now || input.expiresAt.getTime() > now + 30 * DAY_MS) {
    throw new AppError(400, "invalid_expiry", "The new end date must be in the future and at most 30 days away.");
  }
  await assertClient(ctx, clientId);
  const study = await getOwnedStudy(ctx, clientId, studyId);
  return withAudit(ctx, adminId, clientId, input.reason, async (tx) => {
    if (study.status === "closed") throw new AppError(409, "study_closed", "The owner closed this test, so it can't be extended.");
    const after = await tx.study.update({
      where: { id: study.id },
      data: { expiresAt: input.expiresAt, ...(study.status === "expired" ? { status: "active" } : {}) },
    });
    const view = (s: { status: string; expiresAt: Date | null }) => ({ status: s.status, expiresAt: s.expiresAt?.toISOString() ?? null });
    return { change: { action: "admin.study_extended", resourceType: "study", resourceId: study.id, before: view(study), after: view(after) }, result: { id: study.id } };
  });
}

/**
 * Adds a website to a client's account, for a builder who got stuck at setup.
 * The client's own website limit applies; a client who hasn't got access yet
 * (onboarded, code not redeemed) can have one website set up ahead of time and
 * sees it once they redeem. It is not counted as the client's own conversion,
 * and the client still has to install the snippet to connect it.
 */
export async function addWebsite(ctx: AppContext, adminId: string, clientId: string, raw: unknown) {
  const input = AddWebsiteSchema.parse(raw);
  await assertClient(ctx, clientId);
  const e = await getEntitlement(ctx.db, ctx.config, clientId);
  if (e.status === "none") {
    if (e.usage.projects >= 1) throw new AppError(403, "entitlement_limit", "Before they have access, a client can have 1 website set up for them.");
  } else {
    await assertCanCreateProject(ctx.db, ctx.config, clientId);
  }
  const { url, origin } = normalizeWebsiteUrl(input.websiteUrl, { allowLocalhost: !ctx.config.isProduction });
  return withAudit(ctx, adminId, clientId, input.reason, async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId: clientId,
        publicId: publicId("ffp"),
        name: input.name,
        websiteUrl: url,
        canonicalOrigin: origin,
        origins: { create: { origin } },
        sdkConfig: { create: {} },
      },
    });
    return {
      change: {
        action: "admin.website_added",
        resourceType: "project",
        resourceId: project.id,
        before: null,
        after: { publicId: project.publicId, name: project.name, websiteUrl: url, origin },
      },
      result: { id: project.id, publicId: project.publicId },
    };
  });
}

/**
 * Starts a new UX Director analysis when the latest one failed or is behind the
 * finished attempts. An analysis already running is returned, not duplicated.
 */
export async function rerunReport(ctx: AppContext, adminId: string, clientId: string, studyId: string, raw: unknown) {
  const { reason } = ReasonSchema.parse(raw);
  await assertClient(ctx, clientId);
  const study = await getOwnedStudy(ctx, clientId, studyId);
  const [finished, latest] = await Promise.all([
    ctx.db.studySession.count({ where: { studyId: study.id, isRepeat: false, status: { in: [...FINISHED] } } }),
    ctx.db.report.findFirst({ where: { studyId: study.id, source: "ux_director" }, orderBy: { createdAt: "desc" } }),
  ]);
  if (finished === 0) throw new AppError(422, "no_finalized_attempts", "There are no finished attempts to analyze yet.");
  const behind = !latest || (latest.sessionsIncluded ?? 0) < finished;
  if (latest?.status !== "processing" && latest?.status !== "failed" && !behind) {
    throw new AppError(409, "report_current", "The latest report already covers every finished attempt.");
  }
  const report = await requestAnalysis(ctx, clientId, study.id);
  if (report.id !== latest?.id) {
    await audit(ctx.db, {
      actorUserId: adminId,
      actorType: "admin",
      action: "admin.report_rerun",
      resourceType: "report",
      resourceId: report.id,
      metadata: { clientId, reason, before: latest ? { id: latest.id, status: latest.status } : null, after: { id: report.id, status: report.status } },
    });
  }
  return report;
}
