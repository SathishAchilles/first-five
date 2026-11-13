import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, createHarness, json, makeSuperadmin, resetDb, signup, type Harness } from "../setup/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ PAYMENTS_ENABLED: "true", UPI_PAYEE_VPA: "firstfive.test@ybl", UPI_PAYEE_NAME: "First Five" });
  await resetDb(h.db);
});
afterAll(async () => h.close());

async function adminClient() {
  const a = await signup(h.app);
  await makeSuperadmin(h.db, a.email);
  return a.client;
}

describe("direct UPI payments (manual confirmation)", () => {
  it("stays closed unless PAYMENTS_ENABLED is true", async () => {
    const h2 = await createHarness({ UPI_PAYEE_VPA: "firstfive.test@ybl" });
    try {
      const { client } = await signup(h2.app);
      expect(json(await client.get("/api/billing/offer")).offer).toMatchObject({ checkoutAvailable: false, paymentMethod: null });
      expect((await client.post("/api/payments/checkout", {})).statusCode).toBe(503);
    } finally {
      await h2.close();
    }
  });

  it("buyer pays → submits UTR → no access until an admin confirms → exactly one credit", async () => {
    const { client, me } = await signup(h.app);
    const offer = json(await client.get("/api/billing/offer")).offer;
    expect(offer).toMatchObject({ checkoutAvailable: true, paymentMethod: "upi_manual", environment: "live", priceLabel: "₹99" });

    const co = json(await client.post("/api/payments/checkout", {}));
    // Re-clicking reuses the same unpaid order.
    expect(json(await client.post("/api/payments/checkout", {})).orderId).toBe(co.orderId);
    const status = json(await client.get(`/api/payments/orders/${co.orderId}`));
    expect(status).toMatchObject({ status: "checkout_ready", method: "upi_manual", environment: "live" });
    expect(status.reference).toMatch(/^FF[2-9A-Z]{8}$/);
    expect(status.upi.uri).toContain("pa=firstfive.test%40ybl");
    expect(status.upi.uri).toContain("am=99.00");
    expect(status.upi.uri).toContain(`tn=First%20Five%20${status.reference}`);

    expect((await client.post(`/api/payments/orders/${co.orderId}/upi-reference`, { utr: "12345" })).statusCode).toBe(400);
    const claimed = json(await client.post(`/api/payments/orders/${co.orderId}/upi-reference`, { utr: "412345678901" }));
    expect(claimed).toMatchObject({ status: "pending_verification", submittedUtr: "412345678901", upi: null });

    // A claim alone grants nothing.
    expect(json(await client.get("/api/auth/me")).entitlement.status).toBe("none");
    expect((await client.get("/api/projects")).statusCode).toBe(403);
    // Buyers can't confirm their own payment.
    expect((await client.post(`/api/admin/payments/${co.orderId}/confirm`)).statusCode).toBe(404);

    const admin = await adminClient();
    const list = json(await admin.get("/api/admin/payments")).payments;
    expect(list.find((p: { orderId: string }) => p.orderId === co.orderId)).toMatchObject({ utr: "412345678901", buyerEmail: me.user.email });
    expect((await admin.post(`/api/admin/payments/${co.orderId}/confirm`)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/payments/${co.orderId}/confirm`)).statusCode).toBe(200); // idempotent

    const ent = json(await client.get("/api/auth/me")).entitlement;
    expect(ent).toMatchObject({ status: "active", studyCredits: 1, creditsAvailable: 1, sources: ["payment"] });
    expect(await h.db.accessGrant.count({ where: { userId: me.user.id } })).toBe(1);
    expect(json(await client.get(`/api/payments/orders/${co.orderId}`)).status).toBe("paid_verified");
    const ev = await h.db.conversionEvent.findFirstOrThrow({ where: { name: "payment_verified", userId: me.user.id } });
    expect(ev.properties).toMatchObject({ environment: "live" });
    expect(await h.db.auditLog.count({ where: { action: "order.upi_confirmed", resourceId: co.orderId } })).toBe(1);
  });

  it("rejects duplicate UTRs across orders, and rejected payments grant nothing", async () => {
    const a = await signup(h.app);
    const b = await signup(h.app);
    const oa = json(await a.client.post("/api/payments/checkout", {})).orderId;
    const ob = json(await b.client.post("/api/payments/checkout", {})).orderId;
    await a.client.post(`/api/payments/orders/${oa}/upi-reference`, { utr: "555555555555" });
    const dup = await b.client.post(`/api/payments/orders/${ob}/upi-reference`, { utr: "555555555555" });
    expect(dup.statusCode).toBe(409);
    // Other buyers can't see or touch the order.
    expect((await b.client.get(`/api/payments/orders/${oa}`)).statusCode).toBe(404);

    const admin = await adminClient();
    expect((await admin.post(`/api/admin/payments/${oa}/reject`)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/payments/${oa}/confirm`)).statusCode).toBe(409);
    expect(json(await a.client.get("/api/auth/me")).entitlement.status).toBe("none");
    expect(json(await a.client.get(`/api/payments/orders/${oa}`)).status).toBe("failed");
  });

  it("requires sign-in to start checkout", async () => {
    expect((await new Client(h.app).post("/api/payments/checkout", {})).statusCode).toBe(401);
  });
});
