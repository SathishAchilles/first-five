import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/generate-codes": "src/cli/generate-codes.ts",
    "cli/grant-superadmin": "src/cli/grant-superadmin.ts",
    "cli/sweep": "src/cli/sweep.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages are TypeScript source: bundle them. Everything else stays external.
  skipNodeModulesBundle: true,
  noExternal: [/^@firstfive\//],
});
