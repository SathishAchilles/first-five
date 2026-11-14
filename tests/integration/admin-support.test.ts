import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UxDirectorProvider } from "../../apps/server/src/integrations/ux-director";
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
  startParticipant,
  type Harness,
} from "../setup/harness";

let h: Harness;
let admin: Client;
const pendingModelCalls: ((err: Error) => void)[] = [];

const idOf = async (email: string) => (await h.db.user.findUniqueOrThrow({ where: { email } })).id;
const reason = { reason: "support ticket #1" };

beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
  const a = await signup(h.app);
  await makeSuperadmin(h.db, a.email);
  admin = a.client;
});
afterAll(async () => {
  // Let any analysis left waiting on the stub model fail, then shut down.
  for (const reject of pendingModelCalls) reject(new Error("test finished"));
  await new Promise((r) => setTimeout(r, 200));
  await h.close();
});

describe("reasons and audit", () => {
  it("rejects an action without a reason and changes nothing", async () => {
    const b = await signup(h.app);
    const id = await idOf(b.email);
    const res = await admin.post(`/api/admin/clients/${id}/grants`, { reason: "  ", studyCredits: 1, maxParticipantsPerStudy: 5 });
    expect(res.statusCode).toBe(400);
    expect(await h.db.accessGrant.count({ where: { userId: id } })).toBe(0);
    expect(await h.db.auditLog.count({ where: { action: { startsWith: "admin." } } })).toBe(0);
  });

  it("is admin-only", async () => {
    const b = await signupWithAccess(h);
    const id = await idOf(b.email);
    expect((await b.client.post(`/api/admin/clients/${id}/grants`, { ...reason, studyCredits: 5, maxParticipantsPerStudy: 5 })).statusCode).toBe(404);
  });
});

describe("grants and credits", () => {
  it("grant access unlocks study creation and launch, with one audit row", async () => {
    const b = await signup(h.app);
    const id = await idOf(b.email);
    expect((await b.client.get("/api/projects")).statusCode).toBe(403);
    const res = await admin.post(`/api/admin/clients/${id}/grants`, { ...reason, studyCredits: 2, maxParticipantsPerStudy: 5 });
    expect(res.statusCode).toBe(201);
    const { project } = await connectedProject(h.app, b.client);
    const study = await launchedStudy(h.app, b.client, project.id);
    expect(study.status).toBe("active");
    const rows = await h.db.auditLog.findMany({ where: { action: "admin.grant_created", resourceId: json(res).id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ clientId: id, reason: reason.reason, before: null, after: { studyCredits: 2 } });
    const grant = await h.db.accessGrant.findUniqueOrThrow({ where: { id: json(res).id } });
    expect(grant.source).toBe("admin");
  });

  it("revoking keeps live studies running but blocks new launches", async () => {
    const b = await signupWithAccess(h, { studyCredits: 1 });
    const id = await idOf(b.email);
    const { project } = await connectedProject(h.app, b.client);
    const study = await launchedStudy(h.app, b.client, project.id);
    const grant = await h.db.accessGrant.findFirstOrThrow({ where: { userId: id } });
    expect((await admin.post(`/api/admin/clients/${id}/grants/${grant.id}/revoke`, reason)).statusCode).toBe(200);
    expect((await h.db.study.findUniqueOrThrow({ where: { id: study.id } })).status).toBe("active");
    expect((await startParticipant(h.app, study.publicId)).res.statusCode).toBe(201);
    const revoked = await h.db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(revoked.revokedAt).not.toBeNull();
    expect((await admin.post(`/api/admin/clients/${id}/grants/${grant.id}/revoke`, reason)).statusCode).toBe(409);
    expect(await h.db.auditLog.count({ where: { action: "admin.grant_revoked", resourceId: grant.id } })).toBe(1);
  });

  it("adds credits to an active grant, and refuses expired or revoked grants with 409", async () => {
    const b = await signupWithAccess(h, { studyCredits: 1 });
    const id = await idOf(b.email);
    const grant = await h.db.accessGrant.findFirstOrThrow({ where: { userId: id } });
    expect((await admin.post(`/api/admin/clients/${id}/grants/${grant.id}/credits`, { ...reason, credits: 3 })).statusCode).toBe(200);
    expect((await h.db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).studyCredits).toBe(4);
    await h.db.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await admin.post(`/api/admin/clients/${id}/grants/${grant.id}/credits`, { ...reason, credits: 1 });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe("grant_inactive");
    expect(await h.db.auditLog.count({ where: { action: "admin.credits_added", resourceId: grant.id } })).toBe(1);
  });
});

describe("extend a study", () => {
  it("reopens an expired study for testers", async () => {
    const b = await signupWithAccess(h);
    const id = await idOf(b.email);
    const { project } = await connectedProject(h.app, b.client);
    const study = await launchedStudy(h.app, b.client, project.id);
    await h.db.study.update({ where: { id: study.id }, data: { status: "expired", expiresAt: new Date(Date.now() - 1000) } });
    expect((await startParticipant(h.app, study.publicId)).res.statusCode).toBe(410);
    const until = new Date(Date.now() + 7 * 86400_000).toISOString();
    expect((await admin.post(`/api/admin/clients/${id}/studies/${study.id}/extend`, { ...reason, expiresAt: until })).statusCode).toBe(200);
    expect(await h.db.study.findUniqueOrThrow({ where: { id: study.id } })).toMatchObject({ status: "active" });
    expect((await startParticipant(h.app, study.publicId)).res.statusCode).toBe(201);
    const tooFar = new Date(Date.now() + 31 * 86400_000).toISOString();
    expect((await admin.post(`/api/admin/clients/${id}/studies/${study.id}/extend`, { ...reason, expiresAt: tooFar })).statusCode).toBe(400);
  });

  it("refuses a study the owner closed", async () => {
    const b = await signupWithAccess(h);
    const id = await idOf(b.email);
    const { project } = await connectedProject(h.app, b.client);
    const study = await launchedStudy(h.app, b.client, project.id);
    expect((await b.client.post(`/api/studies/${study.id}/close`)).statusCode).toBe(200);
    const until = new Date(Date.now() + 7 * 86400_000).toISOString();
    expect((await admin.post(`/api/admin/clients/${id}/studies/${study.id}/extend`, { ...reason, expiresAt: until })).statusCode).toBe(409);
    expect((await h.db.study.findUniqueOrThrow({ where: { id: study.id } })).status).toBe("closed");
  });
});

describe("re-run a UX Director report", () => {
  let clientId: string;
  let builder: Client;
  let project: { id: string; publicId: string };

  beforeAll(async () => {
    const b = await signupWithAccess(h, { studyCredits: 3 });
    clientId = await idOf(b.email);
    builder = b.client;
    project = (await connectedProject(h.app, b.client)).project;
  });

  const useStubModel = () => {
    const stub: UxDirectorProvider = {
      name: "ux_director",
      configured: true,
      implemented: true,
      // Never answers during the test, so a started analysis stays "processing".
      model: { call: () => new Promise((_, reject) => pendingModelCalls.push(reject)) },
      missingKeys: () => [],
      generateContextualQuestion: async () => null,
      healthCheck: async () => ({ ok: true, status: "verified", message: "stub" }) as never,
    };
    (h.ctx.providers as { uxDirector: UxDirectorProvider }).uxDirector = stub;
  };

  it("returns 422 when the study has no finished attempts", async () => {
    const study = await launchedStudy(h.app, builder, project.id, { name: "Empty" });
    useStubModel();
    expect((await admin.post(`/api/admin/clients/${clientId}/studies/${study.id}/rerun-report`, reason)).statusCode).toBe(422);
  });

  it("returns 409 when the latest report already covers every finished attempt", async () => {
    const study = await launchedStudy(h.app, builder, project.id, { name: "Current" });
    await finishAttempt(h, project, study);
    await h.db.report.create({
      data: { studyId: study.id, studyVersion: 1, source: "ux_director", status: "ready", title: "R", metricsSnapshot: {}, snapshotAt: new Date(), sessionsIncluded: 1 },
    });
    useStubModel();
    expect((await admin.post(`/api/admin/clients/${clientId}/studies/${study.id}/rerun-report`, reason)).statusCode).toBe(409);
  });

  it("starts a new analysis after a failure, and returns the running one on a second call", async () => {
    const study = await launchedStudy(h.app, builder, project.id, { name: "Failed" });
    await finishAttempt(h, project, study);
    const failed = await h.db.report.create({
      data: { studyId: study.id, studyVersion: 1, source: "ux_director", status: "failed", title: "R", metricsSnapshot: {}, snapshotAt: new Date(), failureReason: "timeout" },
    });
    useStubModel();
    const first = await admin.post(`/api/admin/clients/${clientId}/studies/${study.id}/rerun-report`, reason);
    expect(first.statusCode).toBe(200);
    expect(json(first).id).not.toBe(failed.id);
    expect(json(first).status).toBe("processing");
    const second = await admin.post(`/api/admin/clients/${clientId}/studies/${study.id}/rerun-report`, reason);
    expect(json(second).id).toBe(json(first).id);
    expect(await h.db.report.count({ where: { studyId: study.id, status: "processing" } })).toBe(1);
    expect(await h.db.auditLog.count({ where: { action: "admin.report_rerun", resourceId: json(first).id } })).toBe(1);
  });
});

describe("add a website for a client", () => {
  it("creates the website on the client's account, audited, and the client sees it", async () => {
    const b = await signupWithAccess(h);
    const id = await idOf(b.email);
    const res = await admin.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "Clinic site", websiteUrl: "https://clinic.example.com/" });
    expect(res.statusCode).toBe(201);
    const project = await h.db.project.findUniqueOrThrow({ where: { id: json(res).id } });
    expect(project.ownerId).toBe(id);
    expect(project.canonicalOrigin).toBe("https://clinic.example.com");
    const own = json(await b.client.get("/api/projects"));
    expect(own.projects.map((p: { id: string }) => p.id)).toContain(project.id);
    const rows = await h.db.auditLog.findMany({ where: { action: "admin.website_added", resourceId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ clientId: id, reason: reason.reason, before: null, after: { name: "Clinic site", origin: "https://clinic.example.com" } });
    expect(await h.db.conversionEvent.count({ where: { userId: id, name: "project_created" } })).toBe(0);
  });

  it("keeps the client's website limit and needs a reason", async () => {
    const b = await signupWithAccess(h);
    const id = await idOf(b.email);
    expect((await admin.post(`/api/admin/clients/${id}/websites`, { reason: " ", name: "A", websiteUrl: "https://a.example.com" })).statusCode).toBe(400);
    expect((await admin.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "A", websiteUrl: "https://a.example.com" })).statusCode).toBe(201);
    const second = await admin.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "B", websiteUrl: "https://b.example.com" });
    expect(second.statusCode).toBe(403);
    expect(json(second).error.code).toBe("entitlement_limit");
    expect((await b.client.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "D", websiteUrl: "https://d.example.com" })).statusCode).toBe(404);
  });
});

describe("set up a website before the client has access", () => {
  it("allows one website for a client without access, which they see after redeeming", async () => {
    const none = await signup(h.app);
    const id = await idOf(none.email);
    const res = await admin.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "Pre-setup", websiteUrl: "https://pre.example.com" });
    expect(res.statusCode).toBe(201);
    const second = await admin.post(`/api/admin/clients/${id}/websites`, { ...reason, name: "Another", websiteUrl: "https://another.example.com" });
    expect(second.statusCode).toBe(403);
    expect(json(second).error.code).toBe("entitlement_limit");
    expect((await none.client.get("/api/projects")).statusCode).toBe(403);
    const { generateCodes } = await import("../../apps/server/src/services/access-codes");
    const { codes } = await generateCodes(h.ctx, { label: "t", audience: "internal", planKey: "complimentary", studyCredits: 1, participantCap: 5, count: 1, maxRedemptions: 1 });
    expect((await none.client.post("/api/access/redeem", { code: codes[0] })).statusCode).toBe(200);
    const own = json(await none.client.get("/api/projects"));
    expect(own.projects.map((p: { id: string }) => p.id)).toContain(json(res).id);
  });
});
