/**
 * Research reports, evidence-linked findings and backend-enforced publishing.
 *
 * Publishing policy:
 *  - "owner" reports (written by the builder): approved by the project owner
 *    through First Five's own review step; publishing requires an approval
 *    matching the current revision.
 *  - "ux_director" reports: scored automatically by the rubric and "ready"
 *    without any review; the owner publishes with one click when at least one
 *    finding was kept.
 *  - "agenticorg" reports (retired integration): read-only legacy.
 */
import type { FindingDto, ReportDetail, ReportSummary, StudyMetrics } from "@firstfive/shared";
import { FindingInputSchema, ReviewDecisionSchema } from "@firstfive/shared";
import type { Prisma, Report, ReportFinding } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError, conflict, notFound } from "../lib/errors";
import { createAnalysisRun, kickRun } from "./analysis-pipeline";
import { buildEvidence } from "./evidence";
import { computeStudyMetrics } from "./metrics";
import { reconcileExpired } from "./sessions";
import { currentVersion, getOwnedStudy } from "./studies";

const EDITABLE: Report["status"][] = ["draft", "revision_requested"];

async function getOwnedReport(ctx: AppContext, userId: string, reportId: string) {
  const report = await ctx.db.report.findFirst({
    where: { id: reportId, study: { project: { ownerId: userId } } },
    include: { study: { include: { project: true } } },
  });
  if (!report) throw notFound("Report");
  return report;
}

async function metricsSnapshot(ctx: AppContext, studyId: string, version: number): Promise<StudyMetrics> {
  await reconcileExpired(ctx, { studyId });
  const sessions = await ctx.db.studySession.findMany({
    where: { studyId, studyVersion: { version } },
    include: { responses: { where: { status: "answered" }, select: { id: true } } },
  });
  return computeStudyMetrics(
    sessions.map((s) => ({
      inviteId: s.inviteId,
      status: s.status,
      isRepeat: s.isRepeat,
      startedAt: s.startedAt,
      goalVerifiedAt: s.goalVerifiedAt,
      answeredResponses: s.responses.length,
    })),
  );
}

export async function createOwnerReport(ctx: AppContext, userId: string, studyId: string) {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const version = await currentVersion(ctx, study);
  const snapshot = await metricsSnapshot(ctx, study.id, version.version);
  const report = await ctx.db.report.create({
    data: {
      studyId: study.id,
      studyVersion: version.version,
      source: "owner",
      status: "draft",
      title: `${study.name} — findings`,
      metricsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotAt: new Date(),
    },
  });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "report.created", resourceType: "report", resourceId: report.id });
  return getReportDetail(ctx, userId, report.id);
}

/**
 * Requests a UX Director analysis: stores the evidence, creates the run's
 * durable steps and starts the runner. One running analysis per study; the
 * report stays "processing" until the scored report is finalized as "ready".
 */
export async function requestAnalysis(ctx: AppContext, userId: string, studyId: string) {
  const study = await getOwnedStudy(ctx, userId, studyId);
  const provider = ctx.providers.uxDirector;
  if (!provider.configured || !provider.implemented) {
    throw new AppError(
      503,
      "provider_not_configured",
      "AI findings aren't available yet. Research findings become available when the UX Director is connected.",
    );
  }
  const running = await ctx.db.report.findFirst({ where: { studyId: study.id, source: "ux_director", status: "processing" } });
  if (running) return getReportDetail(ctx, userId, running.id);

  const version = await currentVersion(ctx, study);
  const snapshot = await metricsSnapshot(ctx, study.id, version.version);
  const snapshotAt = new Date();
  const built = await buildEvidence(ctx, {
    studyId: study.id,
    studyPublicId: study.publicId,
    version: version.version,
    snapshotId: `snap_${randomToken(8)}`,
    snapshotAt,
    metrics: snapshot,
  });
  if (built.pkg.sessions.length === 0) {
    throw new AppError(422, "no_finalized_attempts", "There are no finished attempts to analyze yet.");
  }
  const run = await ctx.db.agentRun.create({
    data: { provider: "ux_director", kind: "study_analysis", studyId: study.id, status: "running", inputDigest: sha256(JSON.stringify(built.pkg)) },
  });
  const report = await ctx.db.report.create({
    data: {
      studyId: study.id,
      studyVersion: version.version,
      source: "ux_director",
      status: "processing",
      title: `${study.name} — UX Director report`,
      metricsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotAt,
      agentRunId: run.id,
    },
  });
  await createAnalysisRun(ctx, { reportId: report.id, runId: run.id, built });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "report.analysis_requested", resourceType: "report", resourceId: report.id, metadata: { agentRunId: run.id } });
  kickRun(ctx, run.id);
  return getReportDetail(ctx, userId, report.id);
}

export async function listReportsForStudy(ctx: AppContext, studyId: string): Promise<ReportSummary[]> {
  const reports = await ctx.db.report.findMany({
    where: { studyId },
    include: { study: true, _count: { select: { findings: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return reports.map((r) => toSummary(r, r.study.name, r._count.findings));
}

export async function listReports(ctx: AppContext, userId: string): Promise<ReportSummary[]> {
  const reports = await ctx.db.report.findMany({
    where: { study: { project: { ownerId: userId } } },
    include: { study: true, _count: { select: { findings: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return reports.map((r) => toSummary(r, r.study.name, r._count.findings));
}

function toSummary(r: Report, studyName: string, findingCount: number): ReportSummary {
  return {
    id: r.id,
    studyId: r.studyId,
    studyName,
    title: r.title,
    status: r.status,
    source: r.source as ReportSummary["source"],
    revision: r.revision,
    findingCount,
    updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

export function codingAssistantPrompt(args: { websiteUrl: string; task: string; finding: Pick<ReportFinding, "title" | "observed" | "suggestion" | "retestMetric"> }) {
  const lines = [
    `I'm improving my website (${args.websiteUrl}). In a usability test, participants were asked to: "${args.task}".`,
    `Finding: ${args.finding.title}.`,
    `What we observed: ${args.finding.observed}`,
  ];
  if (args.finding.suggestion) lines.push(`Change to try: ${args.finding.suggestion}`);
  lines.push("Make this change without breaking existing functionality, keep the existing visual style, and do not collect sensitive input values.");
  if (args.finding.retestMetric) lines.push(`Afterwards I'll retest by checking: ${args.finding.retestMetric}.`);
  lines.push("Summarize exactly what you changed.");
  return lines.join("\n");
}

async function toFindingDto(ctx: AppContext, f: ReportFinding, websiteUrl: string, task: string): Promise<FindingDto> {
  const ids = [...new Set([...f.supportingSessionIds, ...f.counterSessionIds])];
  const sessions = ids.length
    ? await ctx.db.studySession.findMany({ where: { id: { in: ids } }, include: { invite: true } })
    : [];
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const ref = (id: string) => {
    const s = byId.get(id);
    return s ? { id, label: s.invite.label + (s.isRepeat ? " (repeat)" : ""), status: s.status } : null;
  };
  return {
    id: f.id,
    title: f.title,
    observed: f.observed,
    quotes: (f.quotes as FindingDto["quotes"]) ?? [],
    interpretation: f.interpretation,
    evidenceStrength: f.evidenceStrength as FindingDto["evidenceStrength"],
    suggestion: f.suggestion,
    retestMetric: f.retestMetric,
    affectedCount: f.supportingSessionIds.length,
    supportingSessions: f.supportingSessionIds.map(ref).filter((x): x is NonNullable<typeof x> => x != null),
    counterSessions: f.counterSessionIds.map(ref).filter((x): x is NonNullable<typeof x> => x != null),
    source: f.source as FindingDto["source"],
    assistantPrompt: f.improvementPrompt ?? codingAssistantPrompt({ websiteUrl, task, finding: f }),
    confidenceScore: f.confidenceScore,
    recommendationScore: f.recommendationScore,
  };
}

export function approvalPolicy(source: string): ReportDetail["approvalPolicy"] {
  if (source === "ux_director") {
    return { channel: "automated", description: "Findings are scored automatically by the UX Director rubric; items below the confidence bar are left out. You publish the report when you're ready." };
  }
  if (source === "agenticorg") {
    return { channel: "agenticorg", description: "Produced by the retired AgenticOrg integration. It can no longer be published; run a new analysis." };
  }
  return { channel: "first_five", description: "You review and approve this report before it can be published or shared." };
}

/** Finished, non-repeat attempts on the report's study version that the report doesn't include. */
async function staleBy(ctx: AppContext, report: { source: string; studyId: string; studyVersion: number; sessionsIncluded: number | null; metricsSnapshot: unknown }) {
  if (report.source === "owner") return 0;
  const included = report.sessionsIncluded ?? (report.metricsSnapshot as StudyMetrics | null)?.finalized ?? 0;
  const finalized = await ctx.db.studySession.count({
    where: { studyId: report.studyId, studyVersion: { version: report.studyVersion }, isRepeat: false, status: { in: ["completed", "dropped"] } },
  });
  return Math.max(0, finalized - included);
}

export async function getReportDetail(ctx: AppContext, userId: string, reportId: string): Promise<ReportDetail> {
  const report = await getOwnedReport(ctx, userId, reportId);
  // Opening a processing report resumes its run if the instance slept or restarted.
  if (report.source === "ux_director" && report.status === "processing" && report.agentRunId) kickRun(ctx, report.agentRunId);
  return buildReportDetail(ctx, report.id);
}

async function buildReportDetail(ctx: AppContext, reportId: string): Promise<ReportDetail> {
  const report = await ctx.db.report.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      study: { include: { project: true } },
      findings: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      approvals: { include: { reviewer: true }, orderBy: { createdAt: "asc" } },
      agentRun: { select: { externalRunId: true } },
    },
  });
  const version = await ctx.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: report.studyId, version: report.studyVersion } } });
  const findings = await Promise.all(report.findings.map((f) => toFindingDto(ctx, f, report.study.project.websiteUrl, version.task)));
  return {
    ...toSummary(report, report.study.name, report.findings.length),
    summary: report.summary,
    studyVersion: report.studyVersion,
    task: version.task,
    goalType: version.goalType,
    goalTarget: version.goalTarget,
    metricsSnapshot: report.metricsSnapshot as unknown as StudyMetrics,
    snapshotAt: report.snapshotAt.toISOString(),
    findings,
    approvals: report.approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      channel: a.channel,
      reviewer: a.reviewer?.name ?? a.reviewer?.email ?? (a.channel === "agenticorg" ? "AgenticOrg reviewer (legacy)" : null),
      note: a.note,
      revision: a.reportRevision,
      createdAt: a.createdAt.toISOString(),
    })),
    shareUrl: report.shareToken && report.status === "published" ? `${ctx.config.appUrl}/r/${report.shareToken}` : null,
    approvalPolicy: approvalPolicy(report.source),
    failureReason: report.failureReason,
    externalRunId: report.agentRun?.externalRunId ?? (report.source === "ux_director" ? report.agentRunId : null),
    staleBy: await staleBy(ctx, report),
    legacy: report.source === "agenticorg",
    droppedFindings: report.droppedFindings,
    droppedRecommendations: report.droppedRecommendations,
  };
}

/** Validates that every cited session/response belongs to this study; quotes are copied verbatim from stored answers. */
async function resolveEvidence(ctx: AppContext, studyId: string, input: { supportingSessionIds: string[]; counterSessionIds: string[]; quoteResponseIds: string[] }) {
  const sessionIds = [...new Set([...input.supportingSessionIds, ...input.counterSessionIds])];
  if (sessionIds.length) {
    const found = await ctx.db.studySession.count({ where: { id: { in: sessionIds }, studyId } });
    if (found !== sessionIds.length) throw new AppError(400, "invalid_evidence", "Some cited sessions don't belong to this test.");
  }
  const overlap = input.supportingSessionIds.filter((id) => input.counterSessionIds.includes(id));
  if (overlap.length) throw new AppError(400, "invalid_evidence", "A session can't both support and contradict a finding.");
  let quotes: { sessionId: string; responseId: string; text: string }[] = [];
  if (input.quoteResponseIds.length) {
    const responses = await ctx.db.interviewResponse.findMany({
      where: { id: { in: input.quoteResponseIds }, status: "answered", text: { not: null }, studySession: { studyId } },
    });
    if (responses.length !== new Set(input.quoteResponseIds).size) {
      throw new AppError(400, "invalid_evidence", "Quotes must come from participant answers in this test.");
    }
    quotes = responses.map((r) => ({ sessionId: r.studySessionId, responseId: r.id, text: r.text! }));
  }
  return quotes;
}

function assertEditable(report: Report) {
  if (report.source !== "owner") throw conflict("not_editable", "UX Director findings can't be edited; rubric scoring decides what's kept. Run the analysis again to refresh them.");
  if (!EDITABLE.includes(report.status)) {
    throw conflict("not_editable", "This report is in review or finished. Reopen it to make changes.");
  }
}

export async function addFinding(ctx: AppContext, userId: string, reportId: string, raw: unknown) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertEditable(report);
  const input = FindingInputSchema.parse(raw);
  const quotes = await resolveEvidence(ctx, report.studyId, input);
  const count = await ctx.db.reportFinding.count({ where: { reportId: report.id } });
  await ctx.db.reportFinding.create({
    data: {
      reportId: report.id,
      position: count,
      title: input.title,
      observed: input.observed,
      quotes: quotes as Prisma.InputJsonValue,
      interpretation: input.interpretation || null,
      evidenceStrength: input.evidenceStrength,
      suggestion: input.suggestion || null,
      retestMetric: input.retestMetric || null,
      supportingSessionIds: input.supportingSessionIds,
      counterSessionIds: input.counterSessionIds,
      source: "owner",
    },
  });
  await ctx.db.report.update({ where: { id: report.id }, data: { updatedAt: new Date() } });
  return getReportDetail(ctx, userId, report.id);
}

export async function updateFinding(ctx: AppContext, userId: string, reportId: string, findingId: string, raw: unknown) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertEditable(report);
  const finding = await ctx.db.reportFinding.findFirst({ where: { id: findingId, reportId: report.id } });
  if (!finding) throw notFound("Finding");
  const input = FindingInputSchema.parse(raw);
  const quotes = await resolveEvidence(ctx, report.studyId, input);
  await ctx.db.reportFinding.update({
    where: { id: finding.id },
    data: {
      title: input.title,
      observed: input.observed,
      quotes: quotes as Prisma.InputJsonValue,
      interpretation: input.interpretation || null,
      evidenceStrength: input.evidenceStrength,
      suggestion: input.suggestion || null,
      retestMetric: input.retestMetric || null,
      supportingSessionIds: input.supportingSessionIds,
      counterSessionIds: input.counterSessionIds,
    },
  });
  return getReportDetail(ctx, userId, report.id);
}

export async function deleteFinding(ctx: AppContext, userId: string, reportId: string, findingId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertEditable(report);
  await ctx.db.reportFinding.deleteMany({ where: { id: findingId, reportId: report.id } });
  return getReportDetail(ctx, userId, report.id);
}

export async function updateReportMeta(ctx: AppContext, userId: string, reportId: string, input: { title?: string; summary?: string | null }) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertEditable(report);
  await ctx.db.report.update({ where: { id: report.id }, data: { title: input.title ?? undefined, summary: input.summary === undefined ? undefined : input.summary || null } });
  return getReportDetail(ctx, userId, report.id);
}

export async function refreshSnapshot(ctx: AppContext, userId: string, reportId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertEditable(report);
  const snapshot = await metricsSnapshot(ctx, report.studyId, report.studyVersion);
  await ctx.db.report.update({ where: { id: report.id }, data: { metricsSnapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotAt: new Date() } });
  return getReportDetail(ctx, userId, report.id);
}

function assertOwnerReviewFlow(report: Report) {
  if (report.source === "ux_director") {
    throw conflict("no_review_step", "UX Director reports are scored automatically and have no review step. Publish the report when you're ready.");
  }
  if (report.source === "agenticorg") throw legacyConflict();
}

const legacyConflict = () =>
  conflict("legacy_report", "This report came from the retired AgenticOrg integration and can't be changed or published. Run a new analysis.");

export async function requestReview(ctx: AppContext, userId: string, reportId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertOwnerReviewFlow(report);
  if (!EDITABLE.includes(report.status)) throw conflict("invalid_transition", "Only drafts can be sent for review.");
  const findings = await ctx.db.reportFinding.count({ where: { reportId: report.id } });
  if (findings === 0) throw new AppError(422, "no_findings", "Add at least one finding before requesting review.");
  const policy = approvalPolicy(report.source);
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.report.updateMany({ where: { id: report.id, status: report.status }, data: { status: "awaiting_review" } });
    if (res.count !== 1) throw conflict("state_changed", "This report changed. Refresh and try again.");
    await tx.reportApproval.create({
      data: { reportId: report.id, reportRevision: report.revision, channel: policy.channel, reviewerId: userId, decision: "requested" },
    });
    await audit(tx, { actorUserId: userId, actorType: "user", action: "report.review_requested", resourceType: "report", resourceId: report.id, metadata: { revision: report.revision } });
  });
  return getReportDetail(ctx, userId, report.id);
}

/** Records a human review decision. Owner-authored reports only. */
export async function reviewReport(ctx: AppContext, userId: string, reportId: string, raw: unknown) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertOwnerReviewFlow(report);
  const input = ReviewDecisionSchema.parse(raw);
  if (report.status !== "awaiting_review") throw conflict("invalid_transition", "This report isn't awaiting review.");
  // Authorized approver for owner reports = the project owner (enforced by getOwnedReport).
  const next = input.decision === "approved" ? "approved" : input.decision === "rejected" ? "rejected" : "revision_requested";
  await ctx.db.$transaction(async (tx) => {
    const res = await tx.report.updateMany({ where: { id: report.id, status: "awaiting_review", revision: report.revision }, data: { status: next } });
    if (res.count !== 1) throw conflict("state_changed", "This report changed. Refresh and try again.");
    await tx.reportApproval.create({
      data: { reportId: report.id, reportRevision: report.revision, channel: "first_five", reviewerId: userId, decision: input.decision, note: input.note || null },
    });
    await audit(tx, { actorUserId: userId, actorType: "user", action: `report.${input.decision}`, resourceType: "report", resourceId: report.id, metadata: { revision: report.revision } });
  });
  return getReportDetail(ctx, userId, report.id);
}

export async function reopenReport(ctx: AppContext, userId: string, reportId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  assertOwnerReviewFlow(report);
  if (!["rejected", "approved", "revision_requested"].includes(report.status) || report.source !== "owner") {
    throw conflict("invalid_transition", "This report can't be reopened.");
  }
  await ctx.db.report.update({ where: { id: report.id }, data: { status: "draft", revision: { increment: 1 } } });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "report.reopened", resourceType: "report", resourceId: report.id });
  return getReportDetail(ctx, userId, report.id);
}

/**
 * Owner reports publish only with an approval for the CURRENT revision.
 * UX Director reports publish from "ready" with at least one kept finding.
 * Idempotent: publishing a published report returns the same share link.
 */
export async function publishReport(ctx: AppContext, userId: string, reportId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  if (report.status === "published") return getReportDetail(ctx, userId, report.id);
  if (report.source === "agenticorg") throw legacyConflict();
  if (report.source === "ux_director") return publishScoredReport(ctx, userId, report);
  if (report.status !== "approved") throw conflict("approval_required", "This report needs an approved review before it can be published.");
  const approval = await ctx.db.reportApproval.findFirst({
    where: { reportId: report.id, reportRevision: report.revision, decision: "approved", channel: "first_five" },
    orderBy: { createdAt: "desc" },
  });
  if (!approval) throw conflict("approval_required", "No approval was found for the current version of this report.");
  const shareToken = randomToken(18);
  const res = await ctx.db.report.updateMany({
    where: { id: report.id, status: "approved", revision: report.revision },
    data: { status: "published", publishedAt: new Date(), shareToken },
  });
  if (res.count === 1) {
    await audit(ctx.db, {
      actorUserId: userId,
      actorType: "user",
      action: "report.published",
      resourceType: "report",
      resourceId: report.id,
      metadata: { revision: report.revision, approvalId: approval.id },
    });
  }
  return getReportDetail(ctx, userId, report.id);
}

async function publishScoredReport(ctx: AppContext, userId: string, report: Report) {
  if (report.status !== "ready") throw conflict("not_ready", "This report isn't ready to publish yet.");
  const kept = await ctx.db.reportFinding.count({ where: { reportId: report.id } });
  if (kept === 0) throw new AppError(422, "no_kept_findings", "No finding met the confidence bar, so there's nothing to publish. Run the analysis again after more attempts.");
  const shareToken = randomToken(18);
  const res = await ctx.db.report.updateMany({ where: { id: report.id, status: "ready" }, data: { status: "published", publishedAt: new Date(), shareToken } });
  if (res.count === 1) {
    await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "report.published", resourceType: "report", resourceId: report.id, metadata: { findings: kept, policy: "automated" } });
  }
  return getReportDetail(ctx, userId, report.id);
}

export async function unpublishReport(ctx: AppContext, userId: string, reportId: string) {
  const report = await getOwnedReport(ctx, userId, reportId);
  if (report.status !== "published") throw conflict("invalid_transition", "This report isn't published.");
  const back = report.source === "owner" ? "approved" : "ready";
  await ctx.db.report.update({ where: { id: report.id }, data: { status: back, shareToken: null, publishedAt: null } });
  await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "report.unpublished", resourceType: "report", resourceId: report.id });
  return getReportDetail(ctx, userId, report.id);
}

export async function getPublishedReport(ctx: AppContext, shareToken: string) {
  if (!shareToken || shareToken.length > 64) throw notFound("Report");
  const report = await ctx.db.report.findUnique({ where: { shareToken } });
  if (!report || report.status !== "published") throw notFound("Report");
  const detail = await buildReportDetail(ctx, report.id);
  // Public view: no internal IDs, approvals or coding prompts.
  return {
    title: detail.title,
    summary: detail.summary,
    studyName: detail.studyName,
    task: detail.task,
    goalType: detail.goalType,
    goalTarget: detail.goalTarget,
    metricsSnapshot: detail.metricsSnapshot,
    snapshotAt: detail.snapshotAt,
    publishedAt: detail.publishedAt,
    source: detail.source,
    findings: detail.findings.map((f) => ({
      title: f.title,
      observed: f.observed,
      quotes: f.quotes.map((q) => ({ text: q.text })),
      interpretation: f.interpretation,
      evidenceStrength: f.evidenceStrength,
      suggestion: f.suggestion,
      retestMetric: f.retestMetric,
      affectedCount: f.affectedCount,
      counterCount: f.counterSessions.length,
    })),
  };
}
