import type { ReportDetail, ReportSummary } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ReportBadge } from "../../components/status";
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, LinkButton, Spinner } from "../../components/ui";
import { api, errorMessage, post } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useStudy } from "./TestLayout";

export function TestFindingsPage() {
  const { study } = useStudy();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["study-reports", study.id], queryFn: () => api<{ reports: ReportSummary[] }>(`/api/studies/${study.id}/reports`) });
  const create = useMutation({
    mutationFn: () => post<ReportDetail>(`/api/studies/${study.id}/reports`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["study-reports", study.id] });
      navigate(`/app/reports/${r.id}`);
    },
  });
  const analyze = useMutation({
    mutationFn: () => post<ReportDetail>(`/api/studies/${study.id}/analyze`),
    onSuccess: (r) => navigate(`/app/reports/${r.id}`),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Analyze results" description="Get evidence-linked findings from the UX Director, or write your own." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden /> UX Director
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              The UX Director (First Five) analyzes each finished attempt, then scores every finding and recommendation. Anything below the confidence bar is left out; you publish when you're ready.
            </p>
            <Button className="mt-3" variant="secondary" loading={analyze.isPending} onClick={() => analyze.mutate()}>
              Run analysis
            </Button>
            {analyze.error && <p className="mt-2 text-sm text-ink-muted">{errorMessage(analyze.error)}</p>}
          </div>
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-center gap-2 font-medium">
              <FilePlus2 className="h-4 w-4 text-accent" aria-hidden /> Your own findings
            </div>
            <p className="mt-1 text-sm text-ink-muted">Write findings from what you saw, link the supporting sessions and quotes, then review and publish.</p>
            <Button className="mt-3" loading={create.isPending} onClick={() => create.mutate()}>
              Start a report
            </Button>
            {create.error && <Alert tone="danger" className="mt-2">{errorMessage(create.error)}</Alert>}
          </div>
        </div>
      </Card>

      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data &&
        (q.data.reports.length === 0 ? (
          <Card>
            <EmptyState title="No reports yet" description="Reports you start for this test will appear here." />
          </Card>
        ) : (
          <Card>
            <CardHeader title="Reports" />
            <ul className="divide-y divide-line">
              {q.data.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                  <div>
                    <div className="font-medium">{r.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <ReportBadge status={r.status} /> {r.findingCount} finding{r.findingCount === 1 ? "" : "s"} · Updated {timeAgo(r.updatedAt)}
                    </div>
                  </div>
                  <LinkButton to={`/app/reports/${r.id}`} variant="secondary" size="sm">
                    Open
                  </LinkButton>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
