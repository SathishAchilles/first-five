/**
 * PostHog-sourced journey details for the dashboard (PRD §7.3, W6).
 *
 * Postgres stays authoritative for counts and outcomes. This service reads
 * bounded, study-filtered HogQL for one study version, derives paths and click
 * observations, and caches the result as a signed `analytics_snapshots` row.
 * Requests only ever read the cached row; refreshes run in the background.
 */
import type { AnalyticsDetails, AnalyticsDetailsStatus } from "@firstfive/shared";
import type { AnalyticsSnapshot, Prisma, SessionStatus } from "@prisma/client";
import type { AppContext } from "../context";
import { hmacSha256, sha256 } from "../lib/crypto";

const LEASE_MS = 60_000;
const FROM_SLACK_MS = 5 * 60_000;
const TO_SLACK_MS = 10 * 60_000;
const MAX_COHORT = 200;
const MAX_PATH_STEPS = 20;
const MAX_DROPS = 20;

/** Every query is scoped to one project, one study, live mode, the cohort and a time window. */
const WHERE =
  "properties.ff_project_id = {project_id} AND properties.ff_study_id = {study_id} AND properties.ff_mode = 'live' " +
  "AND properties.ff_session_id IN {session_ids} AND timestamp >= toDateTime({from}) AND timestamp <= toDateTime({to})";

const Q_ELEMENTS =
  "SELECT properties.ff_page_path, properties.ff_element_key, any(properties.ff_element_label), uniq(properties.ff_session_id), count() " +
  `FROM events WHERE event = 'ff_element_clicked' AND ${WHERE} GROUP BY 1, 2 ORDER BY 4 DESC, 5 DESC LIMIT 25`;
const Q_TIMELINES =
  "SELECT sid, groupArray(tuple(seq, ev, path, el)) FROM (SELECT properties.ff_session_id AS sid, toInt(properties.ff_client_sequence) AS seq, " +
  `event AS ev, properties.ff_page_path AS path, properties.ff_element_key AS el FROM events WHERE ${WHERE} ORDER BY sid, seq LIMIT 5000) ` +
  "GROUP BY sid LIMIT 200";
const Q_COUNTS = `SELECT count(), uniq(properties.ff_session_id), max(timestamp) FROM events WHERE ${WHERE}`;
const Q_ERRORS =
  "SELECT properties.ff_page_path, count(), uniq(properties.ff_session_id) " +
  `FROM events WHERE event = 'ff_client_error' AND ${WHERE} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;

const ACTION_EVENTS = new Set(["ff_page_viewed", "ff_element_clicked", "ff_form_submitted", "ff_custom_event"]);

interface CohortSession {
  id: string;
  publicId: string;
  status: SessionStatus;
  startedAt: Date;
  deadlineAt: Date;
}

interface Cohort {
  projectPublicId: string;
  studyPublicId: string;
  sessions: CohortSession[];
  hash: string;
}

/** Stored in `analytics_snapshots.details`. */
type StoredDetails = Pick<AnalyticsDetails, "cohortSize" | "elements" | "paths" | "transitions" | "lastStepBeforeDrop" | "errors">;

export interface TimelineStep {
  seq: number | null;
  event: string;
  path: string | null;
  elementKey: string | null;
}

const EMPTY_QUALITY: AnalyticsDetails["dataQuality"] = {
  postgresEvents: 0,
  posthogEvents: 0,
  missingInPosthog: 0,
  sessionsWithoutEvents: 0,
  outbox: { pending: 0, failed: 0, dead: 0 },
  deliveryLagMs: null,
};

function emptyStored(cohortSize: number): StoredDetails {
  return { cohortSize, elements: [], paths: [], transitions: [], lastStepBeforeDrop: [], errors: { observed: false } };
}

function str(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same cohort as the dashboard cards: this version, no repeats, no invalid attempts. */
async function loadCohort(ctx: AppContext, studyId: string, version: number): Promise<Cohort> {
  const study = await ctx.db.study.findUniqueOrThrow({
    where: { id: studyId },
    select: { publicId: true, project: { select: { publicId: true } } },
  });
  const sessions = await ctx.db.studySession.findMany({
    where: { studyId, studyVersion: { version }, isRepeat: false, status: { not: "invalid" } },
    select: { id: true, publicId: true, status: true, startedAt: true, deadlineAt: true },
    orderBy: { publicId: "asc" },
    take: MAX_COHORT,
  });
  // status is part of the hash: a newly finalized attempt changes completed/dropped figures
  const hash = sha256(sessions.map((s) => `${s.publicId}:${s.status}`).join(","));
  return { projectPublicId: study.project.publicId, studyPublicId: study.publicId, sessions, hash };
}

/** Parse `groupArray(tuple(seq, ev, path, el))` rows into ordered per-session steps. */
export function parseTimelines(rows: unknown[][]): Map<string, TimelineStep[]> {
  const out = new Map<string, TimelineStep[]>();
  for (const row of rows) {
    const sid = str(row[0]);
    if (!sid || !Array.isArray(row[1])) continue;
    const steps = (row[1] as unknown[][]).map((t) => ({
      seq: t[0] === null || t[0] === undefined ? null : num(t[0]),
      event: String(t[1] ?? ""),
      path: str(t[2]),
      elementKey: str(t[3]),
    }));
    // groupArray keeps no guaranteed order
    steps.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
    out.set(sid, steps);
  }
  return out;
}

/** Page sequence of one attempt with consecutive repeats collapsed. */
export function pageSequence(steps: TimelineStep[]): string[] {
  const pages: string[] = [];
  for (const s of steps) {
    if (s.event !== "ff_page_viewed" || !s.path) continue;
    if (pages[pages.length - 1] !== s.path) pages.push(s.path);
  }
  return pages;
}

/** Observed paths and page-to-page transitions across the cohort. Describes, never infers. */
export function derivePaths(timelines: Map<string, TimelineStep[]>, statusById: Map<string, SessionStatus>) {
  const pathGroups = new Map<string, { steps: string[]; sessions: number; completed: number }>();
  const transitionSessions = new Map<string, { from: string; to: string; sessions: number }>();
  for (const [sid, steps] of timelines) {
    const pages = pageSequence(steps);
    if (pages.length === 0) continue;
    const shown = pages.length > MAX_PATH_STEPS ? [...pages.slice(0, MAX_PATH_STEPS), "…"] : pages;
    const key = shown.join("\u0000");
    const group = pathGroups.get(key) ?? { steps: shown, sessions: 0, completed: 0 };
    group.sessions++;
    if (statusById.get(sid) === "completed") group.completed++;
    pathGroups.set(key, group);

    const seen = new Set<string>();
    for (let i = 1; i < pages.length; i++) {
      const from = pages[i - 1]!;
      const to = pages[i]!;
      const tKey = `${from}\u0000${to}`;
      if (seen.has(tKey)) continue;
      seen.add(tKey);
      const t = transitionSessions.get(tKey) ?? { from, to, sessions: 0 };
      t.sessions++;
      transitionSessions.set(tKey, t);
    }
  }
  return {
    paths: [...pathGroups.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 5),
    transitions: [...transitionSessions.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 10),
  };
}

/** Last observed step of each dropped attempt (PRD §3.6: not necessarily the cause). */
export function lastSteps(timelines: Map<string, TimelineStep[]>, sessions: Pick<CohortSession, "publicId" | "status">[]) {
  return sessions
    .filter((s) => s.status === "dropped")
    .slice(0, MAX_DROPS)
    .map((s) => {
      const steps = (timelines.get(s.publicId) ?? []).filter((e) => ACTION_EVENTS.has(e.event));
      const last = steps[steps.length - 1];
      return { sessionPublicId: s.publicId, path: last?.path ?? null, elementKey: last?.elementKey ?? null };
    });
}

/** Outcome rule: details are `ready` only when PostHog holds everything Postgres accepted. */
export function snapshotStatus(q: AnalyticsDetails["dataQuality"]): "ready" | "processing" {
  if (q.outbox.pending + q.outbox.failed > 0) return "processing";
  // permanently undeliverable (dead) messages will never arrive; don't wait for them forever
  return q.missingInPosthog > q.outbox.dead ? "processing" : "ready";
}

async function dataQuality(ctx: AppContext, cohort: Cohort, posthogEvents: number, posthogSessions: number) {
  const ids = cohort.sessions.map((s) => s.id);
  const outboxWhere: Prisma.OutboxMessageWhereInput = {
    provider: "posthog",
    OR: cohort.sessions.map((s) => ({ dedupeKey: { startsWith: `${s.publicId}:` } })),
  };
  const [postgresEvents, byStatus, oldest] = await Promise.all([
    ctx.db.eventRecord.count({ where: { studySessionId: { in: ids } } }),
    ctx.db.outboxMessage.groupBy({ by: ["status"], where: outboxWhere, _count: { _all: true } }),
    ctx.db.outboxMessage.findFirst({
      where: { ...outboxWhere, status: { in: ["pending", "failed"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const outbox = { pending: 0, failed: 0, dead: 0 };
  for (const g of byStatus) if (g.status !== "delivered") outbox[g.status] = g._count._all;
  return {
    postgresEvents,
    posthogEvents,
    missingInPosthog: Math.max(0, postgresEvents - posthogEvents),
    sessionsWithoutEvents: Math.max(0, cohort.sessions.length - posthogSessions),
    outbox,
    deliveryLagMs: oldest ? Date.now() - oldest.createdAt.getTime() : null,
  };
}

async function compute(ctx: AppContext, cohort: Cohort) {
  const starts = cohort.sessions.map((s) => s.startedAt.getTime());
  const ends = cohort.sessions.map((s) => s.deadlineAt.getTime());
  const values = {
    project_id: cohort.projectPublicId,
    study_id: cohort.studyPublicId,
    session_ids: cohort.sessions.map((s) => s.publicId),
    from: new Date(Math.min(...starts) - FROM_SLACK_MS).toISOString(),
    to: new Date(Math.min(Date.now(), Math.max(...ends) + TO_SLACK_MS)).toISOString(),
  };
  const q = ctx.providers.analytics;
  // sequential on purpose: keeps us well inside PostHog's query rate limits
  const elementRows = await q.query<unknown[]>(Q_ELEMENTS, values);
  const timelineRows = await q.query<unknown[]>(Q_TIMELINES, values);
  const countRows = await q.query<unknown[]>(Q_COUNTS, values);
  const errorRows = await q.query<unknown[]>(Q_ERRORS, values);

  const timelines = parseTimelines(timelineRows);
  const statusById = new Map(cohort.sessions.map((s) => [s.publicId, s.status]));
  const counts = countRows[0] ?? [0, 0, null];
  const cutoffMs = counts[2] ? Date.parse(String(counts[2])) : NaN;
  // max(timestamp) over zero rows comes back as the Unix epoch
  const eventCutoff = Number.isFinite(cutoffMs) && cutoffMs > 0 ? new Date(cutoffMs) : null;

  const details: StoredDetails = {
    cohortSize: cohort.sessions.length,
    elements: elementRows
      .filter((r) => str(r[1]))
      .map((r) => ({ path: str(r[0]), elementKey: String(r[1]), label: str(r[2]), sessions: num(r[3]), clicks: num(r[4]) })),
    ...derivePaths(timelines, statusById),
    lastStepBeforeDrop: lastSteps(timelines, cohort.sessions),
    errors:
      errorRows.length > 0
        ? { observed: true, byPath: errorRows.map((r) => ({ path: str(r[0]), count: num(r[1]), sessions: num(r[2]) })) }
        : { observed: false },
  };
  const quality = await dataQuality(ctx, cohort, num(counts[0]), num(counts[1]));
  return { details, quality, eventCutoff };
}

function sign(ctx: AppContext, payload: unknown): string {
  return hmacSha256(ctx.config.SESSION_SECRET, JSON.stringify(payload));
}

/**
 * Recompute one study version's snapshot. Safe to call concurrently: a 60 s lease
 * lets one caller run while the others return. Failures keep the previous details.
 */
export async function refreshAnalyticsSnapshot(ctx: AppContext, studyId: string, version: number): Promise<"refreshed" | "busy" | "failed" | "not_configured"> {
  const key = { studyId_studyVersion: { studyId, studyVersion: version } };
  if (!ctx.providers.analytics.canQuery) {
    await ctx.db.analyticsSnapshot.upsert({
      where: key,
      create: { studyId, studyVersion: version, status: "unavailable", lastError: "PostHog query access not configured" },
      update: { status: "unavailable", lastError: "PostHog query access not configured" },
    });
    return "not_configured";
  }
  const row = await ctx.db.analyticsSnapshot.upsert({ where: key, create: { studyId, studyVersion: version }, update: {} });
  const now = new Date();
  const claimed = await ctx.db.analyticsSnapshot.updateMany({
    where: { id: row.id, OR: [{ refreshStartedAt: null }, { refreshStartedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
    data: { refreshStartedAt: now },
  });
  if (claimed.count !== 1) return "busy";

  try {
    const cohort = await loadCohort(ctx, studyId, version);
    const result =
      cohort.sessions.length === 0
        ? { details: emptyStored(0), quality: EMPTY_QUALITY, eventCutoff: null }
        : await compute(ctx, cohort);
    const status = snapshotStatus(result.quality);
    const signature = sign(ctx, {
      studyId,
      version,
      cohortHash: cohort.hash,
      eventCutoff: result.eventCutoff?.toISOString() ?? null,
      details: result.details,
      dataQuality: result.quality,
    });
    await ctx.db.analyticsSnapshot.update({
      where: { id: row.id },
      data: {
        status,
        cohortHash: cohort.hash,
        eventCutoff: result.eventCutoff,
        details: result.details as unknown as Prisma.InputJsonValue,
        dataQuality: result.quality as unknown as Prisma.InputJsonValue,
        signature,
        lastError: null,
        computedAt: new Date(),
        refreshStartedAt: null,
      },
    });
    return "refreshed";
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    // keep the lease until it lapses so a failing PostHog is retried at most once a minute
    await ctx.db.analyticsSnapshot.update({ where: { id: row.id }, data: { status: "unavailable", lastError: message } });
    ctx.log.warn({ err: message, studyId, version }, "analytics snapshot refresh failed");
    return "failed";
  }
}

function toDetails(row: AnalyticsSnapshot | null, cohortSize: number, fallback: AnalyticsDetailsStatus): AnalyticsDetails {
  const stored = { ...emptyStored(cohortSize), ...((row?.details ?? {}) as Partial<StoredDetails>) };
  return {
    ...stored,
    status: row ? (row.computedAt || row.status === "unavailable" ? row.status : "processing") : fallback,
    computedAt: row?.computedAt?.toISOString() ?? null,
    eventCutoff: row?.eventCutoff?.toISOString() ?? null,
    dataQuality: { ...EMPTY_QUALITY, ...((row?.dataQuality ?? {}) as Partial<AnalyticsDetails["dataQuality"]>) },
  };
}

/** Read the cached snapshot for a dashboard request. Never queries PostHog. */
export async function readAnalyticsSnapshot(ctx: AppContext, studyId: string, version: number): Promise<{ details: AnalyticsDetails; stale: boolean }> {
  if (!ctx.providers.analytics.canQuery) return { details: toDetails(null, 0, "not_configured"), stale: false };
  const [row, cohort] = await Promise.all([
    ctx.db.analyticsSnapshot.findUnique({ where: { studyId_studyVersion: { studyId, studyVersion: version } } }),
    loadCohort(ctx, studyId, version),
  ]);
  const ttlMs = ctx.config.ANALYTICS_SNAPSHOT_TTL_SECONDS * 1000;
  const stale = !row || !row.computedAt || Date.now() - row.computedAt.getTime() > ttlMs || row.cohortHash !== cohort.hash;
  return { details: toDetails(row, cohort.sessions.length, "processing"), stale };
}

/** Start a refresh without blocking the caller. */
export function refreshInBackground(ctx: AppContext, studyId: string, version: number): void {
  ctx.defer(
    refreshAnalyticsSnapshot(ctx, studyId, version).catch((err: Error) =>
      ctx.log.warn({ err: err.message, studyId, version }, "analytics snapshot refresh crashed"),
    ),
  );
}

/** Maintenance: refresh stale snapshots of active studies, a few per run. */
export async function refreshStaleSnapshots(ctx: AppContext, limit = 5) {
  if (!ctx.providers.analytics.canQuery) return { refreshed: 0, skipped: true };
  const studies = await ctx.db.study.findMany({
    where: { status: "active" },
    select: { id: true, currentVersion: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  let refreshed = 0;
  for (const s of studies) {
    if (refreshed >= limit) break;
    const { stale } = await readAnalyticsSnapshot(ctx, s.id, s.currentVersion);
    if (!stale) continue;
    if ((await refreshAnalyticsSnapshot(ctx, s.id, s.currentVersion)) === "refreshed") refreshed++;
  }
  return { refreshed, skipped: false };
}
