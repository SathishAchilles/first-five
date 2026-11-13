import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  connectedProject,
  createHarness,
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
let adminId: string;
let builder: Client;
let clientId: string;
let study: { id: string; publicId: string };
let project: { id: string; publicId: string };

const idOf = async (email: string) => (await h.db.user.findUniqueOrThrow({ where: { email } })).id;
const start = (c: Client, userId = clientId) => c.post("/api/admin/impersonation", { userId, reason: "reproduce a support ticket" });

/** Every write route the server defines, read from the route files. */
function writeRoutes(): { method: "POST" | "PATCH" | "PUT" | "DELETE"; url: string }[] {
  const dir = resolve("apps/server/src/routes");
  const routes: { method: "POST" | "PATCH" | "PUT" | "DELETE"; url: string }[] = [];
  for (const file of readdirSync(dir)) {
    const src = readFileSync(resolve(dir, file), "utf8");
    for (const m of src.matchAll(/app\.(post|patch|put|delete)\(\s*"([^"]+)"/g)) {
      routes.push({ method: m[1]!.toUpperCase() as never, url: m[2]! });
    }
  }
  return routes
    .filter((r) => !r.url.startsWith("/api/sdk/") && !r.url.startsWith("/api/public/") && !r.url.startsWith("/api/payments/webhook/"))
    .filter((r) => !(r.method === "DELETE" && r.url === "/api/admin/impersonation"))
    .map((r) => ({ ...r, url: r.url.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000") }));
}

beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
  const a = await signup(h.app);
  await makeSuperadmin(h.db, a.email);
  admin = a.client;
  adminId = await idOf(a.email);
  const b = await signupWithAccess(h, { studyCredits: 2 });
  builder = b.client;
  clientId = await idOf(b.email);
  project = (await connectedProject(h.app, b.client)).project;
  study = await launchedStudy(h.app, b.client, project.id);
});
afterAll(async () => h.close());

describe("view as client", () => {
  it("shows the client's own data, and /api/auth/me reports the view", async () => {
    const res = await start(admin);
    expect(res.statusCode).toBe(200);
    const studies = json(await admin.get("/api/studies")).studies;
    expect(studies.map((s: { id: string }) => s.id)).toContain(study.id);
    const me = json(await admin.get("/api/auth/me"));
    expect(me.user.id).toBe(clientId);
    expect(me.impersonation.clientEmail).toBe(me.user.email);
    expect(await h.db.auditLog.count({ where: { action: "admin.impersonation_started", resourceId: clientId } })).toBe(1);
    await admin.del("/api/admin/impersonation");
  });

  it("refuses to view an admin account", async () => {
    const other = await signup(h.app);
    await makeSuperadmin(h.db, other.email);
    expect((await start(admin, await idOf(other.email))).statusCode).toBe(403);
    expect(await h.db.authSession.count({ where: { readOnly: true } })).toBe(0);
  });

  it("refuses every write route with read_only_view and changes no rows", async () => {
    await start(admin);
    const counts = async () => [await h.db.study.count(), await h.db.order.count(), await h.db.invitationCodeRedemption.count(), await h.db.project.count()];
    const before = await counts();
    const routes = writeRoutes();
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) {
      const res = await admin.req(r.method, r.url, {});
      expect({ route: `${r.method} ${r.url}`, status: res.statusCode, code: json(res).error?.code }).toEqual({
        route: `${r.method} ${r.url}`,
        status: 403,
        code: "read_only_view",
      });
    }
    expect(await counts()).toEqual(before);
    await admin.del("/api/admin/impersonation");
  });

  it("hides the admin area while viewing as a client", async () => {
    await start(admin);
    expect((await admin.get("/api/admin/clients")).statusCode).toBe(404);
    await admin.del("/api/admin/impersonation");
  });

  it("stop restores the admin without a new login and audits it", async () => {
    await start(admin);
    const res = await admin.del("/api/admin/impersonation");
    expect(json(res)).toMatchObject({ clientId, restored: true });
    expect(json(await admin.get("/api/auth/me")).user.id).toBe(adminId);
    expect((await admin.get("/api/admin/clients")).statusCode).toBe(200);
    expect(await h.db.auditLog.count({ where: { action: "admin.impersonation_stopped", metadata: { path: ["reason"], equals: "stopped" } } })).toBeGreaterThan(0);
    expect(await h.db.authSession.count({ where: { readOnly: true } })).toBe(0);
  });

  it("expires after 30 minutes and hands back the admin, audited as expired", async () => {
    await start(admin);
    const view = await h.db.authSession.findFirstOrThrow({ where: { readOnly: true } });
    expect(view.expiresAt.getTime() - view.createdAt.getTime()).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
    await h.db.authSession.update({ where: { id: view.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const me = json(await admin.get("/api/auth/me"));
    expect(me.user.id).toBe(adminId);
    expect(me.impersonation).toBeNull();
    expect(await h.db.auditLog.count({ where: { action: "admin.impersonation_stopped", metadata: { path: ["reason"], equals: "expired" } } })).toBe(1);
    expect((await admin.get("/api/admin/clients")).statusCode).toBe(200);
  });

  it("never extends itself and never touches the client's own session", async () => {
    const own = await h.db.authSession.findFirstOrThrow({ where: { userId: clientId, readOnly: false } });
    await start(admin);
    const view = await h.db.authSession.findFirstOrThrow({ where: { readOnly: true } });
    // Make both sessions look idle for two hours: a normal session would slide forward on the next request.
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    await h.db.authSession.update({ where: { id: view.id }, data: { lastSeenAt: twoHoursAgo } });
    await admin.get("/api/studies");
    const after = await h.db.authSession.findUniqueOrThrow({ where: { id: view.id } });
    expect(after.expiresAt).toEqual(view.expiresAt);
    expect(after.lastSeenAt).toEqual(twoHoursAgo);
    expect((await h.db.authSession.findUniqueOrThrow({ where: { id: own.id } })).lastSeenAt).toEqual(own.lastSeenAt);
    expect((await builder.get("/api/auth/me")).statusCode).toBe(200);
    await admin.del("/api/admin/impersonation");
  });

  it("leaves tester and SDK traffic alone", async () => {
    await start(admin);
    const attempt = await admin.post(`/api/public/studies/${study.publicId}/attempts`, { consent: true });
    expect(attempt.statusCode).toBe(201);
    const launchUrl = json(attempt).launchUrl;
    const res = await h.app.inject({
      method: "POST",
      url: "/api/sdk/exchange",
      headers: { origin: "https://acme-test.example.com", cookie: Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
      payload: { project_id: project.publicId, ticket: new URL(launchUrl).hash.replace(/^#(ff_setup|ff_launch)=/, "") },
    });
    expect(res.statusCode).toBe(200);
    await admin.del("/api/admin/impersonation");
  });
});
