import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testDirectory = JSON.stringify({
  groups: {
    alpha: {
      displayName: "Alpha",
      members: {
        "receiver@example.com": "receiver",
        "caller@example.com": "caller",
        "admin@example.com": "admin",
      },
    },
    beta: { displayName: "Beta", members: { "caller@example.com": "caller" } },
  },
});

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { DIRECTORY: testDirectory, SESSION_SECRET: "test-secret" } },
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
