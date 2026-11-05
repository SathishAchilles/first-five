/**
 * Orders, verified payments and paid entitlements.
 * A paid AccessGrant is created ONLY from an order whose payment the server
 * verified with the provider. Promo/invitation access never creates payments.
 */
import type { OrderStatusDto, PaidOffer } from "@firstfive/shared";
import { Prisma } from "@prisma/client";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError, conflict, notFound } from "../lib/errors";
import { ProviderUnavailableError } from "../integrations/errors";
import type { VerifiedOrderStatus } from "../integrations/pinelabs";
import { getPlan } from "../plans";
import { recordActivationIfFirst, recordConversion } from "./conversions";
import { createUpiCheckout, UPI_PROVIDER, upiInstructions } from "./upi";

const PAID_PLAN = "single_study";

export function priceLabel(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Checkout opens only when it is EXPLICITLY enabled (PAYMENTS_ENABLED=true) AND a
 * payment method is ready: direct UPI (UPI_PAYEE_VPA, manually confirmed) or the
 * Pine Labs adapter (configured and implemented). Entering credentials alone never opens checkout.
 */
export function checkoutAvailability(ctx: AppContext): { available: boolean; reason: string | null; method: "upi_manual" | "pinelabs" | null } {
  const unavailable = { available: false, reason: "Paid access isn't available yet.", method: null };
  if (!ctx.config.PAYMENTS_ENABLED) return unavailable;
  if (ctx.config.UPI_PAYEE_VPA) return { available: true, reason: null, method: "upi_manual" };
  const p = ctx.providers.payments;
  if (p.configured && p.implemented) return { available: true, reason: null, method: "pinelabs" };
  return unavailable;
}

export function paidOffer(ctx: AppContext): PaidOffer {
  const plan = getPlan(ctx.config, PAID_PLAN);
  const a = checkoutAvailability(ctx);
  return {
    key: plan.key,
    name: plan.name,
    priceMinor: ctx.config.PAID_STUDY_PRICE_MINOR,
    currency: ctx.config.PAID_STUDY_CURRENCY,
    priceLabel: priceLabel(ctx.config.PAID_STUDY_PRICE_MINOR, ctx.config.PAID_STUDY_CURRENCY),
    studyCredits: plan.studyCredits,
    maxParticipantsPerStudy: plan.maxParticipantsPerStudy,
    checkoutAvailable: a.available,
    paymentMethod: a.method,
    // Direct UPI payments are real money.
    environment: a.method === "upi_manual" ? "live" : ctx.providers.payments.environment,
    unavailableReason: a.reason,
  };
}

export async function createCheckout(ctx: AppContext, userId: string, planKey: string) {
  if (planKey !== PAID_PLAN) throw new AppError(400, "invalid_request", "Unknown plan.");
  const a = checkoutAvailability(ctx);
  if (!a.available) throw new AppError(503, "payment_unavailable", a.reason!);
  if (a.method === "upi_manual") return createUpiCheckout(ctx, userId, planKey);
  const provider = ctx.providers.payments;
  const order = await ctx.db.order.create({
    data: {
      userId,
      planKey,
      provider: provider.name,
      amountMinor: ctx.config.PAID_STUDY_PRICE_MINOR,
      currency: ctx.config.PAID_STUDY_CURRENCY,
      environment: provider.environment,
      merchantReference: `ff_${randomToken(12)}`,
    },
  });
  try {
    const checkout = await provider.createCheckout({
      merchantReference: order.merchantReference,
      amountMinor: order.amountMinor,
      currency: order.currency,
      // The return page re-reads the order from the server; it never trusts URL parameters.
      returnUrl: `${ctx.config.appUrl}/payment/status?order=${order.id}`,
      description: `First Five — ${getPlan(ctx.config, planKey).name}`,
    });
    await ctx.db.order.update({ where: { id: order.id }, data: { status: "checkout_ready", providerOrderId: checkout.providerOrderId } });
    await audit(ctx.db, { actorUserId: userId, actorType: "user", action: "order.checkout_created", resourceType: "order", resourceId: order.id });
    await recordConversion(ctx.db, ctx.config, "checkout_started", { userId, properties: { environment: order.environment } });
    return { orderId: order.id, redirectUrl: checkout.redirectUrl };
  } catch (err) {
    await ctx.db.order.update({ where: { id: order.id }, data: { status: "failed" } });
    if (err instanceof ProviderUnavailableError) throw new AppError(503, "payment_unavailable", err.message);
    throw new AppError(502, "provider_error", "We couldn't start checkout. Please try again.");
  }
}

export async function getOrderStatus(ctx: AppContext, userId: string, orderId: string): Promise<OrderStatusDto> {
  const order = await ctx.db.order.findFirst({ where: { id: orderId, userId }, include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!order) throw notFound("Order");
  const isUpi = order.provider === UPI_PROVIDER;
  const utr = isUpi && order.payments[0]?.providerPaymentId ? order.payments[0].providerPaymentId.replace(/^upi:/, "") : null;
  return {
    id: order.id,
    status: order.status,
    environment: order.environment,
    amountLabel: priceLabel(order.amountMinor, order.currency),
    planName: getPlan(ctx.config, order.planKey).name,
    method: isUpi ? "upi_manual" : "pinelabs",
    reference: order.merchantReference,
    upi: isUpi && order.status === "checkout_ready" && ctx.config.UPI_PAYEE_VPA ? upiInstructions(ctx, order) : null,
    submittedUtr: utr,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

const STATE_TO_ORDER: Record<VerifiedOrderStatus["state"], Prisma.OrderUpdateInput["status"]> = {
  paid: "paid_verified",
  pending: "pending_verification",
  failed: "failed",
  cancelled: "cancelled",
  refunded: "refunded",
  unknown: "verification_error",
};

/** Apply a provider-verified status to an order. Idempotent. */
export async function applyVerifiedStatus(ctx: AppContext, status: VerifiedOrderStatus) {
  const order = await ctx.db.order.findUnique({ where: { merchantReference: status.merchantReference } });
  if (!order) throw new AppError(404, "not_found", "Unknown order.");
  if (status.amountMinor != null && (status.amountMinor !== order.amountMinor || status.currency !== order.currency)) {
    await ctx.db.order.update({ where: { id: order.id }, data: { status: "verification_error" } });
    throw conflict("amount_mismatch", "Verified amount doesn't match the order.");
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: STATE_TO_ORDER[status.state], providerOrderId: status.providerOrderId } });
    if (status.providerPaymentId) {
      await tx.payment.upsert({
        where: { providerPaymentId: status.providerPaymentId },
        create: {
          orderId: order.id,
          providerPaymentId: status.providerPaymentId,
          providerStatus: status.providerStatus,
          verified: status.state === "paid",
          verifiedAt: status.state === "paid" ? new Date() : null,
        },
        update: { providerStatus: status.providerStatus, verified: status.state === "paid", verifiedAt: status.state === "paid" ? new Date() : undefined },
      });
    }
  });
  if (status.state === "paid") {
    await grantPaidAccess(ctx, order.id);
  } else if (status.state === "failed" || status.state === "cancelled") {
    await recordConversion(ctx.db, ctx.config, "payment_failed", { userId: order.userId, properties: { environment: order.environment, state: status.state } });
  }
}

/** Creates the paid grant exactly once, and only for a verified, paid order. */
export async function grantPaidAccess(ctx: AppContext, orderId: string) {
  const order = await ctx.db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, grant: true } });
  if (order.status !== "paid_verified" || !order.payments.some((p) => p.verified)) {
    throw conflict("payment_not_verified", "Paid access requires a verified payment.");
  }
  if (order.grant) return order.grant;
  const plan = getPlan(ctx.config, order.planKey);
  try {
    const grant = await ctx.db.accessGrant.create({
      data: {
        userId: order.userId,
        planKey: plan.key,
        source: "payment",
        studyCredits: plan.studyCredits,
        maxParticipantsPerStudy: plan.maxParticipantsPerStudy,
        orderId: order.id,
      },
    });
    await audit(ctx.db, {
      actorType: "provider",
      action: "access.paid_granted",
      resourceType: "order",
      resourceId: order.id,
      metadata: { environment: order.environment, grantId: grant.id },
    });
    // Sandbox (UAT) payments are tagged so they are never counted as revenue.
    await recordConversion(ctx.db, ctx.config, "payment_verified", { userId: order.userId, properties: { environment: order.environment } });
    await recordActivationIfFirst(ctx.db, ctx.config, order.userId, "payment");
    return grant;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return ctx.db.accessGrant.findUniqueOrThrow({ where: { orderId: order.id } });
    }
    throw err;
  }
}

export async function handleWebhook(ctx: AppContext, rawBody: string, headers: Record<string, string | string[] | undefined>) {
  const provider = ctx.providers.payments;
  // Webhooks are processed whenever the adapter is configured, even if new checkouts are paused,
  // so in-flight orders still settle.
  if (!provider.configured || !provider.implemented) throw new AppError(503, "payment_unavailable", "Payments aren't configured.");
  const v = await provider.verifyWebhook(rawBody, headers);
  const digest = sha256(rawBody);
  if (!v.valid || !v.externalEventId || !v.providerOrderId) {
    await ctx.db.paymentWebhookEvent
      .create({ data: { provider: "pinelabs", externalEventId: `invalid:${digest}`, signatureValid: false, payloadDigest: digest } })
      .catch(() => undefined);
    throw new AppError(401, "invalid_signature", "Webhook signature could not be verified.");
  }
  try {
    await ctx.db.paymentWebhookEvent.create({ data: { provider: "pinelabs", externalEventId: v.externalEventId, signatureValid: true, payloadDigest: digest } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { duplicate: true };
    throw err;
  }
  // Never trust the webhook body for the outcome — fetch the authoritative status.
  const status = await provider.fetchOrderStatus(v.providerOrderId);
  await applyVerifiedStatus(ctx, status);
  await ctx.db.paymentWebhookEvent.update({
    where: { provider_externalEventId: { provider: "pinelabs", externalEventId: v.externalEventId } },
    data: { processedAt: new Date() },
  });
  return { duplicate: false };
}
