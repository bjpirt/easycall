import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testDirectory = JSON.stringify({
  groups: { alpha: { displayName: "Alpha" }, beta: { displayName: "Beta" } },
});

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { DIRECTORY: testDirectory } },
          }),
        ],
        test: { name: "worker", include: ["src/worker/**/*.test.ts", "src/shared/**/*.test.ts"] },
      },
      {
        test: { name: "client", environment: "happy-dom", include: ["src/client/**/*.test.ts"] },
      },
    ],
  },
});
