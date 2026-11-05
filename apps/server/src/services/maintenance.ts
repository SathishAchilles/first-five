import type { AppContext } from "../context";
import type { PostHogCaptureEvent } from "../integrations/posthog";
import { refreshStaleSnapshots } from "./posthog-metrics";
import { resumeAnalysisRuns } from "./analysis-pipeline";
import { reconcileExpired } from "./sessions";

const MAX_ATTEMPTS = 8;

/** Delivers pending analytics events to PostHog with bounded exponential backoff. */
export async function dispatchOutbox(ctx: AppContext, limit = 200) {
  if (!ctx.providers.analytics.configured) return { delivered: 0, failed: 0, skipped: true };
  const due = await ctx.db.outboxMessage.findMany({
    where: { provider: "posthog", status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (due.length === 0) return { delivered: 0, failed: 0, skipped: false };
  try {
    await ctx.providers.analytics.captureBatch(due.map((m) => m.payload as unknown as PostHogCaptureEvent));
    await ctx.db.outboxMessage.updateMany({
      where: { id: { in: due.map((m) => m.id) } },
      data: { status: "delivered", deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return { delivered: due.length, failed: 0, skipped: false };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    for (const m of due) {
      const attempts = m.attempts + 1;
      await ctx.db.outboxMessage.update({
        where: { id: m.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? "dead" : "failed",
          lastError: message,
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 30_000, 6 * 3600_000)),
        },
      });
    }
    ctx.log.warn({ err: message, count: due.length }, "analytics outbox delivery failed");
    return { delivered: 0, failed: due.length, skipped: false };
  }
}

let dispatching: Promise<unknown> | null = null;
let again = false;

/** Fire-and-forget outbox delivery after an events commit; at most one run in flight per process. */
export function scheduleOutboxDispatch(ctx: AppContext) {
  if (!ctx.providers.analytics.configured) return;
  if (dispatching) {
    again = true;
    return;
  }
  dispatching = dispatchOutbox(ctx)
    .catch((err) => ctx.log.warn({ err: (err as Error).message }, "outbox dispatch failed"))
    .finally(() => {
      dispatching = null;
      if (again) {
        again = false;
        scheduleOutboxDispatch(ctx);
      }
    });
}

/** Retention and housekeeping. */
export async function purgeExpired(ctx: AppContext) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [events, outbox, authSessions, tickets, credentials, setups] = await Promise.all([
    ctx.db.eventRecord.deleteMany({ where: { purgeAfter: { lt: now } } }),
    // never drop undelivered analytics: only delivered (or permanently dead) rows age out
    ctx.db.outboxMessage.deleteMany({ where: { purgeAfter: { lt: now }, status: { in: ["delivered", "dead"] } } }),
    ctx.db.authSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    ctx.db.sdkTicket.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
    ctx.db.sdkCredential.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
    ctx.db.setupSession.updateMany({ where: { status: "active", expiresAt: { lt: now } }, data: { status: "expired", endedAt: now } }),
  ]);
  return { events: events.count, outbox: outbox.count, authSessions: authSessions.count, tickets: tickets.count, credentials: credentials.count, setups: setups.count };
}

export async function runMaintenance(ctx: AppContext) {
  const sessions = await reconcileExpired(ctx);
  const outbox = await dispatchOutbox(ctx);
  const analytics = await refreshStaleSnapshots(ctx).catch((err: Error) => {
    ctx.log.warn({ err: err.message }, "analytics snapshot refresh failed");
    return null;
  });
  const purged = await purgeExpired(ctx);
  const analyses = await resumeAnalysisRuns(ctx).catch((err: Error) => {
    ctx.log.warn({ err: err.message }, "analysis resume failed");
    return null;
  });
  return { sessions, outbox, analytics, purged, analyses };
}
