import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  connectedProject,
  createHarness,
  finishAttempt,
  json,
  launchedStudy,
  makeSuperadmin,
  resetDb,
  signup,
  signupWithAccess,
  type Harness,
} from "../setup/harness";

let h: Harness;
let admin: Client;
let builderA: { client: Client; email: string; id: string; studyId: string; sessionId: string; reportId: string };
let builderB: { client: Client; email: string; id: string };
let adminId: string;

const userIdOf = async (email: string) => (await h.db.user.findUniqueOrThrow({ where: { email } })).id;

beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);

  const a = await signup(h.app);
  await makeSuperadmin(h.db, a.email);
  admin = a.client;
  adminId = await userIdOf(a.email);

  // Builder A: access, connected site, a launched study with one finished attempt and a failed AI report.
  const sa = await signupWithAccess(h, { extra: { name: "ACME Corp" } });
  const { project } = await connectedProject(h.app, sa.client);
  const study = await launchedStudy(h.app, sa.client, project.id);
  const sessionId = await finishAttempt(h, project, study);
  const report = await h.db.report.create({
    data: { studyId: study.id, studyVersion: 1, source: "ux_director", status: "failed", title: "AI findings", metricsSnapshot: {}, snapshotAt: new Date(), failureReason: "model timeout" },
  });
  await h.db.waitlistLead.create({ data: { name: "A", email: sa.email, noticeVersion: "v1" } });
  builderA = { client: sa.client, email: sa.email, id: await userIdOf(sa.email), studyId: study.id, sessionId, reportId: report.id };

  // Builder B: no access, only a sandbox (UAT) payment.
  const sb = await signup(h.app);
  const idB = await userIdOf(sb.email);
  await h.db.order.create({ data: { userId: idB, planKey: "paid_study", amountMinor: 9900, currency: "INR", environment: "uat", merchantReference: "ref-uat-1", status: "paid_verified" } });
  builderB = { client: sb.client, email: sb.email, id: idB };
});
afterAll(async () => h.close());

describe("admin client list", () => {
  it("is admin-only: 401 signed out, 404 for builders", async () => {
    expect((await new Client(h.app).get("/api/admin/clients")).statusCode).toBe(401);
    expect((await builderA.client.get("/api/admin/clients")).statusCode).toBe(404);
  });

  it("lists builders only, with rows and flags", async () => {
    const body = json(await admin.get("/api/admin/clients"));
    const ids = body.clients.map((c: { id: string }) => c.id);
    expect(ids).toContain(builderA.id);
    expect(ids).toContain(builderB.id);
    expect(ids).not.toContain(adminId);
    const a = body.clients.find((c: { id: string }) => c.id === builderA.id);
    expect(a).toMatchObject({ access: "active", websites: 1, connectedWebsites: 1, launchedStudies: 1, finishedAttempts: 1, latestReportStatus: "failed" });
    expect(a.flags).toContain("report_failed");
    expect(a.waitlistJoinedAt).not.toBeNull();
    expect(a.lastSeenAt).not.toBeNull();
  });

  it("does not count sandbox payments as live", async () => {
    const body = json(await admin.get("/api/admin/clients"));
    const b = body.clients.find((c: { id: string }) => c.id === builderB.id);
    expect(b).toMatchObject({ livePaidOrders: 0, testPaidOrders: 1, access: "none" });
    expect(b.flags).toContain("no_access");
  });

  it("filters by flag and searches case-insensitively", async () => {
    const failed = json(await admin.get("/api/admin/clients?flags=report_failed"));
    expect(failed.clients.map((c: { id: string }) => c.id)).toEqual([builderA.id]);
    const acme = json(await admin.get("/api/admin/clients?q=acme"));
    expect(acme.clients.map((c: { id: string }) => c.id)).toEqual([builderA.id]);
    expect((await admin.get("/api/admin/clients?flags=nonsense")).statusCode).toBe(400);
  });

  it("paginates with a page size cap of 100", async () => {
    const p = json(await admin.get("/api/admin/clients?pageSize=1&page=2&sort=signed_up&dir=asc"));
    expect(p).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(p.clients).toHaveLength(1);
    expect((await admin.get("/api/admin/clients?pageSize=101")).statusCode).toBe(400);
  });
});

describe("admin client detail", () => {
  it("returns account, grants, orders, websites, studies and reports", async () => {
    const d = json(await admin.get(`/api/admin/clients/${builderA.id}`));
    expect(d.client.id).toBe(builderA.id);
    expect(d.grants.length).toBeGreaterThan(0);
    expect(d.websites[0].integrationStatus).toBe("connected");
    expect(d.studies[0]).toMatchObject({ id: builderA.studyId, finishedAttempts: 1 });
    expect(d.studies[0].latestReport).toMatchObject({ status: "failed", failureReason: "model timeout" });
    expect(d.reports[0].id).toBe(builderA.reportId);
    const b = json(await admin.get(`/api/admin/clients/${builderB.id}`));
    expect(b.orders[0]).toMatchObject({ environment: "uat", status: "paid_verified" });
  });

  it("404s for unknown ids and admin accounts", async () => {
    expect((await admin.get("/api/admin/clients/00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
    expect((await admin.get(`/api/admin/clients/${adminId}`)).statusCode).toBe(404);
  });

  it("opens a study, its sessions and a report through the builder's own views", async () => {
    const s = await admin.get(`/api/admin/clients/${builderA.id}/studies/${builderA.studyId}`);
    expect(s.statusCode).toBe(200);
    const sessions = json(await admin.get(`/api/admin/clients/${builderA.id}/studies/${builderA.studyId}/sessions`)).sessions;
    expect(sessions.length).toBe(1);
    expect((await admin.get(`/api/admin/clients/${builderA.id}/reports/${builderA.reportId}`)).statusCode).toBe(200);
    // A study that belongs to another client is not reachable under this client.
    expect((await admin.get(`/api/admin/clients/${builderB.id}/studies/${builderA.studyId}`)).statusCode).toBe(404);
  });
});

describe("tester-level reads", () => {
  it("shows the same session the builder sees, and audits the read once", async () => {
    const before = await h.db.auditLog.count({ where: { action: "admin.session_viewed" } });
    const res = await admin.get(`/api/admin/clients/${builderA.id}/sessions/${builderA.sessionId}`);
    expect(res.statusCode).toBe(200);
    const own = json(await builderA.client.get(`/api/sessions/${builderA.sessionId}/details`));
    expect(json(res).timeline).toEqual(own.timeline);
    const rows = await h.db.auditLog.findMany({ where: { action: "admin.session_viewed" } });
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ actorUserId: adminId, actorType: "admin", resourceType: "study_session", resourceId: builderA.sessionId });
    expect(rows.at(-1)!.metadata).toEqual({ clientId: builderA.id });
  });

  it("does not audit list or detail reads", async () => {
    const before = await h.db.auditLog.count({ where: { actorUserId: adminId } });
    await admin.get("/api/admin/clients");
    await admin.get(`/api/admin/clients/${builderA.id}`);
    expect(await h.db.auditLog.count({ where: { actorUserId: adminId } })).toBe(before);
  });

  it("404s for a session under a different client", async () => {
    expect((await admin.get(`/api/admin/clients/${builderB.id}/sessions/${builderA.sessionId}`)).statusCode).toBe(404);
  });
});
