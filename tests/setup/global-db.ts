/**
 * Starts a real, disposable PostgreSQL server (embedded-postgres) for the
 * integration and contract tests, and applies the Prisma migrations to it.
 * Set TEST_DATABASE_URL to use an existing PostgreSQL instead.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

let pg: EmbeddedPostgres | null = null;

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const dir = resolve(".data/test-pg");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(resolve(".data"), { recursive: true });
    const port = 54329;
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "firstfive", password: "firstfive", port, persistent: false, onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("firstfive_test");
    url = `postgresql://firstfive:firstfive@localhost:${port}/firstfive_test`;
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
  project.provide("databaseUrl", url);
  return async () => {
    await pg?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
