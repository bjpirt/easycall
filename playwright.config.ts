import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Before importing e2e/config, which reads them. Inherited by the workers.
process.env.E2E_SESSION_SECRET ??= randomBytes(32).toString("base64url");
process.env.E2E_RUN_ID ??= randomBytes(8).toString("hex");

const { baseURL, e2eGroup, e2eGroups, e2eSessionSecret, graceSeconds, port } =
  await import("./e2e/config");

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
    // Ready once the Worker answers: a 401 (no session) counts as up (pages redirect
    // to /login instead).
    url: `${baseURL}/${e2eGroups[0] ?? ""}/api/me`,
    reuseExistingServer: !process.env.CI,
    env: {
      // A 6-second ready window, so the timeout test doesn't take 30 minutes.
      READY_WINDOW_MINUTES: "0.1",
      // A short grace period for dropped connections, so expiry can be tested quickly.
      GRACE_SECONDS: String(graceSeconds),
      // A few groups per parallel worker (see e2e/fixtures.ts), so tests don't share rooms.
      DIRECTORY: JSON.stringify({
        groups: Object.fromEntries(e2eGroups.map((g) => [g, e2eGroup(g)])),
      }),
      SESSION_SECRET: e2eSessionSecret,
      // Rooms start empty: nothing left over from an earlier run (see vite.config.ts).
      E2E: "true",
    },
  },
});
