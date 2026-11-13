import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantPaidAccess } from "../../apps/server/src/services/payments";
import {
  Client,
  connectedProject,
  createHarness,
  json,
  launchedStudy,
  resetDb,
  SITE,
  sdkEvent,
  sdkEvents,
  sdkExchange,
  signup,
  signupWithAccess,
  startParticipant,
  type Harness,
} from "../setup/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetDb(h.db);
});
afterAll(async () => h.close());

async function finishedAttempt(app: Harness["app"], project: { publicId: string }, study: { publicId: string }, reachGoal: boolean) {
  const p = await startParticipant(app, study.publicId);
  const ex = json(await sdkExchange(app, project.publicId, p.attempt.launchUrl));
  const base = { project_id: project.publicId, mode: "live" as const, study_id: study.publicId, session_id: p.attempt.sessionId };
  await sdkEvents(app, ex.credential, [
    sdkEvent(base, 0, { event_name: "ff_page_viewed", page_path: "/signup" }),
    sdkEvent(base, 1, { event_name: "ff_page_viewed", page_path: reachGoal ? "/dashboard" : "/pricing" }),
  ]);
  const end = json(
    await app.inject({ method: "POST", url: "/api/sdk/session/end", headers: { origin: SITE, authorization: `Bearer ${ex.credential}` }, payload: { reason: reachGoal ? "finished" : "gave_up" } }),
  );
  const token = new URL(end.feedback_url).hash.replace("#h=", "");
  return { participant: p.participant, sessionId: p.attempt.sessionId as string, token };
}

describe("post-task interview (A14, A15)", () => {
  it("shows standard + fallback questions, stores answers idempotently, and feeds metrics", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const a = await finishedAttempt(h.app, project, study, true);
    const b = await finishedAttempt(h.app, project, study, false);

    const anon = new Client(h.app);
    expect((await anon.get(`/api/public/studies/${study.publicId}/feedback`, { "x-ff-feedback": "nope-nope-nope-nope-nope" })).statusCode).toBe(401);

    const qs = json(await anon.get(`/api/public/studies/${study.publicId}/feedback`, { "x-ff-feedback": a.token }));
    expect(qs.questions.map((q: { key: string; source: string }) => [q.key, q.source])).toEqual([
      ["q1_ease", "standard"],
      ["q2_context", "fallback"],
      ["q3_improve", "standard"],
    ]);
    expect(qs.questions[1].text).toBe("Was anything different from what you expected?");

    const submit = await anon.post(
      `/api/public/studies/${study.publicId}/feedback`,
      { answers: [{ questionKey: "q1_ease", status: "answered", choice: "4" }, { questionKey: "q2_context", status: "skipped" }, { questionKey: "q3_improve", status: "answered", text: "  A clearer <b>button</b>\u0000 " }] },
      { "x-ff-feedback": a.token },
    );
    expect(submit.statusCode).toBe(200);
    await anon.post(`/api/public/studies/${study.publicId}/feedback`, { answers: [{ questionKey: "q3_improve", status: "answered", text: "overwrite attempt" }] }, { "x-ff-feedback": a.token });

    const sessions = json(await client.get(`/api/studies/${study.id}/sessions`)).sessions;
    const detailA = json(await client.get(`/api/sessions/${sessions.find((s: { publicId: string }) => s.publicId === a.sessionId).id}/details`));
    const q3 = detailA.feedback.find((f: { questionKey: string }) => f.questionKey === "q3_improve");
    expect(q3.text).toBe("A clearer <b>button</b>"); // stored as plain text; first answer kept
    expect(detailA.feedback.find((f: { questionKey: string }) => f.questionKey === "q2_context").status).toBe("skipped");
    expect(detailA.timeline.some((t: { isGoal: boolean }) => t.isGoal)).toBe(true);

    const detailB = json(await client.get(`/api/sessions/${sessions.find((s: { publicId: string }) => s.publicId === b.sessionId).id}/details`));
    expect(detailB.status).toBe("dropped");
    expect(detailB.feedback.every((f: { status: string }) => f.status === "missing")).toBe(true);
    expect(detailB.lastEvent).toMatchObject({ name: "ff_page_viewed", pagePath: "/pricing" });

    const m = json(await client.get(`/api/studies/${study.id}/dashboard`)).metrics;
    expect(m).toMatchObject({ attempts: 2, completed: 1, dropped: 1, finalized: 2 });
    expect(m.completionRate).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(m.feedbackCoverage).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(m.medianCompletionMs).toBeGreaterThanOrEqual(0);
  });
});

describe("reports, evidence and approval (A18–A20)", () => {
  it("validates evidence, requires a real review, and publishes once", async () => {
    const owner = await signupWithAccess(h);
    const other = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, owner.client);
    const study = await launchedStudy(h.app, owner.client, project.id);
    const a = await finishedAttempt(h.app, project, study, false);
    const anon = new Client(h.app);
    await anon.post(`/api/public/studies/${study.publicId}/feedback`, { answers: [{ questionKey: "q3_improve", status: "answered", text: "Show the price first" }] }, { "x-ff-feedback": a.token });
    const sessionRow = await h.db.studySession.findUniqueOrThrow({ where: { publicId: a.sessionId } });

    // No fabricated AI analysis.
    const analyze = await owner.client.post(`/api/studies/${study.id}/analyze`);
    expect(analyze.statusCode).toBe(503);
    expect(json(analyze).error.code).toBe("provider_not_configured");
    expect(await h.db.agentRun.count()).toBe(0);

    const report = json(await owner.client.post(`/api/studies/${study.id}/reports`));
    expect(report).toMatchObject({ status: "draft", source: "owner", revision: 1 });
    expect(report.metricsSnapshot).toMatchObject({ dropped: 1 });
    expect((await other.client.get(`/api/reports/${report.id}`)).statusCode).toBe(404);

    // Evidence must belong to this study.
    const foreign = await owner.client.post(`/api/reports/${report.id}/findings`, {
      title: "Bad",
      observed: "x happened",
      supportingSessionIds: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(foreign.statusCode).toBe(400);

    const quotes = json(await owner.client.get(`/api/studies/${study.id}/quotes`)).quotes;
    expect(quotes).toHaveLength(1);
    const withFinding = json(
      await owner.client.post(`/api/reports/${report.id}/findings`, {
        title: "Pricing checked before signup",
        observed: "1 participant opened /pricing and did not finish.",
        supportingSessionIds: [sessionRow.id],
        quoteResponseIds: [quotes[0].responseId],
        evidenceStrength: "limited",
        suggestion: "Show plan terms by the signup button.",
        retestMetric: "Completed attempts",
      }),
    );
    const f = withFinding.findings[0];
    expect(f.affectedCount).toBe(1);
    expect(f.quotes[0].text).toBe("Show the price first");
    expect(f.assistantPrompt).toContain("Show plan terms by the signup button.");

    expect(json(await owner.client.post(`/api/reports/${report.id}/publish`)).error.code).toBe("approval_required");
    expect((await owner.client.post(`/api/reports/${report.id}/review`, { decision: "approved" })).statusCode).toBe(409);
    expect(json(await owner.client.post(`/api/reports/${report.id}/request-review`)).status).toBe("awaiting_review");
    expect((await owner.client.post(`/api/reports/${report.id}/findings`, { title: "Late", observed: "edit in review" })).statusCode).toBe(409);
    expect((await other.client.post(`/api/reports/${report.id}/review`, { decision: "approved" })).statusCode).toBe(404);

    const approved = json(await owner.client.post(`/api/reports/${report.id}/review`, { decision: "approved", note: "Looks right" }));
    expect(approved.status).toBe("approved");
    const published = json(await owner.client.post(`/api/reports/${report.id}/publish`));
    expect(published.status).toBe("published");
    expect(published.shareUrl).toMatch(/\/r\//);
    const again = json(await owner.client.post(`/api/reports/${report.id}/publish`));
    expect(again.shareUrl).toBe(published.shareUrl);
    expect(await h.db.auditLog.count({ where: { action: "report.published", resourceId: report.id } })).toBe(1);

    const token = published.shareUrl.split("/r/")[1];
    const pub = json(await anon.get(`/api/public/reports/${token}`));
    expect(pub.findings[0].quotes[0].text).toBe("Show the price first");
    expect(JSON.stringify(pub)).not.toContain(sessionRow.id);
  });

  it("does not publish rejected reports, and reopening invalidates the old approval (A19)", async () => {
    const { client } = await signupWithAccess(h);
    const { project } = await connectedProject(h.app, client);
    const study = await launchedStudy(h.app, client, project.id);
    const report = json(await client.post(`/api/studies/${study.id}/reports`));
    await client.post(`/api/reports/${report.id}/findings`, { title: "Observation", observed: "Something observed" });
    await client.post(`/api/reports/${report.id}/request-review`);
    expect(json(await client.post(`/api/reports/${report.id}/review`, { decision: "rejected" })).status).toBe("rejected");
    expect((await client.post(`/api/reports/${report.id}/publish`)).statusCode).toBe(409);

    const reopened = json(await client.post(`/api/reports/${report.id}/reopen`));
    expect(reopened).toMatchObject({ status: "draft", revision: 2 });
    // Force status to approved without an approval for revision 2: publish must still refuse.
    await h.db.report.update({ where: { id: report.id }, data: { status: "approved" } });
    expect(json(await client.post(`/api/reports/${report.id}/publish`)).error.code).toBe("approval_required");
  });
});

describe("payments and provider status", () => {
  it("reports paid access as unavailable and never grants it without a verified payment", async () => {
    const { client, me } = await signupWithAccess(h);
    const offer = json(await client.get("/api/billing/offer")).offer;
    expect(offer).toMatchObject({ priceMinor: 9900, currency: "INR", priceLabel: "₹99", studyCredits: 1, maxParticipantsPerStudy: 5, checkoutAvailable: false });
    const checkout = await client.post("/api/payments/checkout", { planKey: "single_study" });
    expect(checkout.statusCode).toBe(503);
    const webhook = await h.app.inject({ method: "POST", url: "/api/payments/webhook/pinelabs", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(webhook.statusCode).toBe(503);

    // Policy check: an order that isn't verified can't produce a paid grant.
    const order = await h.db.order.create({
      data: { userId: me.user.id, planKey: "single_study", amountMinor: 9900, currency: "INR", environment: "uat", merchantReference: "ff_test_ref_1", status: "pending_verification" },
    });
    await expect(grantPaidAccess(h.ctx, order.id)).rejects.toThrow(/verified payment/);
    expect(await h.db.accessGrant.count({ where: { source: "payment" } })).toBe(0);

    // A verified UAT order grants exactly one credit, idempotently, and is tagged as sandbox.
    const paid = await h.db.order.create({
      data: { userId: me.user.id, planKey: "single_study", amountMinor: 9900, currency: "INR", environment: "uat", merchantReference: "ff_test_ref_2", status: "paid_verified" },
    });
    await h.db.payment.create({ data: { orderId: paid.id, providerPaymentId: "pl_test_1", providerStatus: "PROCESSED", verified: true, verifiedAt: new Date() } });
    const g1 = await grantPaidAccess(h.ctx, paid.id);
    const g2 = await grantPaidAccess(h.ctx, paid.id);
    expect(g1.id).toBe(g2.id);
    expect(g1).toMatchObject({ source: "payment", studyCredits: 1, maxParticipantsPerStudy: 5 });
    const ev = await h.db.conversionEvent.findFirstOrThrow({ where: { name: "payment_verified" } });
    expect(ev.properties).toMatchObject({ environment: "uat" });

    // Order status is readable only by its owner and comes from the database, not the URL.
    expect(json(await client.get(`/api/payments/orders/${paid.id}`))).toMatchObject({ status: "paid_verified", environment: "uat", amountLabel: "₹99" });
    const stranger = await signup(h.app);
    expect((await stranger.client.get(`/api/payments/orders/${paid.id}`)).statusCode).toBe(404);
  });

  it("keeps checkout closed when explicitly enabled but the provider isn't implemented", async () => {
    const h2 = await createHarness({ PAYMENTS_ENABLED: "true", PINELABS_BASE_URL: "https://uat.example", PINELABS_CLIENT_ID: "x", PINELABS_CLIENT_SECRET: "y", PINELABS_MERCHANT_ID: "z", PINELABS_WEBHOOK_SECRET: "w" });
    try {
      const { client, me } = await signup(h2.app);
      expect(json(await client.get("/api/billing/offer")).offer.checkoutAvailable).toBe(false);
      expect((await client.post("/api/payments/checkout", {})).statusCode).toBe(503);
      expect(await h2.db.order.count({ where: { userId: me.user.id } })).toBe(0);
    } finally {
      await h2.close();
    }
  });

  it("lists integrations as not configured, and verifies Postgres with a real query", async () => {
    const { client, email } = await signupWithAccess(h);
    await h.db.user.update({ where: { email }, data: { role: "superadmin" } });
    const list = json(await client.get("/api/admin/integrations")).providers;
    const status = Object.fromEntries(list.map((p: { provider: string; status: string }) => [p.provider, p.status]));
    expect(status).toMatchObject({ sdk: "not_configured", posthog: "not_configured", agenticorg: "not_configured", pinelabs: "not_configured", postgres: "configured" });
    expect(JSON.stringify(list)).not.toContain("test-secret");
    const v = json(await client.post("/api/admin/integrations/postgres/verify"));
    expect(v.result.status).toBe("verified");
    const ph = json(await client.post("/api/admin/integrations/posthog/verify"));
    expect(ph.result.status).toBe("not_configured");
    expect(ph.providers.find((p: { provider: string }) => p.provider === "posthog").status).toBe("not_configured");
  });
});
