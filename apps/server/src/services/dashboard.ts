import type { DashboardResponse, FeedbackAnswerDto, SessionDetail, SessionListItem } from "@firstfive/shared";
import type { EventRecord, InterviewQuestion, InterviewResponse, ParticipantInvite, StudySession } from "@prisma/client";
import type { AppContext } from "../context";
import { notFound } from "../lib/errors";
import { providerStatus } from "../integrations/registry";
import { scheduleOutboxDispatch } from "./maintenance";
import { computeStudyMetrics } from "./metrics";
import { readAnalyticsSnapshot, refreshInBackground } from "./posthog-metrics";
import { listReportsForStudy } from "./reports";
import { reconcileExpired } from "./sessions";
import { getOwnedStudy, getStudyDetail } from "./studies";
import { analyzeTimeline, computeFunnel, type MilestoneDef } from "./timeline";

type SessionWithRelations = StudySession & {
  invite: ParticipantInvite;
  events: EventRecord[];
  responses: (InterviewResponse & { question: InterviewQuestion })[];
};

async function loadSessions(ctx: AppContext, studyId: string, version?: number) {
  return ctx.db.studySession.findMany({
    where: { studyId, ...(version ? { studyVersion: { version } } : {}) },
    include: { invite: true, events: true, responses: { include: { question: true } } },
    orderBy: { startedAt: "asc" },
  });
}

function toListItem(s: SessionWithRelations): SessionListItem {
  const a = analyzeTimeline(s.events, { startedAt: s.startedAt, verifiedGoalEventId: s.verifiedGoalEventId });
  const end = s.goalVerifiedAt ?? s.finalizedAt ?? s.lastEventAt;
  return {
    id: s.id,
    publicId: s.publicId,
    participantLabel: s.invite.label + (s.isRepeat ? " (repeat)" : ""),
    status: s.status,
    isRepeat: s.isRepeat,
    startedAt: s.startedAt.toISOString(),
    finalizedAt: s.finalizedAt?.toISOString() ?? null,
    finalReason: s.finalReason,
    durationMs: end ? Math.max(0, Math.min(end.getTime(), s.deadlineAt.getTime() + 60_000) - s.startedAt.getTime()) : null,
    timeToGoalMs: s.goalVerifiedAt ? s.goalVerifiedAt.getTime() - s.startedAt.getTime() : null,
    clickCount: a.clickCount,
    pagesVisited: a.pagesVisited,
    backtracks: a.backtracks,
    repeatedInteractions: a.repeatedInteractions,
    lastEvent: a.lastEvent,
    clientErrors: a.clientErrors,
    feedbackStatus: s.feedbackStatus,
    dataQualityFlags: s.dataQualityFlags,
  };
}

export async function getDashboard(ctx: AppContext, userId: string, studyId: string, version?: number): Promise<DashboardResponse> {
  const owned = await getOwnedStudy(ctx, userId, studyId);
  await reconcileExpired(ctx, { studyId: owned.id });
  const study = await getStudyDetail(ctx, userId, studyId);
  const v = version ?? study.currentVersion.version;
  const sessions = await loadSessions(ctx, owned.id, v);
  // free instances sleep, so requests also move analytics along (PRD §5.7): deliver queued events, refresh stale details
  scheduleOutboxDispatch(ctx);
  const snapshot = await readAnalyticsSnapshot(ctx, owned.id, v);
  if (snapshot.stale) refreshInBackground(ctx, owned.id, v);
  const metrics = computeStudyMetrics(
    sessions.map((s) => ({
      inviteId: s.inviteId,
      status: s.status,
      isRepeat: s.isRepeat,
      startedAt: s.startedAt,
      goalVerifiedAt: s.goalVerifiedAt,
      answeredResponses: s.responses.filter((r) => r.status === "answered").length,
    })),
  );

  const primary = sessions.filter((s) => !s.isRepeat && s.status !== "invalid");
  const withEvents = primary.filter((s) => s.events.length > 0);
  const pageCounts = new Map<string, number>();
  for (const s of withEvents) {
    const paths = new Set(s.events.filter((e) => e.eventName === "ff_page_viewed" && e.pagePath).map((e) => e.pagePath!));
    for (const p of paths) pageCounts.set(p, (pageCounts.get(p) ?? 0) + 1);
  }
  const versionRow = await ctx.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: owned.id, version: v } } });
  const milestones = (versionRow.milestones ?? []) as unknown as MilestoneDef[];
  const funnel = milestones.length >= 2 && withEvents.length > 0 ? computeFunnel(withEvents.map((s) => s.events), milestones) : null;

  const [posthogStatus, uxDirectorStatus, reports] = await Promise.all([
    providerStatus(ctx.config, ctx.db, "posthog"),
    providerStatus(ctx.config, ctx.db, "ux_director"),
    listReportsForStudy(ctx, owned.id),
  ]);

  return {
    study,
    metrics,
    version: v,
    dataUpdatedAt: new Date().toISOString(),
    behavior: {
      available: withEvents.length > 0,
      topPages: [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, attempts]) => ({ path, attempts })),
      funnel,
    },
    analytics: {
      provider: snapshot.details.status === "ready" ? "posthog" : "postgres",
      posthogStatus,
      details: snapshot.details,
    },
    insights: {
      available: reports.some((r) => r.source === "agenticorg"),
      uxDirectorStatus,
      latestReport: reports[0] ?? null,
    },
  };
}

export async function listSessions(ctx: AppContext, userId: string, studyId: string, filter?: { status?: string; version?: number }) {
  const owned = await getOwnedStudy(ctx, userId, studyId);
  await reconcileExpired(ctx, { studyId: owned.id });
  const sessions = await loadSessions(ctx, owned.id, filter?.version);
  return sessions
    .filter((s) => !filter?.status || s.status === filter.status)
    .map(toListItem)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function feedbackFor(s: SessionWithRelations, questions: InterviewQuestion[]): FeedbackAnswerDto[] {
  return questions
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const r = s.responses.find((x) => x.questionId === q.id);
      return {
        responseId: r?.id ?? null,
        questionKey: q.questionKey,
        questionText: q.text,
        questionSource: q.source,
        status: r ? (r.status as "answered" | "skipped") : "missing",
        choice: r?.choice ?? null,
        text: r?.text ?? null,
        submittedAt: r?.submittedAt.toISOString() ?? null,
      };
    });
}

export async function getSessionDetail(ctx: AppContext, userId: string, sessionId: string): Promise<SessionDetail> {
  const s = await ctx.db.studySession.findFirst({
    where: { id: sessionId, study: { project: { ownerId: userId } } },
    include: { invite: true, events: true, responses: { include: { question: true } }, questions: true },
  });
  if (!s) throw notFound("Attempt");
  await reconcileExpired(ctx, { sessionId: s.id });
  const fresh = await ctx.db.studySession.findUniqueOrThrow({
    where: { id: s.id },
    include: { invite: true, events: true, responses: { include: { question: true } }, questions: true },
  });
  const a = analyzeTimeline(fresh.events, { startedAt: fresh.startedAt, verifiedGoalEventId: fresh.verifiedGoalEventId });
  return {
    ...toListItem(fresh),
    studyId: fresh.studyId,
    deadlineAt: fresh.deadlineAt.toISOString(),
    goalVerifiedAt: fresh.goalVerifiedAt?.toISOString() ?? null,
    timeline: a.timeline,
    feedback: feedbackFor(fresh, fresh.questions),
  };
}

/** Exact participant answers available to quote in findings (open-text answers only). */
export async function listQuotes(ctx: AppContext, userId: string, studyId: string) {
  const owned = await getOwnedStudy(ctx, userId, studyId);
  const responses = await ctx.db.interviewResponse.findMany({
    where: { status: "answered", text: { not: null }, studySession: { studyId: owned.id } },
    include: { question: true, studySession: { include: { invite: true } } },
    orderBy: { submittedAt: "asc" },
  });
  return responses.map((r) => ({
    responseId: r.id,
    sessionId: r.studySessionId,
    participantLabel: r.studySession.invite.label + (r.studySession.isRepeat ? " (repeat)" : ""),
    sessionStatus: r.studySession.status,
    questionText: r.question.text,
    text: r.text!,
  }));
}
