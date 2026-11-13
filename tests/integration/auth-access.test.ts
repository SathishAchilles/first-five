import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateCodes } from "../../apps/server/src/services/access-codes";
import { APP_URL, Client, createHarness, json, makeSuperadmin, resetDb, signup, signupWithAccess, type Harness } from "../setup/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
});
afterAll(async () => h.close());

describe("authentication", () => {
  it("signs up with a hashed password and secure session cookie, but grants no product access", async () => {
    const c = new Client(h.app);
    const res = await c.post("/api/auth/signup", { email: "Founder@Example.com", password: "a-very-good-password" });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((x) => x.name === "ff_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const body = json(res);
    expect(body.user.email).toBe("founder@example.com");
    expect(body.entitlement).toMatchObject({ status: "none", studyCredits: 0, creditsAvailable: 0 });
    // Registered without entitlement → workspace is closed.
    const blocked = await c.get("/api/projects");
    expect(blocked.statusCode).toBe(403);
    expect(json(blocked).error.code).toBe("no_entitlement");
    expect(await h.db.conversionEvent.count({ where: { name: "signup_completed" } })).toBe(1);
    const user = await h.db.user.findUniqueOrThrow({ where: { email: "founder@example.com" } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain("a-very-good-password");
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
  });

  it("rejects duplicate emails, weak passwords and bad credentials", async () => {
    const c = new Client(h.app);
    expect((await c.post("/api/auth/signup", { email: "founder@example.com", password: "another-password" })).statusCode).toBe(409);
    const weak = await c.post("/api/auth/signup", { email: "x@example.com", password: "short" });
    expect(weak.statusCode).toBe(400);
    expect(json(weak).error.fields.password).toBeTruthy();
    expect((await c.post("/api/auth/login", { email: "founder@example.com", password: "wrong-password" })).statusCode).toBe(401);
    expect((await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password" })).statusCode).toBe(401);
  });

  it("logs in, protects routes and logs out", async () => {
    const c = new Client(h.app);
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
    expect((await c.get("/api/projects")).statusCode).toBe(401);
    expect((await c.post("/api/auth/login", { email: "founder@example.com", password: "a-very-good-password" })).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
    await c.post("/api/auth/logout");
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
  });

  it("rejects cookie-authenticated writes from another origin (CSRF)", async () => {
    const { client } = await signupWithAccess(h);
    const res = await client.post("/api/projects", { name: "X", websiteUrl: "https://x.example.com" }, { origin: "https://evil.example.com" });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe("csrf_rejected");
    const ok = await client.post("/api/projects", { name: "X", websiteUrl: "https://x.example.com" }, { origin: APP_URL });
    expect(ok.statusCode).toBe(201);
  });
});

describe("invitation codes and entitlements", () => {
  it("redeems a complimentary code once per account and unlocks the workspace (A22)", async () => {
    const { codes } = await generateCodes(h.ctx, { label: "Judges", audience: "judge", planKey: "complimentary", count: 1, maxRedemptions: 3 });
    const { client } = await signup(h.app);
    expect((await client.get("/api/projects")).statusCode).toBe(403);
    const res = await client.post("/api/access/redeem", { code: codes[0]!.toLowerCase() });
    expect(res.statusCode).toBe(200);
    expect(json(res).entitlement).toMatchObject({ status: "active", studyCredits: 1, creditsAvailable: 1, maxParticipantsPerStudy: 5 });
    expect((await client.get("/api/projects")).statusCode).toBe(200);
    expect(await h.db.conversionEvent.count({ where: { name: "invitation_code_redeemed" } })).toBeGreaterThan(0);
    expect(await h.db.conversionEvent.count({ where: { name: "workspace_activated" } })).toBeGreaterThan(0);
    expect((await client.post("/api/access/redeem", { code: codes[0] })).statusCode).toBe(409);
    expect(await h.db.order.count()).toBe(0);
    const stored = await h.db.invitationCode.findFirstOrThrow({ where: { label: "Judges" } });
    expect(stored.codeHash).not.toContain(codes[0]!.replace(/-/g, ""));
    expect(stored.redemptionCount).toBe(1);
  });

  it("tells a user they already redeemed a single-use code instead of calling it used up", async () => {
    const { codes } = await generateCodes(h.ctx, { label: "Once", audience: "judge", planKey: "complimentary", count: 1, maxRedemptions: 1 });
    const { client } = await signup(h.app);
    expect((await client.post("/api/access/redeem", { code: codes[0] })).statusCode).toBe(200);
    const again = await client.post("/api/access/redeem", { code: codes[0] });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.code).toBe("already_redeemed");
    const other = await signup(h.app);
    expect(json(await other.client.post("/api/access/redeem", { code: codes[0] })).error.code).toBe("code_exhausted");
  });

  it("enforces the redemption limit atomically under concurrency", async () => {
    const { codes } = await generateCodes(h.ctx, { label: "Single", audience: "pilot", planKey: "complimentary", count: 1, maxRedemptions: 1 });
    const users = await Promise.all(Array.from({ length: 6 }, () => signup(h.app)));
    const results = await Promise.all(users.map((u) => u.client.post("/api/access/redeem", { code: codes[0] })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const rec = await h.db.invitationCode.findFirstOrThrow({ where: { label: "Single" } });
    expect(rec.redemptionCount).toBe(1);
    expect(await h.db.invitationCodeRedemption.count({ where: { codeId: rec.id } })).toBe(1);
  });

  it("rejects invalid, expired and disabled codes", async () => {
    const { client } = await signup(h.app);
    expect((await client.post("/api/access/redeem", { code: "FF-0000-0000-0000-0000" })).statusCode).toBe(400);
    const { codes, records } = await generateCodes(h.ctx, { label: "Expiring", audience: "judge", planKey: "complimentary", count: 2, maxRedemptions: 5 });
    await h.db.invitationCode.update({ where: { id: records[0]!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.db.invitationCode.update({ where: { id: records[1]!.id }, data: { disabledAt: new Date() } });
    expect(json(await client.post("/api/access/redeem", { code: codes[0] })).error.code).toBe("code_expired");
    expect(json(await client.post("/api/access/redeem", { code: codes[1] })).error.code).toBe("code_disabled");
  });

  it("applies a code during signup, and refuses signup with an invalid code", async () => {
    const { codes } = await generateCodes(h.ctx, { label: "Signup", audience: "judge", planKey: "complimentary", count: 1, maxRedemptions: 1 });
    const ok = await signup(h.app, { invitationCode: codes[0] });
    expect(ok.me.entitlement.status).toBe("active");
    const c = new Client(h.app);
    const bad = await c.post("/api/auth/signup", { email: "nocode@example.com", password: "a-very-good-password", invitationCode: "FF-1111-2222-3333-4444" });
    expect(bad.statusCode).toBe(400);
    expect(await h.db.user.count({ where: { email: "nocode@example.com" } })).toBe(0);
  });

  it("keeps admin endpoints hidden from non-admins and lets admins generate codes", async () => {
    const { client, email } = await signup(h.app);
    expect((await client.get("/api/admin/codes")).statusCode).toBe(404);
    expect((await client.post("/api/admin/codes", { label: "x" })).statusCode).toBe(404);
    await makeSuperadmin(h.db, email);
    const res = await client.post("/api/admin/codes", { label: "Judges batch", count: 2, maxRedemptions: 1, expiresInDays: 7 });
    expect(res.statusCode).toBe(201);
    expect(json(res).codes).toHaveLength(2);
    const list = json(await client.get("/api/admin/codes"));
    expect(JSON.stringify(list)).not.toContain(json(res).codes[0]);
  });

  it("honours per-code allowances", async () => {
    const { codes } = await generateCodes(h.ctx, { label: "Pilot x3", audience: "pilot", planKey: "complimentary", studyCredits: 3, participantCap: 8, count: 1, maxRedemptions: 1 });
    const { client } = await signup(h.app);
    const e = json(await client.post("/api/access/redeem", { code: codes[0] })).entitlement;
    expect(e).toMatchObject({ studyCredits: 3, maxParticipantsPerStudy: 8, maxProjects: 3 });
  });
});

describe("superadmin is server-granted only", () => {
  it("has no in-app way to become a superadmin, and new accounts are account admins", async () => {
    const plain = await signup(h.app);
    expect(json(await plain.client.get("/api/auth/me")).user.role).toBe("account_admin");
    expect((await plain.client.post("/api/admin-bootstrap", { token: "x".repeat(30) })).statusCode).toBe(404);
    expect((await plain.client.get("/api/admin/clients")).statusCode).toBe(404);
    await makeSuperadmin(h.db, plain.email);
    expect(json(await plain.client.get("/api/auth/me")).user.role).toBe("superadmin");
    expect((await plain.client.get("/api/admin/clients")).statusCode).toBe(200);
  });
});
