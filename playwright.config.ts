import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Before importing e2e/config, which reads it.
process.env.E2E_SESSION_SECRET ??= randomBytes(32).toString("base64url");

const { baseURL, e2eGroup, e2eSessionSecret, port } = await import("./e2e/config");

const groups = Array.from({ length: 16 }, (_, i) => `e2e-${String(i)}`);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Synthetic camera/microphone and no permission prompts. Loopback ICE
          // candidates let the two peers connect even when a host firewall (e.g.
          // macOS stealth mode) drops LAN traffic to the unsigned test browser.
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--allow-loopback-in-peer-connection",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${String(port)} --strictPort`,
    // Ready once the Worker answers: a 401 (no session) counts as up. Pages redirect
    // to /login, and the root is deliberately a 404.
    url: `${baseURL}/e2e-0/api/me`,
    reuseExistingServer: !process.env.CI,
    env: {
      // A 6-second ready window, so the timeout test doesn't take 30 minutes.
      READY_WINDOW_MINUTES: "0.1",
      // One group per parallel worker (see e2e/fixtures.ts), so tests don't share rooms.
      DIRECTORY: JSON.stringify({ groups: Object.fromEntries(groups.map((g) => [g, e2eGroup])) }),
      SESSION_SECRET: e2eSessionSecret,
    },
  },
});
