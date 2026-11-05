/**
 * Pine Labs hosted-checkout integration interface.
 *
 * The live API calls are intentionally NOT implemented until real UAT
 * credentials and the current Pine Labs API reference are available
 * (see docs/integrations/PINELABS_SETUP.md). Until then checkout is reported
 * as unavailable and no paid entitlement can ever be issued.
 */
import type { AppConfig } from "../config";
import { ProviderUnavailableError } from "./errors";
import type { HealthResult } from "./posthog";

export interface CheckoutRequest {
  merchantReference: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  description: string;
}

export interface CheckoutResult {
  providerOrderId: string;
  redirectUrl: string;
}

export type ProviderPaymentState = "pending" | "paid" | "failed" | "cancelled" | "refunded" | "unknown";

export interface VerifiedOrderStatus {
  providerOrderId: string;
  merchantReference: string;
  state: ProviderPaymentState;
  providerStatus: string;
  providerPaymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface WebhookVerification {
  valid: boolean;
  externalEventId: string | null;
  providerOrderId: string | null;
}

export interface PaymentProvider {
  readonly name: "pinelabs";
  readonly configured: boolean;
  readonly implemented: boolean;
  readonly environment: "uat" | "live";
  missingKeys(): string[];
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Always fetch authoritative status from the provider; never trust redirect parameters. */
  fetchOrderStatus(providerOrderId: string): Promise<VerifiedOrderStatus>;
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookVerification>;
  healthCheck(): Promise<HealthResult>;
}

export class PineLabsAdapter implements PaymentProvider {
  readonly name = "pinelabs" as const;
  readonly implemented = false;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "PINELABS_ENV" | "PINELABS_BASE_URL" | "PINELABS_CLIENT_ID" | "PINELABS_CLIENT_SECRET" | "PINELABS_MERCHANT_ID" | "PINELABS_WEBHOOK_SECRET"
    >,
  ) {}

  get environment(): "uat" | "live" {
    return this.config.PINELABS_ENV;
  }

  get configured(): boolean {
    return this.missingKeys().length === 0;
  }

  missingKeys(): string[] {
    const keys: [string, unknown][] = [
      ["PINELABS_BASE_URL", this.config.PINELABS_BASE_URL],
      ["PINELABS_CLIENT_ID", this.config.PINELABS_CLIENT_ID],
      ["PINELABS_CLIENT_SECRET", this.config.PINELABS_CLIENT_SECRET],
      ["PINELABS_MERCHANT_ID", this.config.PINELABS_MERCHANT_ID],
      ["PINELABS_WEBHOOK_SECRET", this.config.PINELABS_WEBHOOK_SECRET],
    ];
    return keys.filter(([, v]) => !v).map(([k]) => k);
  }

  private unavailable(): never {
    if (!this.configured) throw new ProviderUnavailableError("pinelabs", "Paid access isn't available yet.");
    throw new ProviderUnavailableError(
      "pinelabs",
      "Pine Labs credentials are set, but the checkout connector hasn't been implemented and verified yet.",
    );
  }

  async createCheckout(): Promise<CheckoutResult> {
    this.unavailable();
  }

  async fetchOrderStatus(): Promise<VerifiedOrderStatus> {
    this.unavailable();
  }

  async verifyWebhook(): Promise<WebhookVerification> {
    // Fail closed: without a verified implementation no webhook is ever trusted.
    return { valid: false, externalEventId: null, providerOrderId: null };
  }

  async healthCheck(): Promise<HealthResult> {
    if (!this.configured) {
      return { ok: false, status: "not_configured", message: `Missing: ${this.missingKeys().join(", ")}` };
    }
    return {
      ok: false,
      status: "verification_pending",
      message: "Credentials are present. Implement and verify hosted checkout with a UAT transaction (\"Connect Pine Labs\").",
    };
  }
}
