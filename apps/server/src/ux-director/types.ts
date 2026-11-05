/**
 * Evidence contract for the in-house UX Director pipeline. Everything here is
 * pseudonymous and sanitized: no invite labels, emails or form values.
 */

export interface EvidenceEvent {
  event_id: string;
  seq: number | null;
  name: string;
  route: string | null;
  element_key: string | null;
  element_label: string | null;
  t_ms: number;
  /** Present on ff_custom_event: the event's name. */
  custom_event?: string;
  /** Present on ff_custom_event: filtered, non-sensitive properties (design D6). */
  props?: Record<string, string | number | boolean>;
}

export interface EvidenceSession {
  session_id: string;
  outcome: string;
  final_reason: string | null;
  duration_s: number | null;
  data_quality_flag: string | null;
  events: EvidenceEvent[];
  feedback: { response_id: string; slot: string; displayed_question: string; answer_text: string | null; choice: string | null }[];
}

export interface EvidencePackage {
  study: {
    study_id: string;
    version: number;
    task_text: string;
    start_path: string;
    goal: { type: string; target: string };
    intended_path: string[];
    milestones: unknown[];
  };
  snapshot: { snapshot_id: string; data_cutoff_at: string; metrics: Record<string, number | null> };
  sessions: EvidenceSession[];
}

const MAX_CUSTOM_PROPS = 10;
const MAX_PROP_STRING = 40;
/** Keys that can carry free text or personal data are never sent to a model. */
const SENSITIVE_KEY = /text|label|email|name|phone|value|query|search/i;

/**
 * Keeps up to 10 custom-event properties that are numbers, booleans, or short
 * strings under non-sensitive keys (design D6). Everything else is dropped.
 */
export function safeCustomProps(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_CUSTOM_PROPS) break;
    if (key === "custom_event_name" || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length > 0 && value.length <= MAX_PROP_STRING) out[key] = value;
  }
  return out;
}
