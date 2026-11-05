/** Customer-facing, plain-language labels for internal states. */

export const INTEGRATION_STATUS_LABELS = {
  setup_not_started: "Setup not started",
  awaiting_connection: "Waiting for connection",
  verification_needed: "Verification needed",
  connected: "Connected",
  connection_issue: "Connection issue",
} as const;

export const INTEGRATION_STATUS_HELP = {
  setup_not_started: "Add the First Five code to your website to begin.",
  awaiting_connection: "We haven't received activity from your website yet.",
  verification_needed:
    "Your website loaded First Five. Walk through your journey once so we can confirm activity is arriving.",
  connected: "We're receiving activity from your website.",
  connection_issue: "We received activity we couldn't accept. Check the details below.",
} as const;

export const STUDY_STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  full: "Full",
  closed: "Closed",
  expired: "Expired",
} as const;

export const SESSION_STATUS_LABELS = {
  pending: "Still in progress",
  completed: "Completed",
  dropped: "Didn't complete",
  invalid: "Excluded",
} as const;

export const FINAL_REASON_LABELS: Record<string, string> = {
  goal_verified: "Reached the goal",
  explicit_stop: "Said they were stuck",
  finished_without_goal: "Finished without reaching the goal",
  deadline: "Ran out of time",
  launch_not_exchanged: "Website never confirmed the test started",
  consent_withdrawn: "Withdrew consent",
};

export const FEEDBACK_STATUS_LABELS = {
  not_prompted: "Not asked yet",
  awaiting: "Waiting for answers",
  submitted: "Feedback given",
  skipped: "Skipped",
  unavailable: "No feedback",
} as const;

export const GOAL_TYPE_LABELS = {
  element_clicked: "A specific button or link was clicked",
  page_reached: "A destination page was reached",
  custom_event: "A custom completion event occurred",
} as const;

export const GOAL_TYPE_SHORT = {
  element_clicked: "Click outcome",
  page_reached: "Page reached",
  custom_event: "Custom completion event",
} as const;

export const REPORT_STATUS_LABELS = {
  not_generated: "Not generated",
  processing: "Processing",
  draft: "Draft",
  awaiting_review: "Awaiting review",
  revision_requested: "Revision requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  failed: "Failed",
  ready: "Ready",
} as const;

export const EVIDENCE_STRENGTH_LABELS = {
  inconclusive: "Inconclusive",
  limited: "Limited evidence",
  supported: "Supported",
} as const;

export const PROVIDER_STATUS_LABELS = {
  not_configured: "Not configured",
  configured: "Configured",
  verification_pending: "Verification pending",
  verified: "Verified",
  error: "Degraded / Error",
} as const;

// ───────────────────────── Custom event context ─────────────────────────

export type EventDetails = Record<string, string | number | boolean>;

/** Internal keys that never add context for a reader. */
const INTERNAL_KEYS = new Set(["custom_event_name", "ff_site"]);
/**
 * Free-text values under these keys can carry what a person typed or selected; they are
 * never returned to the dashboard (booleans and numbers under them are fine, e.g. has_email).
 */
const SENSITIVE_TEXT_KEY = /text|select|query|search|message|comment|note|email|phone|mobile|name|address|value|input|token|pass|otp|card|cvv|iban|ssn|dob|birth/i;
/** Keys whose value names the thing the event is about, in order of preference. */
const SUBJECT_KEYS = ["label", "cta", "element", "product", "field", "section", "step", "item"];

/** Every display-safe property of a custom event (strings capped at 60 chars, at most 10). */
export function pickDisplayDetails(props: unknown): EventDetails | null {
  if (!props || typeof props !== "object") return null;
  const out: EventDetails = {};
  for (const [key, v] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= 10) break;
    if (INTERNAL_KEYS.has(key)) continue;
    if (typeof v === "string") {
      if (!v.trim() || SENSITIVE_TEXT_KEY.test(key)) continue;
      out[key] = v.trim().slice(0, 60);
    } else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** "cta_hesitate" -> "Cta hesitate". */
export function humanizeEventName(name: string): string {
  const words = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Custom event";
}

function humanizeKey(key: string): string {
  return humanizeEventName(key.replace(/_(ms|pct|percent)$/i, "").replace(/^ff_/, ""));
}

function formatValue(key: string, v: string | number | boolean): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (/_ms$/i.test(key)) return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
    if (/depth|pct|percent/i.test(key)) return `${v}%`;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return v.replace(/_/g, " ");
}

function subjectOf(d: EventDetails): { key: string; value: string } | null {
  for (const key of SUBJECT_KEYS) {
    const v = d[key];
    if (typeof v === "string" && v) return { key, value: v.replace(/_/g, " ") };
  }
  return null;
}

/**
 * Headline for a website-reported event, built only from the data it carries:
 * name, what it was about, and where it happened, e.g. `Cta hesitate "place order" on /checkout`.
 */
export function describeCustomEvent(
  name: string | null | undefined,
  details: EventDetails | null | undefined,
  pagePath?: string | null,
): string {
  const d = details ?? {};
  const subject = subjectOf(d);
  const page = pagePath || (typeof d.ff_page === "string" ? d.ff_page : null);
  return [
    name ? humanizeEventName(name) : "Custom event",
    subject ? `“${subject.value}”` : "",
    page ? `on ${page.startsWith("/") ? page : `/${page}`}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Secondary line with every other property, e.g. `Dwell 5.2s · Max depth 60% · Converted no`. */
export function describeCustomEventDetails(details: EventDetails | null | undefined): string {
  const d = details ?? {};
  const subject = subjectOf(d);
  return Object.entries(d)
    .filter(([key]) => key !== "ff_page" && key !== subject?.key)
    .map(([key, v]) => `${humanizeKey(key)} ${formatValue(key, v)}`)
    .join(" · ");
}
