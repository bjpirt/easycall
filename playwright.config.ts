import { defineConfig, devices } from "@playwright/test";

import { baseURL, e2eGroup, e2eSessionSecret, port } from "./e2e/config";

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
    // Ready once a group page loads (the root is deliberately a 404).
    url: `${baseURL}/e2e-0/`,
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
