import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testDirectory = JSON.stringify({
  groups: {
    alpha: {
      members: {
        "receiver@example.com": { role: "receiver", name: "Alpha" },
        "caller@example.com": { role: "caller", name: "Cal" },
        "admin@example.com": { role: "admin", name: "Ada" },
      },
    },
    beta: {
      members: {
        "beta-receiver@example.com": { role: "receiver", name: "Beta" },
        "caller@example.com": { role: "caller", name: "Cal" },
      },
    },
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
