import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";

/**
 * Vercel Function entry. Builds the app once per instance and hands each request
 * to Fastify. Static files come from the CDN, so the app serves the API only.
 * Maintenance runs from the daily cron (/api/internal/maintenance), not a timer.
 */
let ready: Promise<FastifyInstance> | undefined;

function instance(): Promise<FastifyInstance> {
  ready ??= (async () => {
    const { app } = await buildApp({ config: loadConfig(), db: createDb(), webDistDir: null, defer: waitUntil });
    await app.ready();
    return app;
  })();
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await instance();
  app.server.emit("request", req, res);
}
