/**
 * Shared runtime validation schemas and API types for the First Five web app
 * and API server. Customer-facing labels live here so the UI uses consistent
 * plain-language terminology.
 */
import { z } from "zod";

export * from "./labels";
export * from "./types";

const trimmed = (max: number) => z.string().trim().max(max);

// ───────────────────────────── Auth ─────────────────────────────

export const EmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const PasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Use at most 200 characters");

export const SignupSchema = z.object({
  name: trimmed(80).optional(),
  email: EmailSchema,
  password: PasswordSchema,
  invitationCode: trimmed(64).optional(),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RedeemCodeSchema = z.object({
  code: z.string().trim().min(8, "Enter the full invitation code").max(64),
});

export const WAITLIST_NOTICE_VERSION = "2026-10-24.v1";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const UtmSchema = z
  .object({
    utm_source: optionalText(100),
    utm_medium: optionalText(100),
    utm_campaign: optionalText(100),
    utm_term: optionalText(100),
    utm_content: optionalText(100),
  })
  .partial();

export const WaitlistSchema = z.object({
  name: trimmed(80).min(1, "Please enter your name"),
  email: EmailSchema,
  productDescription: optionalText(300),
  productUrl: optionalText(2048),
  source: optionalText(60),
  referrer: optionalText(300),
  utm: UtmSchema.optional(),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(200).optional(),
});
export type WaitlistInput = z.infer<typeof WaitlistSchema>;

export const CLIENT_EVENT_NAMES = ["landing_page_viewed", "paid_cta_clicked", "waitlist_cta_clicked", "access_page_viewed"] as const;
export const TrackEventSchema = z.object({
  name: z.enum(CLIENT_EVENT_NAMES),
  path: z.string().max(200).optional(),
  placement: z.string().max(40).optional(),
  utm: UtmSchema.optional(),
});

// ───────────────────────────── Projects ─────────────────────────────

export const CreateProjectSchema = z.object({
  name: trimmed(80).min(1, "Give your website a name"),
  websiteUrl: trimmed(2048).min(1, "Enter your website address"),
  description: trimmed(280).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const AddOriginSchema = z.object({ origin: trimmed(2048).min(1) });

// ───────────────────────────── Studies ─────────────────────────────

export const GOAL_TYPES = ["element_clicked", "page_reached", "custom_event"] as const;
export type GoalTypeValue = (typeof GOAL_TYPES)[number];

export const TIME_LIMIT_OPTIONS_SECONDS = [120, 180, 300, 600, 900, 1200] as const;

export const PathSchema = z
  .string()
  .trim()
  .min(1, "Enter a page path such as /signup")
  .max(512)
  .regex(/^\/[^\s?#]*$/, "Use a path that starts with / (no domain, query or #)");

export const MilestoneSchema = z.object({
  label: trimmed(80).min(1),
  type: z.enum(GOAL_TYPES),
  target: trimmed(200).min(1),
});

export const StudyDraftSchema = z.object({
  projectId: z.string().uuid(),
  name: trimmed(80).min(1, "Give your test a name"),
  task: trimmed(400).min(5, "Describe what someone should be able to do"),
  startPath: PathSchema,
  goalType: z.enum(GOAL_TYPES),
  goalTarget: trimmed(200).min(1, "Choose how we'll know they succeeded"),
  goalPagePath: PathSchema.optional(),
  timeLimitSeconds: z.number().int().min(60).max(3600).default(300),
  participantLimit: z.number().int().min(1).max(100).default(5),
  milestones: z.array(MilestoneSchema).max(5).default([]),
  expiresAt: z.string().datetime().optional().nullable(),
  repeatPolicy: z.enum(["flag_repeats", "block_repeats"]).default("flag_repeats"),
});
export type StudyDraftInput = z.infer<typeof StudyDraftSchema>;

export const StudyUpdateSchema = StudyDraftSchema.omit({ projectId: true }).partial().extend({
  /** Required to change the task definition once participants have started. */
  createNewVersion: z.boolean().optional(),
});

// ───────────────────────────── Participants ─────────────────────────────

export const CONSENT_TEXT_VERSION = "2026-11-13.v2";

export const StartAttemptSchema = z.object({ consent: z.literal(true) });

export const FeedbackAnswerSchema = z.object({
  questionKey: z.string().min(1).max(40),
  status: z.enum(["answered", "skipped"]),
  choice: trimmed(40).optional(),
  text: trimmed(2000).optional(),
});
export const FeedbackSubmitSchema = z.object({ answers: z.array(FeedbackAnswerSchema).min(1).max(5) });

export const EASE_SCALE = [
  { value: "1", label: "Very difficult" },
  { value: "2", label: "Difficult" },
  { value: "3", label: "Neither easy nor difficult" },
  { value: "4", label: "Easy" },
  { value: "5", label: "Very easy" },
  { value: "could_not_complete", label: "I couldn't complete it" },
] as const;

// ───────────────────────────── Reports ─────────────────────────────

export const EVIDENCE_STRENGTHS = ["inconclusive", "limited", "supported"] as const;

export const QuoteSchema = z.object({ responseId: z.string().uuid() });

export const FindingInputSchema = z.object({
  title: trimmed(120).min(3, "Give the finding a short title"),
  observed: trimmed(2000).min(3, "Describe what was observed"),
  quoteResponseIds: z.array(z.string().uuid()).max(10).default([]),
  interpretation: trimmed(2000).optional(),
  evidenceStrength: z.enum(EVIDENCE_STRENGTHS).default("inconclusive"),
  suggestion: trimmed(2000).optional(),
  retestMetric: trimmed(300).optional(),
  supportingSessionIds: z.array(z.string().uuid()).max(100).default([]),
  counterSessionIds: z.array(z.string().uuid()).max(100).default([]),
});
export type FindingInput = z.infer<typeof FindingInputSchema>;

export const ReviewDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "revision_requested"]),
  note: trimmed(1000).optional(),
});

// ───────────────────────────── Admin ─────────────────────────────

export const GenerateCodesSchema = z.object({
  label: trimmed(80).min(1),
  audience: z.enum(["judge", "pilot", "partner", "internal"]).default("judge"),
  planKey: z.enum(["complimentary"]).default("complimentary"),
  studyCredits: z.number().int().min(1).max(20).optional(),
  participantCap: z.number().int().min(1).max(50).optional(),
  count: z.number().int().min(1).max(50).default(1),
  maxRedemptions: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  grantDays: z.number().int().min(1).max(365).optional(),
});

// ───────────────────────────── Helpers ─────────────────────────────

/** Returns a whole-number percentage, or null when the denominator is zero. */
export function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
