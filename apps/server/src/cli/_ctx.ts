import { loadConfig } from "../config";
import { runDetached, type AppContext } from "../context";
import { createDb } from "../db";
import { createProviders } from "../integrations/registry";

export function cliContext(): AppContext {
  const config = loadConfig();
  const db = createDb();
  return { config, db, providers: createProviders(config), log: console, defer: runDetached };
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
