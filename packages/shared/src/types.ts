/** API response shapes shared by the server and the web app. */

export type IntegrationStatus =
  | "setup_not_started"
  | "awaiting_connection"
  | "verification_needed"
  | "connected"
  | "connection_issue";
export type StudyStatus = "draft" | "ready" | "active" | "paused" | "full" | "closed" | "expired";
export type SessionStatus = "pending" | "completed" | "dropped" | "invalid";
export type FeedbackStatus = "not_prompted" | "awaiting" | "submitted" | "skipped" | "unavailable";
export type GoalType = "element_clicked" | "page_reached" | "custom_event";
export type ReportStatus =
  | "not_generated"
  | "processing"
  | "draft"
  | "awaiting_review"
  | "revision_requested"
  | "approved"
  | "rejected"
  | "published"
  | "failed"
  | "ready";
/** "ux_director" = in-house UX Director; "agenticorg" = legacy, read-only. */
export type ReportSource = "owner" | "ux_director" | "agenticorg";
export type ProviderStatus = "not_configured" | "configured" | "verification_pending" | "verified" | "error";

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface Entitlement {
  /** "none": no paid or complimentary access yet → access choices only. */
  status: "none" | "active";
  planName: string;
  sources: string[];
  studyCredits: number;
  creditsUsed: number;
  creditsAvailable: number;
  maxProjects: number;
  maxParticipantsPerStudy: number;
  usage: { projects: number; studies: number; draftStudies: number };
  expiresAt: string | null;
}

export interface MeResponse {
  user: { id: string; email: string; name: string | null; role: "user" | "admin"; createdAt: string };
  entitlement: Entitlement;
}

export interface ProjectSummary {
  id: string;
  publicId: string;
  name: string;
  websiteUrl: string;
  description: string | null;
  integrationStatus: IntegrationStatus;
  studyCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface SnippetInfo {
  /** True when SDK_SCRIPT_URL is configured; otherwise the snippet is a setup preview. */
  isPreview: boolean;
  scriptUrl: string;
  apiBaseUrl: string;
  html: string;
  assistantPrompt: string;
}

export interface ProjectDetail extends ProjectSummary {
  canonicalOrigin: string;
  origins: { origin: string; verifiedAt: string | null }[];
  lastConfigPingAt: string | null;
  firstConnectedAt: string | null;
  lastSdkVersion: string | null;
  lastIssue: string | null;
  lastIssueAt: string | null;
  snippet: SnippetInfo;
}

export interface ConnectionCheck {
  integrationStatus: IntegrationStatus;
  checkedAt: string;
  lastConfigPingAt: string | null;
  lastActivityAt: string | null;
  lastIssue: string | null;
  message: string;
}

export interface DiscoveryResponse {
  integrationStatus: IntegrationStatus;
  lastActivityAt: string | null;
  pages: { path: string; viewCount: number; firstSeenAt: string; lastSeenAt: string }[];
  elements: {
    id: string;
    pagePath: string;
    elementKey: string;
    elementType: string;
    safeLabel: string | null;
    wasClicked: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
  }[];
  customEvents: { eventName: string; lastSeenAt: string }[];
  activeSetupSession: { id: string; expiresAt: string; eventCount: number } | null;
}

export interface SetupLaunchResponse {
  setupSessionId: string;
  launchUrl: string;
  expiresAt: string;
}

export interface StudyVersionDto {
  version: number;
  task: string;
  startPath: string;
  startVerified: boolean;
  goalType: GoalType;
  goalTarget: string;
  goalPagePath: string | null;
  goalVerified: boolean;
  timeLimitSeconds: number;
  milestones: { label: string; type: GoalType; target: string }[];
  repeatPolicy: string;
  publishedAt: string | null;
}

export interface StudySummary {
  id: string;
  publicId: string;
  name: string;
  status: StudyStatus;
  projectId: string;
  projectName: string;
  websiteUrl: string;
  participantLimit: number;
  participantCount: number;
  createdAt: string;
  launchedAt: string | null;
}

export interface LaunchReadiness {
  canLaunch: boolean;
  blockers: { code: string; message: string }[];
}

export interface StudyDetail extends StudySummary {
  expiresAt: string | null;
  currentVersion: StudyVersionDto;
  versions: number[];
  shareUrl: string;
  hasParticipants: boolean;
  readiness: LaunchReadiness;
}

export interface RateValue {
  numerator: number;
  denominator: number;
  /** Whole-number percentage, null when the denominator is zero. */
  percent: number | null;
}

export interface StudyMetrics {
  attempts: number;
  uniqueParticipants: number;
  completed: number;
  dropped: number;
  pending: number;
  invalid: number;
  repeatsExcluded: number;
  finalized: number;
  completionRate: RateValue;
  dropRate: RateValue;
  medianCompletionMs: number | null;
  feedbackCoverage: RateValue;
}

export type AnalyticsDetailsStatus = "ready" | "processing" | "unavailable" | "not_configured";

/** PostHog-sourced journey details for one study version. Counts on the dashboard stay Postgres-authoritative. */
export interface AnalyticsDetails {
  status: AnalyticsDetailsStatus;
  computedAt: string | null;
  /** Latest PostHog event timestamp included in this snapshot. */
  eventCutoff: string | null;
  cohortSize: number;
  elements: { path: string | null; elementKey: string; label: string | null; sessions: number; clicks: number }[];
  paths: { steps: string[]; sessions: number; completed: number }[];
  transitions: { from: string; to: string; sessions: number }[];
  /** Last observed step of dropped attempts; never a stated cause. */
  lastStepBeforeDrop: { sessionPublicId: string; path: string | null; elementKey: string | null }[];
  /** `observed: false` means no ff_client_error arrived, which is not the same as "no errors". */
  errors: { observed: false } | { observed: true; byPath: { path: string | null; count: number; sessions: number }[] };
  dataQuality: {
    postgresEvents: number;
    posthogEvents: number;
    missingInPosthog: number;
    sessionsWithoutEvents: number;
    outbox: { pending: number; failed: number; dead: number };
    deliveryLagMs: number | null;
  };
}

export interface DashboardResponse {
  study: StudyDetail;
  metrics: StudyMetrics;
  version: number;
  dataUpdatedAt: string;
  behavior: {
    available: boolean;
    topPages: { path: string; attempts: number }[];
    funnel: { label: string; reached: number; previous: number }[] | null;
  };
  analytics: { provider: "postgres" | "posthog"; posthogStatus: ProviderStatus; details: AnalyticsDetails | null };
  insights: { available: boolean; uxDirectorStatus: ProviderStatus; latestReport: ReportSummary | null };
}

export interface SessionListItem {
  id: string;
  publicId: string;
  participantLabel: string;
  status: SessionStatus;
  isRepeat: boolean;
  startedAt: string;
  finalizedAt: string | null;
  finalReason: string | null;
  durationMs: number | null;
  timeToGoalMs: number | null;
  clickCount: number;
  pagesVisited: number;
  backtracks: number;
  repeatedInteractions: number;
  lastEvent: { name: string; pagePath: string | null; label: string | null; at: string } | null;
  clientErrors: number;
  feedbackStatus: FeedbackStatus;
  dataQualityFlags: string[];
}

export interface TimelineEvent {
  id: string;
  eventId: string;
  name: string;
  at: string;
  offsetMs: number;
  sequence: number | null;
  pagePath: string | null;
  elementKey: string | null;
  elementType: string | null;
  label: string | null;
  /** Name sent with ff_custom_event (e.g. "cta_hesitate"); null for other events. */
  customName: string | null;
  /** Display-safe details for custom events (see DISPLAY_DETAIL_KEYS). */
  details: Record<string, string | number | boolean> | null;
  isGoal: boolean;
  isBacktrack: boolean;
  isRepeat: boolean;
}

export interface FeedbackAnswerDto {
  responseId: string | null;
  questionKey: string;
  questionText: string;
  questionSource: string;
  status: "answered" | "skipped" | "missing";
  choice: string | null;
  text: string | null;
  submittedAt: string | null;
}

export interface SessionDetail extends SessionListItem {
  studyId: string;
  deadlineAt: string;
  goalVerifiedAt: string | null;
  timeline: TimelineEvent[];
  feedback: FeedbackAnswerDto[];
}

export interface FindingDto {
  id: string;
  title: string;
  observed: string;
  quotes: { sessionId: string; responseId: string; text: string }[];
  interpretation: string | null;
  evidenceStrength: "inconclusive" | "limited" | "supported";
  suggestion: string | null;
  retestMetric: string | null;
  affectedCount: number;
  supportingSessions: { id: string; label: string; status: SessionStatus }[];
  counterSessions: { id: string; label: string; status: SessionStatus }[];
  source: ReportSource;
  assistantPrompt: string;
  /** UX Director rubric score for the finding (0–100); null for owner-written findings. */
  confidenceScore: number | null;
  /** UX Director rubric score for the recommendation (0–100); null when none was kept. */
  recommendationScore: number | null;
}

export interface ReportSummary {
  id: string;
  studyId: string;
  studyName: string;
  title: string;
  status: ReportStatus;
  source: ReportSource;
  revision: number;
  findingCount: number;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ReportDetail extends ReportSummary {
  summary: string | null;
  studyVersion: number;
  task: string;
  goalType: GoalType;
  goalTarget: string;
  metricsSnapshot: StudyMetrics;
  snapshotAt: string;
  findings: FindingDto[];
  approvals: { id: string; decision: string; channel: string; reviewer: string | null; note: string | null; revision: number; createdAt: string }[];
  shareUrl: string | null;
  approvalPolicy: { channel: "first_five" | "automated" | "agenticorg"; description: string };
  /** Why a UX Director analysis failed (validation or provider error). */
  failureReason: string | null;
  /** Run reference for UX Director reports (agent run id; AgenticOrg correlation_id for legacy reports). */
  externalRunId: string | null;
  /** Finished attempts since the snapshot that this report doesn't include (0 when current). */
  staleBy: number;
  /** Produced by the retired AgenticOrg integration: viewable, not publishable. */
  legacy: boolean;
  /** Findings / recommendations removed by UX Director rubric scoring. */
  droppedFindings: number;
  droppedRecommendations: number;
}

export interface PublicStudyInfo {
  studyId: string;
  name: string;
  task: string;
  timeLimitSeconds: number;
  websiteName: string;
  status: "open" | "closed" | "full" | "expired" | "paused" | "not_launched";
  consentTextVersion: string;
  /** Present when this browser already has an attempt on this study. */
  existingAttempt: AttemptState | null;
}

export interface AttemptState {
  sessionId: string;
  status: SessionStatus;
  deadlineAt: string;
  launchUrl: string | null;
  isRepeat: boolean;
  feedbackStatus: FeedbackStatus;
  feedbackUrl: string | null;
}

export interface FeedbackQuestionDto {
  key: string;
  position: number;
  kind: "ease_scale" | "open_text";
  text: string;
  source: "standard" | "fallback" | "ux_director" | "agenticorg";
  optional: boolean;
  options?: { value: string; label: string }[];
}

export interface FeedbackSessionResponse {
  studyName: string;
  sessionStatus: SessionStatus;
  questions: FeedbackQuestionDto[];
  alreadySubmitted: boolean;
}

export interface ProviderStatusDto {
  provider: "sdk" | "posthog" | "ux_director" | "pinelabs" | "postgres";
  name: string;
  status: ProviderStatus;
  description: string;
  configuredKeys: { key: string; present: boolean }[];
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  details: Record<string, unknown> | null;
}

export interface InvitationCodeDto {
  id: string;
  label: string;
  audience: string;
  planKey: string;
  codeHint: string;
  studyCredits: number;
  participantCap: number;
  maxRedemptions: number;
  redemptionCount: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
}

export interface PaidOffer {
  key: string;
  name: string;
  priceMinor: number;
  currency: string;
  priceLabel: string;
  studyCredits: number;
  maxParticipantsPerStudy: number;
  /** True only when checkout is explicitly enabled AND the provider is implemented and configured. */
  checkoutAvailable: boolean;
  /** "upi_manual": pay by UPI, confirmed by the First Five team. "pinelabs": hosted checkout. */
  paymentMethod: "upi_manual" | "pinelabs" | null;
  environment: "uat" | "live";
  unavailableReason: string | null;
}

export interface UpiPaymentInstructions {
  payeeVpa: string;
  payeeName: string;
  amount: string;
  amountLabel: string;
  /** Unique reference the payer adds to the UPI note. */
  reference: string;
  /** upi://pay deep link for mobile UPI apps. */
  uri: string;
}

export interface OrderStatusDto {
  id: string;
  status: "created" | "checkout_ready" | "pending_verification" | "paid_verified" | "failed" | "cancelled" | "refunded" | "verification_error";
  environment: "uat" | "live";
  amountLabel: string;
  planName: string;
  method: "upi_manual" | "pinelabs";
  reference: string;
  /** Present while the buyer still needs to pay (UPI). */
  upi: UpiPaymentInstructions | null;
  /** The UPI transaction ID the buyer submitted, if any. */
  submittedUtr: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPaymentDto {
  orderId: string;
  reference: string;
  status: OrderStatusDto["status"];
  environment: "uat" | "live";
  amountLabel: string;
  buyerEmail: string;
  utr: string | null;
  /** Rejected by an admin; can still be confirmed if the money did arrive. */
  correctable: boolean;
  createdAt: string;
  updatedAt: string;
}
