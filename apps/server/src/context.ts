import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import type { Providers } from "./integrations/registry";

/** Dependencies shared by services and routes. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  providers: Providers;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error" | "debug">;
  /**
   * Keeps work a request started but doesn't await running after the response.
   * On a long-lived server the promise just runs; on serverless hosting this is
   * the platform's `waitUntil`, so the work isn't frozen with the instance.
   */
  defer: (p: Promise<unknown>) => void;
}

/** Default `defer` for a long-lived process: let the promise run, swallow its rejection. */
export const runDetached = (p: Promise<unknown>): void => void p.catch(() => {});
