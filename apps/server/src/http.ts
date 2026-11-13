import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "./lib/errors";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    authToken: string | undefined;
    /** Set while an admin views the app as this user; every write is refused. */
    impersonation: { adminId: string; expiresAt: Date } | null;
  }
}

export async function requireUser(req: FastifyRequest) {
  if (!req.user) throw new AppError(401, "unauthenticated", "Please log in to continue.");
}

/** First Five operators only. Account admins (builders) get 404 so the surface isn't advertised. */
export async function requireSuperadmin(req: FastifyRequest) {
  if (!req.user) throw new AppError(401, "unauthenticated", "Please log in to continue.");
  if (req.user.role !== "superadmin") throw new AppError(404, "not_found", "Not found.");
}

export function userId(req: FastifyRequest): string {
  if (!req.user) throw new AppError(401, "unauthenticated", "Please log in to continue.");
  return req.user.id;
}

/** Maps errors to safe JSON responses: no stack traces or provider internals reach clients. */
export function errorHandler(err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return reply.status(400).send({ error: { code: "invalid_request", message: err.issues[0]?.message ?? "Please check the highlighted fields.", fields } });
  }
  if (err.statusCode === 429) {
    return reply.status(429).send({ error: { code: "rate_limited", message: "Too many attempts. Please wait a moment and try again." } });
  }
  if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE" || err.statusCode === 413) {
    return reply.status(413).send({ error: { code: "payload_too_large", message: "Request is too large." } });
  }
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ error: { code: "invalid_request", message: "The request couldn't be processed." } });
  }
  req.log.error({ err }, "unhandled error");
  return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } });
}
