/**
 * Builds the sanitized, bounded evidence package sent to the UX Director, plus
 * the scope used to validate whatever comes back. Only pseudonymous IDs,
 * normalized routes, safe element labels and the participants' own answers are
 * included — never invite labels, emails or form values.
 */
import type { StudyMetrics } from "@firstfive/shared";
import type { AppContext } from "../context";
import { safeCustomProps, type EvidenceEvent, type EvidencePackage } from "../ux-director/types";
import type { EvidenceScope } from "./research-output";
import { orderEvents } from "./timeline";

export const MAX_SESSIONS = 25;
export const MAX_EVENTS_PER_SESSION = 100;
const BEHAVIOR_EVENTS = new Set(["ff_page_viewed", "ff_element_clicked", "ff_form_submitted", "ff_custom_event", "ff_client_error"]);

export interface BuiltEvidence {
  pkg: EvidencePackage;
  scope: EvidenceScope;
  /** session publicId → internal StudySession.id */
  sessionIdByPublicId: Map<string, string>;
}

function intendedPath(startPath: string, goalType: string, goalTarget: string, goalPagePath: string | null, milestones: unknown): string[] {
  const path = [startPath];
  const list = Array.isArray(milestones) ? (milestones as { type?: string; target?: string }[]) : [];
  for (const m of list) if (m.type === "page_reached" && m.target) path.push(m.target);
  const goalPage = goalType === "page_reached" ? goalTarget : goalPagePath;
  if (goalPage) path.push(goalPage);
  return path.filter((p, i) => i === 0 || p !== path[i - 1]);
}

export async function buildEvidence(
  ctx: AppContext,
  args: { studyId: string; studyPublicId: string; version: number; snapshotId: string; snapshotAt: Date; metrics: StudyMetrics },
): Promise<BuiltEvidence> {
  const version = await ctx.db.studyVersion.findUniqueOrThrow({ where: { studyId_version: { studyId: args.studyId, version: args.version } } });
  const sessions = await ctx.db.studySession.findMany({
    where: { studyId: args.studyId, studyVersionId: version.id, isRepeat: false, status: { in: ["completed", "dropped"] } },
    include: {
      events: true,
      responses: { where: { status: "answered" }, include: { question: true } },
    },
    orderBy: { startedAt: "asc" },
    take: MAX_SESSIONS,
  });

  const scope: EvidenceScope = {
    studyPublicId: args.studyPublicId,
    sessionPublicIds: new Set(),
    eventIdsBySession: new Map(),
    responseIdsBySession: new Map(),
    answerTextByResponse: new Map(),
  };
  const sessionIdByPublicId = new Map<string, string>();

  const pkgSessions = sessions.map((s) => {
    const events = orderEvents(s.events.filter((e) => BEHAVIOR_EVENTS.has(e.eventName))).slice(0, MAX_EVENTS_PER_SESSION);
    scope.sessionPublicIds.add(s.publicId);
    scope.eventIdsBySession.set(s.publicId, new Set(events.map((e) => e.eventId)));
    scope.responseIdsBySession.set(s.publicId, new Set(s.responses.map((r) => r.id)));
    for (const r of s.responses) if (r.text) scope.answerTextByResponse!.set(r.id, r.text);
    sessionIdByPublicId.set(s.publicId, s.id);
    const end = s.goalVerifiedAt ?? s.finalizedAt;
    return {
      session_id: s.publicId,
      outcome: s.status,
      final_reason: s.finalReason,
      duration_s: end ? Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 1000)) : null,
      data_quality_flag: s.dataQualityFlags.length ? s.dataQualityFlags.join(",") : null,
      events: events.map((e): EvidenceEvent => {
        const base: EvidenceEvent = {
          event_id: e.eventId,
          seq: e.clientSequence,
          name: e.eventName,
          route: e.pagePath,
          element_key: e.elementKey,
          element_label: e.elementLabel,
          t_ms: Math.max(0, e.clientTimestamp.getTime() - s.startedAt.getTime()),
        };
        if (e.eventName !== "ff_custom_event") return base;
        const props = (e.properties ?? {}) as Record<string, unknown>;
        const name = typeof props.custom_event_name === "string" ? props.custom_event_name : null;
        const kept = safeCustomProps(props);
        return { ...base, ...(name ? { custom_event: name } : {}), ...(Object.keys(kept).length ? { props: kept } : {}) };
      }),
      feedback: [...s.responses]
        .sort((a, b) => a.question.position - b.question.position)
        .map((r) => ({
          response_id: r.id,
          slot: `Q${r.question.position}`,
          displayed_question: r.question.text,
          answer_text: r.text,
          choice: r.choice,
        })),
    };
  });

  const m = args.metrics;
  return {
    pkg: {
      study: {
        study_id: args.studyPublicId,
        version: args.version,
        task_text: version.task,
        start_path: version.startPath,
        goal: { type: version.goalType, target: version.goalTarget },
        intended_path: intendedPath(version.startPath, version.goalType, version.goalTarget, version.goalPagePath, version.milestones),
        milestones: Array.isArray(version.milestones) ? (version.milestones as unknown[]) : [],
      },
      snapshot: {
        snapshot_id: args.snapshotId,
        data_cutoff_at: args.snapshotAt.toISOString(),
        metrics: {
          valid_started: m.completed + m.dropped + m.pending,
          completed: m.completed,
          dropped: m.dropped,
          pending: m.pending,
          finalized: m.finalized,
          median_time_s: m.medianCompletionMs == null ? null : Math.round(m.medianCompletionMs / 1000),
          feedback_responses: m.feedbackCoverage.numerator,
        },
      },
      sessions: pkgSessions,
    },
    scope,
    sessionIdByPublicId,
  };
}

/** Rebuilds the validation scope from a stored evidence package (used when a run resumes). */
export function scopeFromPackage(pkg: EvidencePackage): EvidenceScope {
  const scope: EvidenceScope = {
    studyPublicId: pkg.study.study_id,
    sessionPublicIds: new Set(),
    eventIdsBySession: new Map(),
    responseIdsBySession: new Map(),
    answerTextByResponse: new Map(),
  };
  for (const s of pkg.sessions) {
    scope.sessionPublicIds.add(s.session_id);
    scope.eventIdsBySession.set(s.session_id, new Set(s.events.map((e) => e.event_id)));
    scope.responseIdsBySession.set(s.session_id, new Set(s.feedback.map((f) => f.response_id)));
    for (const f of s.feedback) if (f.answer_text) scope.answerTextByResponse!.set(f.response_id, f.answer_text);
  }
  return scope;
}
