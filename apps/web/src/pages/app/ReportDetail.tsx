import { EVIDENCE_STRENGTHS, EVIDENCE_STRENGTH_LABELS, GOAL_TYPE_SHORT, type FindingDto, type FindingInput, type ReportDetail, type SessionListItem } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Gauge, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FindingCard, MetricsSummary } from "../../components/ReportView";
import { ReportBadge } from "../../components/status";
import { Alert, Button, Card, CardHeader, CopyButton, ErrorState, Field, Input, Select, Spinner, Textarea } from "../../components/ui";
import { api, del, errorMessage, fieldErrors, patch, post, put } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

interface Quote {
  responseId: string;
  sessionId: string;
  participantLabel: string;
  sessionStatus: string;
  questionText: string;
  text: string;
}

/** `readOnly` (admin client review) hides every review, publish and edit control. */
export function ReportDetailPage({ apiPath, readOnly = false, backTo, sessionLinkBase }: { apiPath?: string; readOnly?: boolean; backTo?: string; sessionLinkBase?: string } = {}) {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["report", apiPath ?? id],
    queryFn: () => api<ReportDetail>(apiPath ?? `/api/reports/${id}`),
    // UX Director runs finish in the background; poll until the scored report is ready.
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 5000 : false),
  });
  const [editing, setEditing] = useState<FindingDto | "new" | null>(null);
  const [note, setNote] = useState("");
  const setReport = (r: ReportDetail) => {
    qc.setQueryData(["report", id], r);
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["study-reports", r.studyId] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post<ReportDetail>(`/api/reports/${id}/${path}`, body ?? {}),
    onSuccess: (r) => {
      setReport(r);
      setNote("");
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const editable = !readOnly && r.source === "owner" && (r.status === "draft" || r.status === "revision_requested");

  return (
    <div className="space-y-6">
      <div>
        <Link to={backTo ?? `/app/tests/${r.studyId}/findings`} className="text-sm text-ink-muted hover:text-ink">
          ← {backTo ? "Back to client" : r.studyName}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <ReportBadge status={r.status} />
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {SOURCE_LABELS[r.source]}
          {r.source === "owner" && ` · Revision ${r.revision}`} · Task: {r.task} · {GOAL_TYPE_SHORT[r.goalType]}:{" "}
          <span className="font-mono">{r.goalTarget}</span>
        </p>
      </div>

      {readOnly ? null : r.source === "owner" ? (
        <ReviewPanel r={r} note={note} setNote={setNote} run={(path, body) => action.mutate({ path, body })} pending={action.isPending} />
      ) : (
        <PublishPanel r={r} run={(path) => action.mutate({ path })} pending={action.isPending} />
      )}
      {action.error && <Alert tone="danger">{errorMessage(action.error)}</Alert>}

      {editable && <SummaryEditor r={r} onSaved={setReport} />}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Results snapshot</h2>
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            As of {formatDateTime(r.snapshotAt)}
            {editable && (
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => action.mutate({ path: "refresh-metrics" })}>
                Refresh
              </Button>
            )}
          </span>
        </div>
        <MetricsSummary m={r.metricsSnapshot} />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Findings</h2>
          {editable && editing !== "new" && (
            <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
              Add finding
            </Button>
          )}
        </div>
        <div className="space-y-4">
          {editing === "new" && <FindingEditor report={r} onDone={(nr) => (nr && setReport(nr), setEditing(null))} />}
          {r.findings.length === 0 && editing !== "new" && (
            <Card className="p-6 text-sm text-ink-muted">
              {r.source === "owner"
                ? "No findings yet. Add what you observed, link the sessions that support it, and quote what participants said."
                : r.legacy
                  ? "This legacy report has no findings."
                  : r.status === "processing"
                  ? "Findings appear here when the analysis finishes."
                  : "No finding met the confidence bar for this analysis."}
            </Card>
          )}
          {r.findings.map((f, i) =>
            editing !== "new" && editing?.id === f.id ? (
              <FindingEditor key={f.id} report={r} finding={f} onDone={(nr) => (nr && setReport(nr), setEditing(null))} />
            ) : (
              <FindingCard
                key={f.id}
                index={i}
                f={{
                  ...f,
                  quotes: f.quotes.map((qq) => ({ text: qq.text, who: f.supportingSessions.concat(f.counterSessions).find((s) => s.id === qq.sessionId)?.label })),
                  counterCount: f.counterSessions.length,
                  footer: (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {f.confidenceScore != null && <ScoreLine f={f} />}
                      <div className="text-sm text-ink-muted">
                        {f.supportingSessions.length > 0 && (
                          <>
                            Supporting sessions:{" "}
                            {f.supportingSessions.map((s, j) => (
                              <span key={s.id}>
                                {j > 0 && ", "}
                                <Link to={sessionLinkBase ? `${sessionLinkBase}/${s.id}` : `/app/tests/${r.studyId}/participants/${s.id}`} className="text-accent hover:underline">
                                  {s.label}
                                </Link>
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <CopyButton text={f.assistantPrompt} label="Copy coding-assistant prompt" />
                        {editable && (
                          <>
                            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(f)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Trash2}
                              aria-label="Delete finding"
                              onClick={async () => {
                                if (window.confirm("Delete this finding?")) setReport(await del<ReportDetail>(`/api/reports/${r.id}/findings/${f.id}`));
                              }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  ),
                }}
              />
            ),
          )}
        </div>
      </section>

      {r.approvals.length > 0 && (
        <Card>
          <CardHeader title="Review history" />
          <ul className="divide-y divide-line text-sm">
            {r.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 sm:px-6">
                <span>
                  <span className="font-medium">{DECISION_LABELS[a.decision] ?? a.decision}</span> · revision {a.revision}
                  {a.reviewer && <span className="text-ink-muted"> · {a.reviewer}</span>}
                  {a.note && <span className="block text-ink-muted">“{a.note}”</span>}
                </span>
                <span className="text-ink-muted">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<ReportDetail["source"], string> = {
  owner: "Written by you",
  ux_director: "UX Director (First Five) · scored automatically",
  agenticorg: "Legacy AgenticOrg report",
};

function ScoreLine({ f }: { f: FindingDto }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Gauge className="h-4 w-4 text-accent" aria-hidden /> Finding confidence {f.confidenceScore}/100
      </span>
      <span className="text-ink-muted">
        {f.recommendationScore != null ? `Recommendation confidence ${f.recommendationScore}/100` : "Recommendation didn't meet the confidence bar"}
      </span>
    </div>
  );
}

/** UX Director reports: no review step. Ready → owner publishes; stale and legacy states. */
function PublishPanel({ r, run, pending }: { r: ReportDetail; run: (path: string) => void; pending: boolean }) {
  const navigate = useNavigate();
  const rerun = useMutation({
    mutationFn: () => post<ReportDetail>(`/api/studies/${r.studyId}/analyze`, {}),
    onSuccess: (nr) => navigate(`/app/reports/${nr.id}`),
  });
  const dropped = [
    r.droppedFindings ? `${r.droppedFindings} finding${r.droppedFindings === 1 ? "" : "s"}` : null,
    r.droppedRecommendations ? `${r.droppedRecommendations} recommendation${r.droppedRecommendations === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Publishing</div>
          <p className="mt-1 text-sm text-ink-muted">{r.approvalPolicy.description}</p>

          {r.legacy && (
            <Alert tone="info" className="mt-4">
              This report came from the retired AgenticOrg integration. You can still read it, but it can't be published. Run a new analysis from Findings.
            </Alert>
          )}
          {r.status === "processing" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> The UX Director is analysing each attempt, then scoring every finding. This page updates on its own.
            </p>
          )}
          {r.status === "failed" && (
            <Alert tone="danger" className="mt-4">
              The analysis didn't produce a report{r.failureReason ? `: ${r.failureReason.replace(/[.\s]*$/, "")}.` : "."} Nothing was stored.
            </Alert>
          )}
          {!r.legacy && (r.status === "ready" || r.status === "published") && dropped.length > 0 && (
            <p className="mt-4 text-sm text-ink-muted">{dropped.join(" and ")} didn't meet the confidence bar and {dropped.length > 1 || r.droppedFindings + r.droppedRecommendations > 1 ? "were" : "was"} left out.</p>
          )}
          {!r.legacy && r.status === "ready" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {r.findings.length > 0 ? (
                <Button loading={pending} onClick={() => run("publish")}>
                  Publish report
                </Button>
              ) : (
                <span className="text-sm text-ink-muted">No finding met the confidence bar, so there's nothing to publish.</span>
              )}
            </div>
          )}
          {r.status === "published" && r.shareUrl && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px]">{r.shareUrl}</code>
                <CopyButton text={r.shareUrl} label="Copy link" />
                <a href={r.shareUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("unpublish")}>
                Unpublish
              </Button>
            </div>
          )}
          {(r.legacy || r.status === "failed" || ((r.status === "ready" || r.status === "published") && r.staleBy > 0)) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              {!r.legacy && r.status !== "failed" && r.staleBy > 0 && (
                <span className="text-ink-muted">
                  Out of date by {r.staleBy} attempt{r.staleBy === 1 ? "" : "s"}
                </span>
              )}
              <Button size="sm" variant="secondary" icon={RefreshCw} loading={rerun.isPending} onClick={() => rerun.mutate()}>
                Run analysis again
              </Button>
              {rerun.error && <span className="text-ink-muted">{errorMessage(rerun.error)}</span>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

const DECISION_LABELS: Record<string, string> = {
  requested: "Review requested",
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
};

function ReviewPanel({ r, note, setNote, run, pending }: { r: ReportDetail; note: string; setNote: (s: string) => void; run: (path: string, body?: unknown) => void; pending: boolean }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Review and publishing</div>
          <p className="mt-1 text-sm text-ink-muted">{r.approvalPolicy.description} Drafts are visible only to you.</p>

          {(r.status === "draft" || r.status === "revision_requested") && r.source === "owner" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button icon={Send} loading={pending} disabled={r.findings.length === 0} onClick={() => run("request-review")}>
                Send for review
              </Button>
              {r.findings.length === 0 && <span className="text-sm text-ink-muted">Add at least one finding first.</span>}
            </div>
          )}

          {r.status === "awaiting_review" && r.approvalPolicy.channel === "first_five" && (
            <div className="mt-4 space-y-3">
              <Field label="Review note" optional>
                {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button icon={CheckCircle2} loading={pending} onClick={() => run("review", { decision: "approved", note: note || undefined })}>
                  Approve
                </Button>
                <Button variant="secondary" icon={RotateCcw} disabled={pending} onClick={() => run("review", { decision: "revision_requested", note: note || undefined })}>
                  Request revision
                </Button>
                <Button variant="danger" icon={XCircle} disabled={pending} onClick={() => run("review", { decision: "rejected", note: note || undefined })}>
                  Reject
                </Button>
              </div>
            </div>
          )}
          {r.status === "failed" && (
            <Alert tone="danger" className="mt-4">
              The analysis didn't produce a report{r.failureReason ? `: ${r.failureReason}` : "."} Nothing was stored. Run the analysis again from Findings.
            </Alert>
          )}

          {r.status === "approved" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button loading={pending} onClick={() => run("publish")}>
                Publish report
              </Button>
              {r.source === "owner" && (
                <Button variant="ghost" disabled={pending} onClick={() => run("reopen")}>
                  Reopen for editing
                </Button>
              )}
            </div>
          )}

          {r.status === "rejected" && r.source === "owner" && (
            <div className="mt-4">
              <Button variant="secondary" loading={pending} onClick={() => run("reopen")}>
                Reopen as a new revision
              </Button>
            </div>
          )}

          {r.status === "published" && r.shareUrl && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px]">{r.shareUrl}</code>
                <CopyButton text={r.shareUrl} label="Copy link" />
                <a href={r.shareUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("unpublish")}>
                Stop sharing
              </Button>
            </div>
          )}
          {r.status === "processing" && <p className="mt-4 text-sm text-ink-muted">We're preparing your research report.</p>}
        </div>
      </div>
    </Card>
  );
}

function SummaryEditor({ r, onSaved }: { r: ReportDetail; onSaved: (r: ReportDetail) => void }) {
  const [title, setTitle] = useState(r.title);
  const [summary, setSummary] = useState(r.summary ?? "");
  const save = useMutation({ mutationFn: () => patch<ReportDetail>(`/api/reports/${r.id}`, { title, summary: summary || null }), onSuccess: onSaved });
  const dirty = title !== r.title || summary !== (r.summary ?? "");
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <Field label="Report title">{(p) => <Input {...p} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Summary" optional hint="A few sentences on what you learned.">
        {(p) => <Textarea {...p} rows={3} maxLength={3000} value={summary} onChange={(e) => setSummary(e.target.value)} />}
      </Field>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        {save.error && <span className="text-sm text-danger">{errorMessage(save.error)}</span>}
      </div>
    </Card>
  );
}

function FindingEditor({ report, finding, onDone }: { report: ReportDetail; finding?: FindingDto; onDone: (r: ReportDetail | null) => void }) {
  const sessions = useQuery({ queryKey: ["sessions", report.studyId], queryFn: () => api<{ sessions: SessionListItem[] }>(`/api/studies/${report.studyId}/sessions`) });
  const quotes = useQuery({ queryKey: ["quotes", report.studyId], queryFn: () => api<{ quotes: Quote[] }>(`/api/studies/${report.studyId}/quotes`) });
  const [v, setV] = useState<FindingInput>({
    title: finding?.title ?? "",
    observed: finding?.observed ?? "",
    interpretation: finding?.interpretation ?? "",
    evidenceStrength: finding?.evidenceStrength ?? "inconclusive",
    suggestion: finding?.suggestion ?? "",
    retestMetric: finding?.retestMetric ?? "",
    supportingSessionIds: finding?.supportingSessions.map((s) => s.id) ?? [],
    counterSessionIds: finding?.counterSessions.map((s) => s.id) ?? [],
    quoteResponseIds: finding?.quotes.map((q) => q.responseId) ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FindingInput>(k: K, val: FindingInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const toggle = (k: "supportingSessionIds" | "counterSessionIds" | "quoteResponseIds", id: string) =>
    setV((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...v, interpretation: v.interpretation || undefined, suggestion: v.suggestion || undefined, retestMetric: v.retestMetric || undefined };
      const res = finding ? await put<ReportDetail>(`/api/reports/${report.id}/findings/${finding.id}`, body) : await post<ReportDetail>(`/api/reports/${report.id}/findings`, body);
      onDone(res);
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setSaving(false);
    }
  };

  const sessionList = (sessions.data?.sessions ?? []).filter((s) => s.status !== "invalid");

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h3 className="font-semibold">{finding ? "Edit finding" : "New finding"}</h3>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Issue title" error={fields.title}>
          {(p) => <Input {...p} maxLength={120} value={v.title} onChange={(e) => set("title", e.target.value)} />}
        </Field>
        <Field label="What we observed" hint="Stick to what happened, e.g. “3 participants opened /pricing before signing up.”" error={fields.observed}>
          {(p) => <Textarea {...p} rows={3} value={v.observed} onChange={(e) => set("observed", e.target.value)} />}
        </Field>

        <fieldset>
          <legend className="text-sm font-medium">Supporting sessions</legend>
          <p className="mt-0.5 text-sm text-ink-muted">The number of affected attempts is calculated from the sessions you select.</p>
          {sessionList.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No participant sessions yet.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {sessionList.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span>
                    {s.participantLabel} <span className="text-ink-muted">· {s.status === "completed" ? "Completed" : s.status === "dropped" ? "Didn't complete" : "In progress"}</span>
                  </span>
                  <span className="flex gap-3">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" className="accent-accent" checked={v.supportingSessionIds.includes(s.id)} onChange={() => toggle("supportingSessionIds", s.id)} disabled={v.counterSessionIds.includes(s.id)} />
                      Supports
                    </label>
                    <label className="flex items-center gap-1 text-ink-muted">
                      <input type="checkbox" className="accent-accent" checked={v.counterSessionIds.includes(s.id)} onChange={() => toggle("counterSessionIds", s.id)} disabled={v.supportingSessionIds.includes(s.id)} />
                      Contradicts
                    </label>
                  </span>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">What participants told us</legend>
          <p className="mt-0.5 text-sm text-ink-muted">Choose exact answers to quote. Quotes can't be edited.</p>
          {(quotes.data?.quotes ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">We don't have written feedback from participants yet.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {quotes.data!.quotes.map((qq) => (
                <label key={qq.responseId} className="flex gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-accent" checked={v.quoteResponseIds.includes(qq.responseId)} onChange={() => toggle("quoteResponseIds", qq.responseId)} />
                  <span>
                    <span className="italic">“{qq.text}”</span>
                    <span className="block text-xs text-ink-muted">
                      {qq.participantLabel} · {qq.questionText}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <Field label="What this might mean" optional hint="A possible explanation — keep it tentative." error={fields.interpretation}>
          {(p) => <Textarea {...p} rows={2} value={v.interpretation ?? ""} onChange={(e) => set("interpretation", e.target.value)} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Evidence strength">
            {(p) => (
              <Select {...p} value={v.evidenceStrength} onChange={(e) => set("evidenceStrength", e.target.value as FindingInput["evidenceStrength"])}>
                {EVIDENCE_STRENGTHS.map((s) => (
                  <option key={s} value={s}>
                    {EVIDENCE_STRENGTH_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Metric to retest" optional>
            {(p) => <Input {...p} placeholder="e.g. Completed attempts" value={v.retestMetric ?? ""} onChange={(e) => set("retestMetric", e.target.value)} />}
          </Field>
        </div>
        <Field label="What to try next" optional error={fields.suggestion}>
          {(p) => <Textarea {...p} rows={2} value={v.suggestion ?? ""} onChange={(e) => set("suggestion", e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save finding
          </Button>
        </div>
      </form>
    </Card>
  );
}
