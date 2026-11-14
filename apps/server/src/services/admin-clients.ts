/**
 * Admin client review: one row per builder account with health flags, and a
 * full read-only detail of one builder. Pilot scale (hundreds of builders), so
 * the list is loaded once and filtered, sorted and paged in memory.
 */
import type { AdminClientDetail, AdminClientFlag, AdminClientListQuery, AdminClientListResponse, AdminClientRow } from "@firstfive/shared";
import type { AppConfig } from "../config";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { UNSET_PASSWORD } from "./auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FINISHED = ["completed", "dropped"] as const;
const OPEN_STUDY = new Set(["active", "paused", "full"]);

export interface FlagThresholds {
  noWebsiteDays: number;
  notConnectedDays: number;
  noAttemptsHours: number;
}

export function thresholdsFrom(config: AppConfig): FlagThresholds {
  return {
    noWebsiteDays: config.ADMIN_FLAG_NO_WEBSITE_DAYS,
    notConnectedDays: config.ADMIN_FLAG_NOT_CONNECTED_DAYS,
    noAttemptsHours: config.ADMIN_FLAG_NO_ATTEMPTS_HOURS,
  };
}

/** Everything the flags need about one builder, as plain data. */
export interface ClientFlagInput {
  createdAt: Date;
  hasActiveGrant: boolean;
  pendingPayments: number;
  websites: { createdAt: Date; integrationStatus: string }[];
  studies: { status: string; launchedAt: Date | null; finishedAttempts: number; latestUxReportStatus: string | null }[];
}

export function computeFlags(c: ClientFlagInput, now: Date, t: FlagThresholds): AdminClientFlag[] {
  const age = (d: Date) => now.getTime() - d.getTime();
  const flags: AdminClientFlag[] = [];
  if (c.websites.length === 0 && age(c.createdAt) > t.noWebsiteDays * DAY_MS) flags.push("no_website");
  if (c.websites.some((w) => w.integrationStatus !== "connected" && age(w.createdAt) > t.notConnectedDays * DAY_MS)) flags.push("not_connected");
  if (c.studies.some((s) => s.launchedAt && OPEN_STUDY.has(s.status) && s.finishedAttempts === 0 && age(s.launchedAt) > t.noAttemptsHours * HOUR_MS)) {
    flags.push("no_attempts");
  }
  if (c.studies.some((s) => s.latestUxReportStatus === "failed")) flags.push("report_failed");
  if (c.pendingPayments > 0) flags.push("payment_pending");
  if (!c.hasActiveGrant) flags.push("no_access");
  return flags;
}

const isActiveGrant = (g: { revokedAt: Date | null; startsAt: Date; expiresAt: Date | null }, now: Date) =>
  !g.revokedAt && g.startsAt <= now && (!g.expiresAt || g.expiresAt > now);

/** Loads builders (role `account_admin`, optionally one) with everything a row needs. */
async function loadRows(ctx: AppContext, now: Date, onlyUserId?: string): Promise<AdminClientRow[]> {
  const users = await ctx.db.user.findMany({
    where: { role: "account_admin", ...(onlyUserId ? { id: onlyUserId } : {}) },
    include: {
      accessGrants: true,
      orders: { select: { status: true, environment: true } },
      authSessions: { where: { impersonatorUserId: null }, select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      projects: {
        select: {
          createdAt: true,
          integrationStatus: true,
          studies: {
            select: {
              id: true,
              status: true,
              launchedAt: true,
              reports: { select: { status: true, source: true, createdAt: true }, orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
    },
  });
  const studyIds = users.flatMap((u) => u.projects.flatMap((p) => p.studies.map((s) => s.id)));
  const finishedRows = studyIds.length
    ? await ctx.db.studySession.groupBy({
        by: ["studyId"],
        where: { studyId: { in: studyIds }, isRepeat: false, status: { in: [...FINISHED] } },
        _count: { _all: true },
      })
    : [];
  const finished = new Map(finishedRows.map((r) => [r.studyId, r._count._all]));
  const waitlist = await ctx.db.waitlistLead.findMany({ where: { email: { in: users.map((u) => u.email) } }, select: { email: true, createdAt: true } });
  const waitlistByEmail = new Map(waitlist.map((w) => [w.email.toLowerCase(), w.createdAt]));
  const t = thresholdsFrom(ctx.config);

  return users.map((u) => {
    const active = u.accessGrants.filter((g) => isActiveGrant(g, now));
    const studies = u.projects.flatMap((p) =>
      p.studies.map((s) => ({
        status: s.status,
        launchedAt: s.launchedAt,
        finishedAttempts: finished.get(s.id) ?? 0,
        latestUxReportStatus: s.reports.find((r) => r.source === "ux_director")?.status ?? null,
        latestReport: s.reports[0] ?? null,
      })),
    );
    const pendingPayments = u.orders.filter((o) => o.status === "pending_verification").length;
    const latest = studies
      .map((s) => s.latestReport)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: u.authSessions[0]?.lastSeenAt.toISOString() ?? null,
      access: active.length > 0 ? "active" : "none",
      creditsAvailable: active.reduce((n, g) => n + Math.max(0, g.studyCredits - g.creditsUsed), 0),
      livePaidOrders: u.orders.filter((o) => o.environment === "live" && o.status === "paid_verified").length,
      testPaidOrders: u.orders.filter((o) => o.environment !== "live" && o.status === "paid_verified").length,
      pendingPayments,
      websites: u.projects.length,
      connectedWebsites: u.projects.filter((p) => p.integrationStatus === "connected").length,
      launchedStudies: studies.filter((s) => s.launchedAt).length,
      finishedAttempts: studies.reduce((n, s) => n + s.finishedAttempts, 0),
      latestReportStatus: latest?.status ?? null,
      waitlistJoinedAt: waitlistByEmail.get(u.email.toLowerCase())?.toISOString() ?? null,
      pendingPasswordSetup: u.passwordHash === UNSET_PASSWORD,
      flags: computeFlags(
        { createdAt: u.createdAt, hasActiveGrant: active.length > 0, pendingPayments, websites: u.projects, studies },
        now,
        t,
      ),
    } satisfies AdminClientRow;
  });
}

const SORT_KEY: Record<NonNullable<AdminClientListQuery["sort"]>, (r: AdminClientRow) => number> = {
  signed_up: (r) => Date.parse(r.createdAt),
  last_seen: (r) => (r.lastSeenAt ? Date.parse(r.lastSeenAt) : 0),
  attempts: (r) => r.finishedAttempts,
};

export async function listClients(ctx: AppContext, query: AdminClientListQuery, now = new Date()): Promise<AdminClientListResponse> {
  const q = query.q?.trim().toLowerCase();
  const flags = query.flags ?? [];
  const rows = (await loadRows(ctx, now)).filter(
    (r) =>
      (!q || r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)) &&
      flags.every((f) => r.flags.includes(f)) &&
      (!query.access || query.access === "any" || r.access === query.access),
  );
  const key = SORT_KEY[query.sort ?? "last_seen"];
  const sign = (query.dir ?? "desc") === "desc" ? -1 : 1;
  rows.sort((a, b) => sign * (key(a) - key(b)) || a.email.localeCompare(b.email));
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
  const page = Math.max(1, query.page ?? 1);
  return { clients: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
}

/** The builder behind a superadmin client route; superadmins and unknown ids are 404. */
export async function assertClient(ctx: AppContext, clientId: string) {
  const user = await ctx.db.user.findUnique({ where: { id: clientId } });
  if (!user || user.role !== "account_admin") throw new AppError(404, "not_found", "Client not found.");
  return user;
}

export async function getClientDetail(ctx: AppContext, clientId: string, now = new Date()): Promise<AdminClientDetail> {
  await assertClient(ctx, clientId);
  const [client] = await loadRows(ctx, now, clientId);
  const [grants, orders, projects, auditRows] = await Promise.all([
    ctx.db.accessGrant.findMany({ where: { userId: clientId }, orderBy: { createdAt: "desc" } }),
    ctx.db.order.findMany({ where: { userId: clientId }, orderBy: { createdAt: "desc" } }),
    ctx.db.project.findMany({
      where: { ownerId: clientId },
      orderBy: { createdAt: "desc" },
      include: { studies: { orderBy: { createdAt: "desc" }, include: { reports: { orderBy: { createdAt: "desc" } } } } },
    }),
    ctx.db.auditLog.findMany({
      where: { OR: [{ actorUserId: clientId }, { resourceId: clientId }, { metadata: { path: ["clientId"], equals: clientId } }] },
      include: { actor: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const studies = projects.flatMap((p) => p.studies.map((s) => ({ ...s, projectId: p.id })));
  const finishedRows = studies.length
    ? await ctx.db.studySession.groupBy({
        by: ["studyId"],
        where: { studyId: { in: studies.map((s) => s.id) }, isRepeat: false, status: { in: [...FINISHED] } },
        _count: { _all: true },
      })
    : [];
  const finished = new Map(finishedRows.map((r) => [r.studyId, r._count._all]));
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return {
    client: client!,
    grants: grants.map((g) => ({
      id: g.id,
      source: g.source,
      planKey: g.planKey,
      studyCredits: g.studyCredits,
      creditsUsed: g.creditsUsed,
      maxParticipantsPerStudy: g.maxParticipantsPerStudy,
      expiresAt: iso(g.expiresAt),
      revokedAt: iso(g.revokedAt),
      createdAt: g.createdAt.toISOString(),
    })),
    orders: orders.map((o) => ({
      id: o.id,
      reference: o.merchantReference,
      provider: o.provider,
      environment: o.environment,
      status: o.status,
      amountMinor: o.amountMinor,
      currency: o.currency,
      createdAt: o.createdAt.toISOString(),
    })),
    websites: projects.map((p) => ({
      id: p.id,
      name: p.name,
      websiteUrl: p.websiteUrl,
      integrationStatus: p.integrationStatus,
      lastSdkVersion: p.lastSdkVersion,
      lastIssue: p.lastIssue,
      lastIssueAt: iso(p.lastIssueAt),
      createdAt: p.createdAt.toISOString(),
    })),
    studies: studies.map((s) => {
      const r = s.reports[0];
      return {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        status: s.status,
        currentVersion: s.currentVersion,
        participantLimit: s.participantLimit,
        launchedAt: iso(s.launchedAt),
        expiresAt: iso(s.expiresAt),
        finishedAttempts: finished.get(s.id) ?? 0,
        latestReport: r ? { id: r.id, status: r.status, source: r.source, sessionsIncluded: r.sessionsIncluded, failureReason: r.failureReason } : null,
      };
    }),
    reports: studies
      .flatMap((s) => s.reports)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        studyId: r.studyId,
        source: r.source,
        status: r.status,
        title: r.title,
        sessionsIncluded: r.sessionsIncluded,
        failureReason: r.failureReason,
        createdAt: r.createdAt.toISOString(),
      })),
    audit: auditRows.map((a) => ({
      id: a.id,
      actorEmail: a.actor?.email ?? null,
      actorType: a.actorType,
      action: a.action,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
