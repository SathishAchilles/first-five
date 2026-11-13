import { describe, expect, it } from "vitest";
import { loadConfig } from "../../apps/server/src/config";
import { computeFlags, thresholdsFrom, type ClientFlagInput } from "../../apps/server/src/services/admin-clients";

const now = new Date("2026-11-20T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000);
const t = { noWebsiteDays: 3, notConnectedDays: 2, noAttemptsHours: 48 };

const base = (over: Partial<ClientFlagInput> = {}): ClientFlagInput => ({
  createdAt: ago(1),
  hasActiveGrant: true,
  pendingPayments: 0,
  websites: [{ createdAt: ago(1), integrationStatus: "connected" }],
  studies: [],
  ...over,
});

describe("admin client health flags", () => {
  it("raises nothing for a healthy builder", () => {
    expect(computeFlags(base(), now, t)).toEqual([]);
  });

  it("no_website only after the threshold", () => {
    expect(computeFlags(base({ websites: [], createdAt: ago(24 * 3 - 1) }), now, t)).not.toContain("no_website");
    expect(computeFlags(base({ websites: [], createdAt: ago(24 * 3 + 1) }), now, t)).toContain("no_website");
  });

  it("not_connected after 2 days, clears once connected", () => {
    const stale = { createdAt: ago(49), integrationStatus: "awaiting_connection" };
    expect(computeFlags(base({ websites: [stale] }), now, t)).toContain("not_connected");
    expect(computeFlags(base({ websites: [{ ...stale, integrationStatus: "connected" }] }), now, t)).not.toContain("not_connected");
    expect(computeFlags(base({ websites: [{ ...stale, createdAt: ago(47) }] }), now, t)).not.toContain("not_connected");
  });

  it("no_attempts for a study live 49 hours with 0 finished, and clears after one finish", () => {
    const study = { status: "active", launchedAt: ago(49), finishedAttempts: 0, latestUxReportStatus: null };
    expect(computeFlags(base({ studies: [study] }), now, t)).toContain("no_attempts");
    expect(computeFlags(base({ studies: [{ ...study, finishedAttempts: 1 }] }), now, t)).not.toContain("no_attempts");
    expect(computeFlags(base({ studies: [{ ...study, launchedAt: ago(47) }] }), now, t)).not.toContain("no_attempts");
    expect(computeFlags(base({ studies: [{ ...study, status: "closed" }] }), now, t)).not.toContain("no_attempts");
  });

  it("report_failed when a study's latest UX Director report failed", () => {
    const study = { status: "active", launchedAt: ago(5), finishedAttempts: 5, latestUxReportStatus: "failed" };
    expect(computeFlags(base({ studies: [study] }), now, t)).toContain("report_failed");
    expect(computeFlags(base({ studies: [{ ...study, latestUxReportStatus: "ready" }] }), now, t)).not.toContain("report_failed");
  });

  it("payment_pending and no_access", () => {
    expect(computeFlags(base({ pendingPayments: 1 }), now, t)).toContain("payment_pending");
    expect(computeFlags(base({ hasActiveGrant: false }), now, t)).toContain("no_access");
  });

  it("reads thresholds from config with defaults 3 days, 2 days, 48 hours", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000" });
    expect(thresholdsFrom(config)).toEqual(t);
  });
});
