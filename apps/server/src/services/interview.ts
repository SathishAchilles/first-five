import type { FeedbackQuestionDto, FeedbackSessionResponse } from "@firstfive/shared";
import { EASE_SCALE, FeedbackSubmitSchema } from "@firstfive/shared";
import type { InterviewQuestion } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { sha256 } from "../lib/crypto";
import { AppError, gone } from "../lib/errors";
import { sanitizeParticipantText } from "../lib/url";
import { analyzeTimeline } from "./timeline";

export const STANDARD_QUESTIONS = {
  q1_ease: { position: 1, kind: "ease_scale" as const, text: "How easy or difficult was this task?" },
  q2_context: { position: 2, kind: "open_text" as const, fallbackText: "Was anything different from what you expected?" },
  q3_improve: { position: 3, kind: "open_text" as const, text: "What would have made this task easier?" },
};

const MEANINGFUL_FOR_QUESTION = new Set(["ff_page_viewed", "ff_element_clicked", "ff_form_submitted", "ff_custom_event", "ff_client_error"]);

/** Resolve the feedback handoff token (short-lived, single-session scope). */
export async function resolveFeedbackAccess(ctx: AppContext, studyPublicId: string, token: string | undefined) {
  if (!token || token.length > 200) throw new AppError(401, "unauthenticated", "This feedback link isn't valid.");
  const t = await ctx.db.sdkTicket.findUnique({
    where: { tokenHash: sha256(token) },
    include: { studySession: { include: { study: true } } },
  });
  if (!t || t.kind !== "feedback" || !t.studySession || t.studySession.study.publicId !== studyPublicId) {
    throw new AppError(401, "unauthenticated", "This feedback link isn't valid.");
  }
  if (t.expiresAt <= new Date()) throw gone("ticket_expired", "This feedback link has expired.");
  return { ticket: t, session: t.studySession };
}

async function ensureQuestions(ctx: AppContext, sessionId: string): Promise<InterviewQuestion[]> {
  const existing = await ctx.db.interviewQuestion.findMany({ where: { studySessionId: sessionId }, orderBy: { position: "asc" } });
  if (existing.length >= 3) return existing;

  // Contextual question: only when the UX Director is genuinely connected; otherwise the neutral fallback.
  let q2Text: string = STANDARD_QUESTIONS.q2_context.fallbackText;
  let q2Source: "fallback" | "ux_director" = "fallback";
  let q2RunId: string | null = null;
  if (ctx.providers.uxDirector.configured && ctx.providers.uxDirector.implemented) {
    const timeoutMs = ctx.config.UX_DIRECTOR_Q2_TIMEOUT_MS;
    const run = await ctx.db.agentRun.create({ data: { provider: "ux_director", kind: "contextual_question", studySessionId: sessionId, status: "running" } });
    const started = Date.now();
    let outcome: { status: string; error?: string; details?: object } = { status: "fallback", error: "timed out" };
    try {
      const session = await ctx.db.studySession.findUniqueOrThrow({ where: { id: sessionId }, include: { studyVersion: true, events: true } });
      run.studyId = session.studyId;
      const analysis = analyzeTimeline(session.events, { startedAt: session.startedAt, verifiedGoalEventId: session.verifiedGoalEventId });
      const generated = await Promise.race([
        ctx.providers.uxDirector.generateContextualQuestion(
          {
            sessionPublicId: session.publicId,
            task: session.studyVersion.task,
            goal: { type: session.studyVersion.goalType, target: session.studyVersion.goalTarget },
            outcome: session.status,
            events: analysis.timeline
              .filter((t) => MEANINGFUL_FOR_QUESTION.has(t.name))
              .slice(0, 50)
              .map((t) => ({
                event_id: t.eventId,
                seq: t.sequence,
                name: t.name,
                route: t.pagePath,
                element_key: t.elementKey,
                element_type: t.elementType,
                element_label: t.label,
                t_ms_from_start: t.offsetMs,
              })),
          },
          { timeoutMs },
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (generated?.question) {
        q2Text = sanitizeParticipantText(generated.question, 300) ?? q2Text;
        q2Source = "ux_director";
        q2RunId = run.id;
        outcome = {
          status: "completed",
          details: { evidenceEventId: generated.evidenceEventId, model: generated.model, usage: generated.usage, latencyMs: Date.now() - started },
        };
      } else if (generated === null) {
        outcome = { status: "fallback", error: "timed out or no usable question" };
      }
    } catch (err) {
      outcome = { status: "fallback", error: (err as Error).message.slice(0, 500) };
      ctx.log.warn({ err: (err as Error).message }, "contextual question unavailable; using fallback");
    }
    await ctx.db.agentRun.update({
      where: { id: run.id },
      data: {
        studyId: run.studyId,
        status: outcome.status,
        error: outcome.error ?? null,
        details: (outcome.details ?? { latencyMs: Date.now() - started }) as object,
        finishedAt: new Date(),
      },
    });
  }

  const defs = [
    { questionKey: "q1_ease", position: 1, kind: "ease_scale", text: STANDARD_QUESTIONS.q1_ease.text, source: "standard" },
    { questionKey: "q2_context", position: 2, kind: "open_text", text: q2Text, source: q2Source, agentRunId: q2RunId },
    { questionKey: "q3_improve", position: 3, kind: "open_text", text: STANDARD_QUESTIONS.q3_improve.text, source: "standard" },
  ];
  await ctx.db.interviewQuestion.createMany({ data: defs.map((d) => ({ ...d, studySessionId: sessionId })), skipDuplicates: true });
  return ctx.db.interviewQuestion.findMany({ where: { studySessionId: sessionId }, orderBy: { position: "asc" } });
}

export async function getFeedbackSession(ctx: AppContext, studyPublicId: string, token: string | undefined): Promise<FeedbackSessionResponse> {
  const { session } = await resolveFeedbackAccess(ctx, studyPublicId, token);
  const questions = await ensureQuestions(ctx, session.id);
  const responses = await ctx.db.interviewResponse.count({ where: { studySessionId: session.id } });
  return {
    studyName: session.study.name,
    sessionStatus: session.status,
    alreadySubmitted: responses > 0,
    questions: questions.map(
      (q): FeedbackQuestionDto => ({
        key: q.questionKey,
        position: q.position,
        kind: q.kind as FeedbackQuestionDto["kind"],
        text: q.text,
        source: q.source as FeedbackQuestionDto["source"],
        optional: true,
        ...(q.kind === "ease_scale" ? { options: EASE_SCALE.map((o) => ({ ...o })) } : {}),
      }),
    ),
  };
}

/** Idempotent: the first submitted answer per question is kept. */
export async function submitFeedback(ctx: AppContext, studyPublicId: string, token: string | undefined, raw: unknown) {
  const { ticket, session } = await resolveFeedbackAccess(ctx, studyPublicId, token);
  if (session.status === "invalid") throw gone("session_excluded", "This attempt is no longer active.");
  const input = FeedbackSubmitSchema.parse(raw);
  const questions = await ensureQuestions(ctx, session.id);
  const byKey = new Map(questions.map((q) => [q.questionKey, q]));
  const validChoices = new Set<string>(EASE_SCALE.map((o) => o.value));

  let answered = 0;
  for (const a of input.answers) {
    const q = byKey.get(a.questionKey);
    if (!q) throw new AppError(400, "invalid_request", "Unknown question.");
    const text = a.status === "answered" && q.kind === "open_text" ? sanitizeParticipantText(a.text) : null;
    const choice = a.status === "answered" && q.kind === "ease_scale" && a.choice && validChoices.has(a.choice) ? a.choice : null;
    const status = text || choice ? "answered" : "skipped";
    if (status === "answered") answered++;
    await ctx.db.interviewResponse.upsert({
      where: { questionId: q.id },
      create: { studySessionId: session.id, questionId: q.id, status, text, choice },
      update: {},
    });
  }
  const anyAnswered = (await ctx.db.interviewResponse.count({ where: { studySessionId: session.id, status: "answered" } })) > 0;
  await ctx.db.studySession.update({ where: { id: session.id }, data: { feedbackStatus: anyAnswered ? "submitted" : "skipped" } });
  await ctx.db.sdkTicket.update({ where: { id: ticket.id }, data: { consumedAt: ticket.consumedAt ?? new Date() } });
  await audit(ctx.db, { actorType: "participant", action: "feedback.submitted", resourceType: "study_session", resourceId: session.id, metadata: { answered } });
  return { ok: true, answered };
}
