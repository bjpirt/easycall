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
        "beta-caller@example.com": { role: "caller", name: "Bea" },
      },
    },
    // For the room's own tests (room.test.ts), which connect to it directly.
    room: {
      members: {
        "tablet@x.com": { role: "receiver", name: "Tablet" },
        "alice@x.com": { role: "caller", name: "Alice" },
        ...Object.fromEntries(
          Array.from({ length: 9 }, (_, i) => [
            `caller-${String(i + 1)}@x.com`,
            { role: "caller", name: `Caller ${String(i + 1)}` },
          ]),
        ),
      },
    },
  },
});

/** The build version (see vite.config.ts), fixed for tests. */
const define = { __APP_VERSION__: JSON.stringify("test-version"), __DEV_SERVER__: "false" };

export default defineConfig({
  test: {
    projects: [
      {
        define,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { DIRECTORY: testDirectory, SESSION_SECRET: "test-secret" } },
          }),
        ],
        test: { name: "worker", include: ["src/worker/**/*.test.ts", "src/shared/**/*.test.ts"] },
      },
      {
        define,
        test: { name: "client", environment: "happy-dom", include: ["src/client/**/*.test.ts"] },
      },
    ],
  },
});
