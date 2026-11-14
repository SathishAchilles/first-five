/**
 * Superadmin onboarding: creates a client account and returns a one-time link
 * for the client to choose their own password. Until they do, nobody can log in.
 * With an invitation code, the code is redeemed on the account; without one,
 * the client redeems the code themselves after setting their password.
 */
import { EmailSchema, PasswordSchema } from "@firstfive/shared";
import { z } from "zod";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { assertClient } from "./admin-clients";
import { ReasonSchema } from "./admin-support";
import { checkCode, redeemCode } from "./access-codes";
import { hashPassword, UNSET_PASSWORD } from "./auth";

export const PASSWORD_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const OnboardClientSchema = ReasonSchema.extend({
  email: EmailSchema,
  name: z.string().trim().min(1, "Enter the client's name.").max(80),
  company: z.string().trim().max(80).optional(),
  invitationCode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().min(8, "Enter the full invitation code.").optional()),
});

export const SetPasswordSchema = z.object({ token: z.string().min(16).max(200), password: PasswordSchema });

export const hasUnsetPassword = (u: { passwordHash: string }) => u.passwordHash === UNSET_PASSWORD;

async function issueLink(ctx: AppContext, adminId: string, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_MS);
  await ctx.db.passwordSetupToken.create({ data: { userId, tokenHash: sha256(token), createdById: adminId, expiresAt } });
  return { setPasswordUrl: `${ctx.config.appUrl}/set-password?token=${token}`, expiresAt: expiresAt.toISOString() };
}

export async function onboardClient(ctx: AppContext, adminId: string, raw: unknown) {
  const input = OnboardClientSchema.parse(raw);
  if (await ctx.db.user.findUnique({ where: { email: input.email } })) {
    throw new AppError(409, "email_taken", "An account with this email already exists.", { email: "Already has an account" });
  }
  if (input.invitationCode) await checkCode(ctx, input.invitationCode);
  const name = input.company ? `${input.name} · ${input.company}` : input.name;
  const user = await ctx.db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: input.email, name, passwordHash: UNSET_PASSWORD } });
    await audit(tx, {
      actorUserId: adminId,
      actorType: "admin",
      action: "admin.client_onboarded",
      resourceType: "user",
      resourceId: u.id,
      metadata: { clientId: u.id, reason: input.reason, before: null, after: { email: u.email, name, codeApplied: Boolean(input.invitationCode) } },
    });
    return u;
  });
  if (input.invitationCode) {
    try {
      await redeemCode(ctx, user.id, input.invitationCode);
    } catch (err) {
      // Leave nothing behind if the code can't be applied.
      await ctx.db.user.delete({ where: { id: user.id } });
      throw err;
    }
  }
  return { clientId: user.id, ...(await issueLink(ctx, adminId, user.id)) };
}

/** A fresh link for an onboarded client who hasn't set a password yet; older links stop working. */
export async function reissueSetPasswordLink(ctx: AppContext, adminId: string, clientId: string, raw: unknown) {
  const { reason } = ReasonSchema.parse(raw);
  const user = await assertClient(ctx, clientId);
  if (!hasUnsetPassword(user)) throw new AppError(409, "password_already_set", "This client has already set a password.");
  await ctx.db.passwordSetupToken.updateMany({ where: { userId: clientId, usedAt: null }, data: { usedAt: new Date() } });
  await audit(ctx.db, {
    actorUserId: adminId,
    actorType: "admin",
    action: "admin.set_password_link_issued",
    resourceType: "user",
    resourceId: clientId,
    metadata: { clientId, reason, before: null, after: null },
  });
  return issueLink(ctx, adminId, clientId);
}

async function usableToken(ctx: AppContext, token: string) {
  const rec = await ctx.db.passwordSetupToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!rec || rec.usedAt || rec.expiresAt <= new Date() || !hasUnsetPassword(rec.user)) {
    throw new AppError(410, "link_invalid", "This link has expired or was already used. Ask the First Five team for a new one.");
  }
  return rec;
}

export async function checkSetPasswordToken(ctx: AppContext, token: string) {
  const rec = await usableToken(ctx, token);
  return { email: rec.user.email };
}

export async function setPasswordFromToken(ctx: AppContext, raw: unknown) {
  const input = SetPasswordSchema.parse(raw);
  const rec = await usableToken(ctx, input.token);
  const passwordHash = await hashPassword(input.password);
  return ctx.db.$transaction(async (tx) => {
    const claimed = await tx.passwordSetupToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(410, "link_invalid", "This link was already used.");
    await tx.user.update({ where: { id: rec.userId }, data: { passwordHash } });
    await audit(tx, { actorUserId: rec.userId, actorType: "user", action: "user.password_set", resourceType: "user", resourceId: rec.userId });
    return rec.user;
  });
}
