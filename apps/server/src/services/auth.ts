import argon2 from "argon2";
import type { AppContext } from "../context";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { recordConversion } from "./conversions";

export const SESSION_COOKIE = "ff_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Holds the admin's own session token while they view the app as a client. */
export const ADMIN_RETURN_COOKIE = "ff_admin_return";
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000;
/** Stored instead of a password hash for a client onboarded by a superadmin, until they set one; never verifies. */
export const UNSET_PASSWORD = "!unset";
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Used to equalize timing when the email doesn't exist.
let dummyHash: Promise<string> | null = null;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function signup(ctx: AppContext, input: { email: string; password: string; name?: string }) {
  const existing = await ctx.db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, "email_taken", "An account with this email already exists. Try logging in.", {
      email: "An account with this email already exists",
    });
  }
  const passwordHash = await hashPassword(input.password);
  return ctx.db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, passwordHash, name: input.name || null },
    });
    // No product access is granted at signup; access comes from a verified payment or an invitation code.
    await recordConversion(tx, ctx.config, "signup_completed", { userId: user.id });
    await audit(tx, { actorUserId: user.id, actorType: "user", action: "user.signup", resourceType: "user", resourceId: user.id });
    return user;
  });
}

export async function login(ctx: AppContext, input: { email: string; password: string }) {
  const user = await ctx.db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    dummyHash ??= hashPassword("timing-equalizer-password");
    await verifyPassword(await dummyHash, input.password);
    throw invalidCredentials();
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw invalidCredentials();
  if (argon2.needsRehash(user.passwordHash, ARGON_OPTIONS)) {
    await ctx.db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
  }
  return user;
}

function invalidCredentials() {
  return new AppError(401, "invalid_credentials", "That email and password don't match an account.");
}

export async function createAuthSession(ctx: AppContext, userId: string, userAgent?: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await ctx.db.authSession.create({
    data: { userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 200) },
  });
  return { token, expiresAt };
}

/** A read-only "view as client" session for an admin, with a fixed 30-minute expiry. */
export async function createImpersonationSession(ctx: AppContext, adminId: string, clientId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);
  await ctx.db.authSession.create({
    data: { userId: clientId, tokenHash: sha256(token), expiresAt, impersonatorUserId: adminId, readOnly: true },
  });
  return { token, expiresAt };
}

export async function resolveAuthSession(
  ctx: AppContext,
  token: string | undefined,
  opts: { onExpired?: (s: { userId: string; impersonatorUserId: string | null }) => void } = {},
) {
  if (!token || token.length > 200) return null;
  const session = await ctx.db.authSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await ctx.db.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    opts.onExpired?.(session);
    return null;
  }
  // View-as sessions never slide their expiry and never count as the client's activity.
  if (!session.readOnly && now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await ctx.db.authSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) } })
      .catch(() => undefined);
  }
  return session;
}

export async function destroyAuthSession(ctx: AppContext, token: string | undefined) {
  if (!token) return;
  await ctx.db.authSession.deleteMany({ where: { tokenHash: sha256(token) } });
}
