import { EASE_SCALE, FINAL_REASON_LABELS, type SessionDetail, describeCustomEventDetails } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Flag, Repeat, Undo2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { FeedbackBadge, SessionBadge } from "../../components/status";
import { Alert, Card, CardHeader, ErrorState, Pill, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, formatDuration } from "../../lib/format";
import { describeEvent } from "./TestParticipants";

/** `apiPath` and `backTo` let the admin client review show the same view through the admin API. */
export function SessionDetailPage({ apiPath, backTo }: { apiPath?: string; backTo?: string } = {}) {
  const { sessionId, id } = useParams();
  const path = apiPath ?? `/api/sessions/${sessionId}/details`;
  const q = useQuery({ queryKey: ["session", path], queryFn: () => api<SessionDetail>(path) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  const s = q.data!;
  const timeline = s.timeline.filter((e) => e.name !== "ff_activity");
  const answered = s.feedback.filter((f) => f.status === "answered");

  return (
    <div className="space-y-6">
      <Link to={backTo ?? `/app/tests/${id}/participants`} className="text-sm text-ink-muted hover:text-ink">
        ← {backTo ? "Back to client" : "All participants"}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{s.participantLabel}</h2>
        <SessionBadge status={s.status} />
        <FeedbackBadge status={s.feedbackStatus} />
      </div>
      {s.dataQualityFlags.length > 0 && (
        <Alert tone="warning" title="Data quality note">
          {s.dataQualityFlags.map((f) => QUALITY_LABELS[f] ?? f).join(" · ")}
        </Alert>
      )}

      <Card className="grid gap-5 p-5 sm:grid-cols-4 sm:p-6">
        <Metric label={s.status === "completed" ? "Time to complete" : "Time spent"} value={formatDuration(s.timeToGoalMs ?? s.durationMs)} />
        <Metric label="Clicks" value={String(s.clickCount)} sub={s.repeatedInteractions ? `${s.repeatedInteractions} repeated` : undefined} />
        <Metric label="Pages visited" value={String(s.pagesVisited)} sub={s.backtracks ? `Went back ${s.backtracks}×` : undefined} />
        <Metric label="How it ended" value={s.finalReason ? FINAL_REASON_LABELS[s.finalReason] ?? s.finalReason : "In progress"} small />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Timeline" description={`Started ${formatDateTime(s.startedAt)} · Deadline ${formatDateTime(s.deadlineAt)}`} />
          {timeline.length === 0 ? (
            <p className="p-6 text-sm text-ink-muted">We didn't receive any activity from the website for this attempt.</p>
          ) : (
            <ol className="relative space-y-0 p-5 sm:p-6">
              {timeline.map((e, i) => (
                <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < timeline.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-line" aria-hidden />}
                  <span
                    className={clsx(
                      "relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2",
                      e.isGoal ? "border-success bg-success" : e.name === "ff_client_error" ? "border-danger bg-danger-soft" : "border-accent bg-surface",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{describeEvent(e)}</span>
                      {e.isGoal && (
                        <Pill tone="success">
                          <Flag className="h-3 w-3" aria-hidden /> Goal verified
                        </Pill>
                      )}
                      {e.isBacktrack && (
                        <Pill tone="warning">
                          <Undo2 className="h-3 w-3" aria-hidden /> Went back
                        </Pill>
                      )}
                      {e.isRepeat && (
                        <Pill tone="warning">
                          <Repeat className="h-3 w-3" aria-hidden /> Repeated
                        </Pill>
                      )}
                    </div>
                    {e.name === "ff_custom_event" && describeCustomEventDetails(e.details) && (
                      <div className="mt-0.5 text-xs text-ink-soft">{describeCustomEventDetails(e.details)}</div>
                    )}
                    <div className="mt-0.5 text-xs tabular-nums text-ink-muted">+{formatDuration(e.offsetMs)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {s.status === "dropped" && (
            <p className="border-t border-line px-5 py-3 text-xs text-ink-muted sm:px-6">The last observed step isn't necessarily the reason someone stopped.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="What they told us" />
          <div className="space-y-5 p-5 sm:p-6">
            {answered.length === 0 && (
              <p className="text-sm text-ink-muted">{s.status === "dropped" ? "Reason unknown — this participant didn't leave feedback." : "We don't have an explanation from this participant."}</p>
            )}
            {s.feedback.map((f) => (
              <div key={f.questionKey}>
                <div className="text-sm font-medium">{f.questionText}</div>
                {f.questionSource === "fallback" && <div className="text-xs text-ink-muted">Standard question</div>}
                <div className="mt-1 text-sm">
                  {f.status === "answered" ? (
                    f.choice ? (
                      EASE_SCALE.find((o) => o.value === f.choice)?.label ?? f.choice
                    ) : (
                      <p className="whitespace-pre-line border-l-2 border-accent/40 pl-3 italic">“{f.text}”</p>
                    )
                  ) : (
                    <span className="text-ink-muted">{f.status === "skipped" ? "Skipped" : "No answer"}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

const QUALITY_LABELS: Record<string, string> = {
  no_sdk_handshake: "The website never confirmed this attempt started, so it's excluded from results.",
  late_goal_event: "A goal event arrived after the time limit and wasn't counted.",
  consent_withdrawn: "The participant withdrew consent; their activity was deleted.",
};

function Metric({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-sm text-ink-muted">{label}</div>
      <div className={clsx("mt-1 font-semibold tabular-nums", small ? "text-base" : "text-2xl")}>{value}</div>
      {sub && <div className="text-sm text-ink-muted">{sub}</div>}
    </div>
  );
}
