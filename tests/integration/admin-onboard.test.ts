import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateCodes } from "../../apps/server/src/services/access-codes";
import { Client, createHarness, json, makeSuperadmin, resetDb, signup, signupWithAccess, type Harness } from "../setup/harness";

let h: Harness;
let admin: Client;
let n = 0;
const reason = { reason: "pilot agreed on a call" };

const newCode = async () =>
  (await generateCodes(h.ctx, { label: "pilot", audience: "pilot", planKey: "complimentary", studyCredits: 1, participantCap: 5, count: 1, maxRedemptions: 1 })).codes[0]!;
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const onboard = async (over: Record<string, unknown> = {}) =>
  admin.post("/api/admin/clients/onboard", { ...reason, email: `pilot${++n}-${Date.now()}@example.com`, name: "Syam", company: "Whitesealabs", invitationCode: await newCode(), ...over });

beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
  const a = await signup(h.app);
  await makeSuperadmin(h.db, a.email);
  admin = a.client;
});
afterAll(async () => h.close());

describe("onboard a client with their invitation code", () => {
  it("creates an invite-code client who can't log in until they set their own password from the link", async () => {
    const res = await onboard({ email: "Syam@Example.com" });
    expect(res.statusCode).toBe(201);
    const { clientId, setPasswordUrl } = json(res);
    const user = await h.db.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(user).toMatchObject({ email: "syam@example.com", name: "Syam · Whitesealabs", role: "account_admin" });
    const grants = await h.db.accessGrant.findMany({ where: { userId: clientId } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ source: "invitation_code", studyCredits: 1 });
    expect(await h.db.order.count({ where: { userId: clientId } })).toBe(0);

    const row = json(await admin.get(`/api/admin/clients?q=syam@example.com`)).clients[0];
    expect(row).toMatchObject({ id: clientId, access: "active", pendingPasswordSetup: true });
    const audits = await h.db.auditLog.findMany({ where: { action: "admin.client_onboarded", resourceId: clientId } });
    expect(audits[0]!.metadata).toMatchObject({ clientId, reason: reason.reason });

    const anon = new Client(h.app);
    expect((await anon.post("/api/auth/login", { email: "syam@example.com", password: "!unset" })).statusCode).toBe(401);
    expect(json(await anon.get(`/api/auth/set-password?token=${tokenOf(setPasswordUrl)}`))).toEqual({ email: "syam@example.com" });
    const set = await anon.post("/api/auth/set-password", { token: tokenOf(setPasswordUrl), password: "their-own-password" });
    expect(set.statusCode).toBe(200);
    expect(json(set).user.email).toBe("syam@example.com");
    expect((await anon.get("/api/projects")).statusCode).toBe(200);

    const again = await new Client(h.app).post("/api/auth/set-password", { token: tokenOf(setPasswordUrl), password: "attacker-password" });
    expect(again.statusCode).toBe(410);
    expect((await new Client(h.app).post("/api/auth/login", { email: "syam@example.com", password: "their-own-password" })).statusCode).toBe(200);
    expect(json(await admin.get(`/api/admin/clients?q=syam@example.com`)).clients[0].pendingPasswordSetup).toBe(false);
  });

  it("refuses a taken email, a bad code and a missing reason without leaving an account behind", async () => {
    const existing = await signup(h.app);
    expect((await onboard({ email: existing.email })).statusCode).toBe(409);
    const bad = await onboard({ email: "badcode@example.com", invitationCode: "FF-NOPE-NOPE-NOPE-NOPE" });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(await h.db.user.findUnique({ where: { email: "badcode@example.com" } })).toBeNull();
    expect((await onboard({ email: "noreason@example.com", reason: " " })).statusCode).toBe(400);
    expect(await h.db.user.findUnique({ where: { email: "noreason@example.com" } })).toBeNull();
  });

  it("uses up the code, so it can't be redeemed again", async () => {
    const code = await newCode();
    expect((await onboard({ invitationCode: code })).statusCode).toBe(201);
    const other = await signup(h.app);
    expect((await other.client.post("/api/access/redeem", { code })).statusCode).toBe(410);
  });

  it("is superadmin-only", async () => {
    const b = await signupWithAccess(h);
    expect((await b.client.post("/api/admin/clients/onboard", { ...reason, email: "x@example.com", name: "X", invitationCode: await newCode() })).statusCode).toBe(404);
  });

  it("a new link replaces the old one, and none is issued once a password is set", async () => {
    const { clientId, setPasswordUrl: first } = json(await onboard());
    const re = await admin.post(`/api/admin/clients/${clientId}/set-password-link`, reason);
    expect(re.statusCode).toBe(200);
    expect((await new Client(h.app).post("/api/auth/set-password", { token: tokenOf(first), password: "their-own-password" })).statusCode).toBe(410);
    expect((await new Client(h.app).post("/api/auth/set-password", { token: tokenOf(json(re).setPasswordUrl), password: "their-own-password" })).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/clients/${clientId}/set-password-link`, reason)).statusCode).toBe(409);
  });
});
