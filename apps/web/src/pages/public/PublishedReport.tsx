import type { GoalType, StudyMetrics } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Logo } from "../../components/layouts";
import { ReportDocument, type ViewFinding } from "../../components/ReportView";
import { ErrorState, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";

interface PublicReport {
  title: string;
  summary: string | null;
  studyName: string;
  task: string;
  goalType: GoalType;
  goalTarget: string;
  metricsSnapshot: StudyMetrics;
  snapshotAt: string;
  publishedAt: string | null;
  source: "owner" | "ux_director" | "agenticorg";
  findings: Omit<ViewFinding, "footer">[];
}

export function PublishedReportPage() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ["public-report", token], queryFn: () => api<PublicReport>(`/api/public/reports/${token}`) });
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {q.isLoading && <Spinner />}
        {q.error && <ErrorState message={errorMessage(q.error)} />}
        {q.data && (
          <ReportDocument
            title={q.data.title}
            studyName={q.data.studyName}
            task={q.data.task}
            goalType={q.data.goalType}
            goalTarget={q.data.goalTarget}
            metrics={q.data.metricsSnapshot}
            meta={`Published ${formatDate(q.data.publishedAt)} · Numbers as of ${formatDate(q.data.snapshotAt)} · ${q.data.source === "owner" ? "Written and approved by the website owner" : "Findings by the UX Director (First Five), scored automatically, shared by the project owner"}`}
            summary={q.data.summary}
            findings={q.data.findings}
          />
        )}
      </main>
    </div>
  );
}
