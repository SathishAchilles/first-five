import {
  FEEDBACK_STATUS_LABELS,
  INTEGRATION_STATUS_LABELS,
  PROVIDER_STATUS_LABELS,
  REPORT_STATUS_LABELS,
  SESSION_STATUS_LABELS,
  STUDY_STATUS_LABELS,
  type FeedbackStatus,
  type IntegrationStatus,
  type ProviderStatus,
  type ReportStatus,
  type SessionStatus,
  type StudyStatus,
} from "@firstfive/shared";
import { Pill } from "./ui";

type Tone = Parameters<typeof Pill>[0]["tone"];

export function IntegrationBadge({ status }: { status: IntegrationStatus }) {
  const tone: Record<IntegrationStatus, Tone> = {
    setup_not_started: "neutral",
    awaiting_connection: "warning",
    verification_needed: "info",
    connected: "success",
    connection_issue: "danger",
  };
  return (
    <Pill tone={tone[status]} dot>
      {INTEGRATION_STATUS_LABELS[status]}
    </Pill>
  );
}

export function StudyBadge({ status }: { status: StudyStatus }) {
  const tone: Record<StudyStatus, Tone> = {
    draft: "neutral",
    ready: "info",
    active: "success",
    paused: "warning",
    full: "accent",
    closed: "neutral",
    expired: "neutral",
  };
  return (
    <Pill tone={tone[status]} dot>
      {STUDY_STATUS_LABELS[status]}
    </Pill>
  );
}

export function SessionBadge({ status }: { status: SessionStatus }) {
  const tone: Record<SessionStatus, Tone> = { pending: "info", completed: "success", dropped: "warning", invalid: "neutral" };
  return <Pill tone={tone[status]}>{SESSION_STATUS_LABELS[status]}</Pill>;
}

export function FeedbackBadge({ status }: { status: FeedbackStatus }) {
  const tone: Record<FeedbackStatus, Tone> = { submitted: "accent", awaiting: "info", skipped: "neutral", unavailable: "neutral", not_prompted: "neutral" };
  return <Pill tone={tone[status]}>{FEEDBACK_STATUS_LABELS[status]}</Pill>;
}

export function ReportBadge({ status }: { status: ReportStatus }) {
  const tone: Record<ReportStatus, Tone> = {
    not_generated: "neutral",
    processing: "info",
    draft: "neutral",
    awaiting_review: "warning",
    revision_requested: "warning",
    approved: "success",
    rejected: "danger",
    published: "accent",
    failed: "danger",
    ready: "success",
  };
  return (
    <Pill tone={tone[status]} dot>
      {REPORT_STATUS_LABELS[status]}
    </Pill>
  );
}

export function ProviderBadge({ status }: { status: ProviderStatus }) {
  const tone: Record<ProviderStatus, Tone> = {
    not_configured: "neutral",
    configured: "info",
    verification_pending: "warning",
    verified: "success",
    error: "danger",
  };
  return (
    <Pill tone={tone[status]} dot>
      {PROVIDER_STATUS_LABELS[status]}
    </Pill>
  );
}
