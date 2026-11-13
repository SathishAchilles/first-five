import { useParams } from "react-router-dom";
import { ReportDetailPage } from "../ReportDetail";
import { SessionDetailPage } from "../SessionDetail";

/** A tester session of one client, read through the admin API (each open is audited). */
export function AdminSessionPage() {
  const { clientId, sessionId } = useParams();
  return <SessionDetailPage apiPath={`/api/admin/clients/${clientId}/sessions/${sessionId}`} backTo={`/app/admin/clients/${clientId}`} />;
}

/** A client's report, read-only: no review, publish or edit controls. */
export function AdminReportPage() {
  const { clientId, reportId } = useParams();
  return (
    <ReportDetailPage
      apiPath={`/api/admin/clients/${clientId}/reports/${reportId}`}
      readOnly
      backTo={`/app/admin/clients/${clientId}`}
      sessionLinkBase={`/app/admin/clients/${clientId}/sessions`}
    />
  );
}
