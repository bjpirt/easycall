import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "worker", include: ["src/worker/**/*.test.ts", "src/shared/**/*.test.ts"] },
      },
      {
        test: { name: "client", environment: "happy-dom", include: ["src/client/**/*.test.ts"] },
      },
    ],
  },
});
